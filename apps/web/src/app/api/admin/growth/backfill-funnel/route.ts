/**
 * /api/admin/growth/backfill-funnel — one-shot historical backfill.
 *
 * Walks the existing tables and inserts the equivalent funnel events
 * into growth_attribution_events so the funnel dashboard reflects
 * real activity from before the pixel was wired:
 *
 *   profiles.created_at              → signup
 *   broker_connections.created_at    → broker_connected (one per user, first time)
 *   crypto_payments (status=approved) → premium_upgrade (one per user, first time)
 *   journal_entries.created_at       → journal_created (one per user, first time)
 *   user_strategies.created_at       → strategy_created (one per user, first time)
 *
 * Idempotent — uses a payload marker so re-runs skip already-back-
 * filled rows. Admin-only. Synchronous (returns counts on completion).
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user.email)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

interface BackfillSummary {
  signup:           number
  broker_connected: number
  premium_upgrade:  number
  journal_created:  number
  strategy_created: number
  skipped:          number
}

const BACKFILL_TAG = 'backfill_v1'

/** Per-user existence check via payload marker. */
async function alreadyBackfilled(db: ReturnType<typeof svc>, event: string, userId: string): Promise<boolean> {
  const { count } = await db
    .from('growth_attribution_events')
    .select('id', { count: 'exact', head: true })
    .eq('event', event)
    .eq('user_id', userId)
    .contains('payload', { source: BACKFILL_TAG })
  return (count ?? 0) > 0
}

async function insertEvent(
  db:       ReturnType<typeof svc>,
  event:    string,
  userId:   string,
  when:     string,
  extra:    Record<string, unknown> = {},
): Promise<boolean> {
  if (await alreadyBackfilled(db, event, userId)) return false
  await db.from('growth_attribution_events').insert({
    event,
    user_id:     userId,
    occurred_at: when,
    source_kind: 'backfill',
    payload:     { source: BACKFILL_TAG, ...extra },
  })
  return true
}

export async function POST() {
  const g = await gate()
  if ('error' in g) return g.error

  const db = svc()
  const summary: BackfillSummary = {
    signup: 0, broker_connected: 0, premium_upgrade: 0,
    journal_created: 0, strategy_created: 0, skipped: 0,
  }

  // 1. signup — every profile row
  const { data: profiles } = await db
    .from('profiles')
    .select('id, created_at')
    .order('created_at', { ascending: true })
    .limit(50_000)

  for (const p of (profiles ?? [])) {
    const ok = await insertEvent(db, 'signup', p.id, p.created_at)
    if (ok) summary.signup += 1; else summary.skipped += 1
  }

  // 2. broker_connected — one per user, earliest connection
  const { data: brokers } = await db
    .from('broker_connections')
    .select('user_id, broker, created_at')
    .order('created_at', { ascending: true })
    .limit(50_000)

  const seenBroker = new Set<string>()
  for (const b of (brokers ?? [])) {
    if (!b.user_id || seenBroker.has(b.user_id)) continue
    seenBroker.add(b.user_id)
    const ok = await insertEvent(db, 'broker_connected', b.user_id, b.created_at, { broker: b.broker })
    if (ok) summary.broker_connected += 1; else summary.skipped += 1
  }

  // 3. premium_upgrade — first approved crypto_payment per user
  const { data: payments } = await db
    .from('crypto_payments')
    .select('user_id, plan, amount_usd, reviewed_at, created_at, status')
    .eq('status', 'approved')
    .order('reviewed_at', { ascending: true })
    .limit(50_000)

  const seenUp = new Set<string>()
  for (const p of (payments ?? [])) {
    if (!p.user_id || seenUp.has(p.user_id)) continue
    seenUp.add(p.user_id)
    const when = p.reviewed_at ?? p.created_at
    const ok = await insertEvent(db, 'premium_upgrade', p.user_id, when, {
      plan: p.plan, amount_usd: p.amount_usd,
    })
    if (ok) summary.premium_upgrade += 1; else summary.skipped += 1
  }

  // 4. journal_created — first journal_entry per user
  const { data: journals } = await db
    .from('journal_entries')
    .select('user_id, created_at')
    .order('created_at', { ascending: true })
    .limit(50_000)

  const seenJ = new Set<string>()
  for (const j of (journals ?? [])) {
    if (!j.user_id || seenJ.has(j.user_id)) continue
    seenJ.add(j.user_id)
    const ok = await insertEvent(db, 'journal_created', j.user_id, j.created_at)
    if (ok) summary.journal_created += 1; else summary.skipped += 1
  }

  // 5. strategy_created — first user_strategy per user
  const { data: strats } = await db
    .from('user_strategies')
    .select('user_id, created_at')
    .order('created_at', { ascending: true })
    .limit(50_000)

  const seenS = new Set<string>()
  for (const s of (strats ?? [])) {
    if (!s.user_id || seenS.has(s.user_id)) continue
    seenS.add(s.user_id)
    const ok = await insertEvent(db, 'strategy_created', s.user_id, s.created_at)
    if (ok) summary.strategy_created += 1; else summary.skipped += 1
  }

  return NextResponse.json({
    backfilled_at: new Date().toISOString(),
    ...summary,
  })
}

// GET for parity / health
export async function GET() {
  return POST()
}
