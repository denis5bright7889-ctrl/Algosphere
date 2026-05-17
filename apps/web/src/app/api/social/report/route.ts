/**
 * POST /api/social/report — report any piece of community content.
 * Polymorphic: any (target_type, target_id) pair. One row per
 * (reporter, target) — re-reporting same item returns 200 silently
 * so the UI can be idempotent.
 */
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  target_type: z.enum(['social_post','discussion_reply','signal','comment','profile']),
  target_id:   z.string().uuid(),
  reason:      z.enum(['spam','harassment','misleading','illegal','other']),
  notes:       z.string().max(500).optional(),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  // Rate-limit: max 20 reports per user per hour.
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('content_reports')
    .select('id', { count: 'exact', head: true })
    .eq('reporter_id', user.id)
    .gte('created_at', cutoff)
  if ((count ?? 0) >= 20) {
    return NextResponse.json({ error: 'Rate limit: too many reports' }, { status: 429 })
  }

  const { error } = await supabase
    .from('content_reports')
    .insert({
      reporter_id: user.id,
      ...parsed.data,
    })

  // 23505 = unique_violation → already reported by this user. Idempotent.
  if (error && error.code !== '23505') {
    console.error('report insert failed:', error)
    return NextResponse.json({ error: 'Failed to file report' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
