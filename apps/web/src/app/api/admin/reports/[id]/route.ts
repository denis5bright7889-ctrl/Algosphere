/**
 * POST /api/admin/reports/[id]
 *   body: { action: 'dismiss' | 'action' }
 *
 *  • dismiss → mark this report resolved/dismissed
 *  • action  → mark resolved/actioned AND set the target's is_flagged=true
 *              (so RLS hides it from public reads).
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  action: z.enum(['dismiss', 'action']),
})

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  const svc = createServiceClient()

  // Find the report row to know what target to (optionally) flag.
  const { data: report } = await svc
    .from('content_reports')
    .select('id, target_type, target_id, status')
    .eq('id', id)
    .single()

  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (report.status !== 'pending') {
    return NextResponse.json({ error: 'Already resolved' }, { status: 409 })
  }

  // 'action' = hide content. Map target_type → table.
  if (parsed.data.action === 'action') {
    const table =
      report.target_type === 'social_post'      ? 'social_posts'
    : report.target_type === 'discussion_reply' ? 'discussion_replies'
    : null
    if (table) {
      const update: Record<string, unknown> = { is_flagged: true }
      if (table === 'social_posts') update.flagged_reason = 'admin_hidden'
      await svc.from(table).update(update).eq('id', report.target_id)
    }
  }

  await svc
    .from('content_reports')
    .update({
      status:      parsed.data.action === 'action' ? 'actioned' : 'dismissed',
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
