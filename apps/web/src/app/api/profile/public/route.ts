/**
 * POST /api/profile/public — opt in/out of the public leaderboard.
 * Body: { public_profile: boolean, handle?: string, bio?: string }
 *
 * Handle is unique (case-insensitive, enforced by DB index). We pre-check
 * for a friendly error and rely on the unique index as the race-safe backstop.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isValidHandle, normalizeHandle } from '@/lib/leaderboard'

const schema = z.object({
  public_profile: z.boolean(),
  handle: z.string().optional(),
  bio: z.string().max(200).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 422 })

  const { public_profile, bio } = parsed.data
  const update: Record<string, unknown> = { public_profile, bio: bio ?? null }

  if (public_profile) {
    const handle = normalizeHandle(parsed.data.handle ?? '')
    if (!isValidHandle(handle)) {
      return NextResponse.json(
        { error: 'Handle must be 3–20 chars: lowercase letters, numbers, dashes.' },
        { status: 422 },
      )
    }

    // Friendly pre-check (unique index is the real guarantee)
    const { data: taken } = await supabase
      .from('profiles')
      .select('id')
      .ilike('public_handle', handle)
      .neq('id', user.id)
      .maybeSingle()
    if (taken) {
      return NextResponse.json({ error: 'That handle is taken.' }, { status: 409 })
    }
    update.public_handle = handle
  }

  const { error } = await supabase.from('profiles').update(update).eq('id', user.id)
  if (error) {
    const dup = /duplicate|unique/i.test(error.message)
    return NextResponse.json(
      { error: dup ? 'That handle is taken.' : error.message },
      { status: dup ? 409 : 500 },
    )
  }

  return NextResponse.json({ ok: true, public_profile })
}
