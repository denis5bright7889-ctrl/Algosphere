/**
 * POST /api/psychology/leaderboard/opt-in
 * Body: { opt_in: boolean }
 *
 * Toggles the caller's participation in the PUBLIC psychology rankings.
 * Enabling it is the explicit consent action: we set leaderboard_opt_in
 * and stamp terms_accepted_at / privacy_accepted_at (only if not already
 * set — we never overwrite an earlier acceptance). Opting out flips the
 * flag but preserves the consent timestamps as an audit trail.
 *
 * Self-update only — runs as the authenticated user, so the profiles RLS
 * "Users can update own profile" policy is the enforcement boundary.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { trackServerAsync } from '@/lib/tracking/server'

const schema = z.object({ opt_in: z.boolean() })

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 422 })

  const { opt_in } = parsed.data

  // Read current consent so we stamp acceptance only on the first opt-in.
  const { data: current } = await supabase
    .from('profiles')
    .select('terms_accepted_at, privacy_accepted_at')
    .eq('id', user.id)
    .single()

  const now = new Date().toISOString()
  const update: Record<string, unknown> = { leaderboard_opt_in: opt_in }
  if (opt_in) {
    if (!current?.terms_accepted_at)   update.terms_accepted_at = now
    if (!current?.privacy_accepted_at) update.privacy_accepted_at = now
  }

  const { error } = await supabase.from('profiles').update(update).eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Analytics: opt-in / opt-out rate. Fire-and-forget.
  trackServerAsync({
    event:  opt_in ? 'psychology_leaderboard_opt_in' : 'psychology_leaderboard_opt_out',
    userId: user.id,
    path:   '/settings',
    payload: { surface: 'settings' },
  })

  return NextResponse.json({ ok: true, leaderboard_opt_in: opt_in })
}
