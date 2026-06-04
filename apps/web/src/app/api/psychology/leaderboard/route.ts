/**
 * GET /api/psychology/leaderboard?range=global|weekly|monthly
 *
 * Consent-gated PUBLIC psychology rankings. Returns, for each ELIGIBLE
 * participant (leaderboard_opt_in = true AND Terms + Privacy accepted),
 * only: rank, percentile, display name, and the four public scores
 * (maturity / discipline / consistency / patience). Never a user id,
 * email, or any raw journal data — see lib/intelligence/psychology-leaderboard.
 *
 * Cross-user reads run with the service role (RLS would otherwise scope
 * to the caller). The eligibility filter is applied in the query AND
 * re-checked in the pure layer as a defensive backstop.
 */
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  assembleLeaderboard, isEligible, isLeaderboardRange, rangeToWindowDays,
  type EligibleProfile, type UserEntries, type LeaderboardRange,
} from '@/lib/intelligence/psychology-leaderboard'
import type { V3Entry } from '@/lib/intelligence/psychology-v3'

export const dynamic = 'force-dynamic'

const MAX_PARTICIPANTS = 1000
const MAX_ENTRY_ROWS   = 20_000
const MAX_ROWS_OUT     = 100

export async function GET(request: Request) {
  // Require an authenticated session — this is a dashboard surface, and we
  // need the caller's id to tag their own row (is_you).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rangeParam = new URL(request.url).searchParams.get('range')
  const range: LeaderboardRange = isLeaderboardRange(rangeParam) ? rangeParam : 'global'
  const windowDays = rangeToWindowDays(range)

  const svc = createServiceClient()

  // 1) Eligible participants only.
  const { data: profilesRaw, error: pErr } = await svc
    .from('profiles')
    .select('id, public_handle, leaderboard_opt_in, terms_accepted_at, privacy_accepted_at')
    .eq('leaderboard_opt_in', true)
    .not('terms_accepted_at', 'is', null)
    .not('privacy_accepted_at', 'is', null)
    .limit(MAX_PARTICIPANTS)
  if (pErr) return NextResponse.json({ error: 'Failed to load participants' }, { status: 500 })

  const eligible = ((profilesRaw ?? []) as EligibleProfile[]).filter(isEligible)
  if (eligible.length === 0) {
    return NextResponse.json({ range, generated_at: new Date().toISOString(), rows: [], you: null })
  }

  // 2) Their journal rows within the window — only the columns the
  //    behavioral engine reads. No rows are ever returned to the client.
  const ids = eligible.map((p) => p.id)
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString()
  const { data: entriesRaw, error: eErr } = await svc
    .from('journal_entries')
    .select('user_id, created_at, pnl, risk_pct, lot_size, setup_tag, emotion_pre, rule_violation, trade_date, pair')
    .in('user_id', ids)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(MAX_ENTRY_ROWS)
  if (eErr) return NextResponse.json({ error: 'Failed to load entries' }, { status: 500 })

  // 3) Group + assemble (pure).
  const byUser = new Map<string, V3Entry[]>()
  for (const row of (entriesRaw ?? []) as Array<V3Entry & { user_id: string }>) {
    const arr = byUser.get(row.user_id)
    if (arr) arr.push(row)
    else byUser.set(row.user_id, [row])
  }
  const users: UserEntries[] = eligible.map((p) => ({
    userId:  p.id,
    handle:  p.public_handle,
    entries: byUser.get(p.id) ?? [],
  }))

  const { rows, you } = assembleLeaderboard(users, windowDays, user.id)

  return NextResponse.json({
    range,
    generated_at: new Date().toISOString(),
    participants: rows.length,
    rows: rows.slice(0, MAX_ROWS_OUT),
    you,
  })
}
