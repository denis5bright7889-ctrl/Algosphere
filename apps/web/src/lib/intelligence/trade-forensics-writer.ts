/**
 * Trade Forensics Writer — Phase 4 writer.
 *
 * For every shadow_executions row that doesn't yet have a paired
 * trade_explanations row, compute the forensics report and UPSERT
 * into all four Phase-4 tables. Idempotent: UNIQUE on
 * shadow_execution_id means re-runs overwrite (no duplicates).
 *
 * Mode:
 *   - Default: process only shadow rows missing a forensics row
 *   - rebuildAll: re-process every shadow row (forces a refresh of
 *     all explanations under the current engine version)
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  analyzeTradeForensically, FORENSICS_VERSION,
  type ForensicsShadowInput, type ForensicsSignalContext,
} from './trade-forensics'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface ForensicsWriteResult {
  ran_at:              string
  engine_version:      string
  rows_evaluated:      number
  explanations_written: number
  reviews_written:      number
  outcomes_written:     number
  scores_written:       number
  errors:              Array<{ shadow_id: string; error: string }>
}

interface ShadowSelect {
  id: string; user_id: string; symbol: string; direction: string; broker: string
  signal_id: string | null
  intended_lot: number; intended_entry: number | null
  intended_sl: number | null; intended_tp: number | null
  actual_status: string; actual_fill_price: number | null; actual_lot: number | null
  slippage_pct: number | null; skip_reason: string | null
  leader_pnl: number | null; follower_pnl: number | null; pnl_drift_pct: number | null
  created_at: string; closed_at: string | null
}

interface SignalSelect {
  id: string
  risk_reward: number | null
  tier_required: string | null
}

export interface ForensicsWriteOpts {
  rebuildAll?: boolean
  limit?:      number
}

export async function writeTradeForensics(
  opts: ForensicsWriteOpts = {},
): Promise<ForensicsWriteResult> {
  const db = svc()
  const ranAt = new Date().toISOString()
  const limit = opts.limit ?? 1_000

  const result: ForensicsWriteResult = {
    ran_at:               ranAt,
    engine_version:       FORENSICS_VERSION,
    rows_evaluated:       0,
    explanations_written: 0,
    reviews_written:      0,
    outcomes_written:     0,
    scores_written:       0,
    errors:               [],
  }

  // Pull shadow rows. Default mode: only those without an explanation.
  let pendingIds: string[] = []
  if (opts.rebuildAll) {
    const { data: all } = await db
      .from('shadow_executions')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(limit)
    pendingIds = ((all ?? []) as Array<{ id: string }>).map(r => r.id)
  } else {
    // Pull existing explanations' shadow_execution_id, then diff against
    // shadow_executions. Supabase has no `NOT IN` against a subquery in
    // the JS client, so we do it client-side.
    const [{ data: shadow }, { data: existing }] = await Promise.all([
      db.from('shadow_executions').select('id').order('created_at', { ascending: false }).limit(limit),
      db.from('trade_explanations').select('shadow_execution_id'),
    ])
    const existingSet = new Set(
      ((existing ?? []) as Array<{ shadow_execution_id: string }>).map(r => r.shadow_execution_id),
    )
    pendingIds = ((shadow ?? []) as Array<{ id: string }>)
      .map(r => r.id)
      .filter(id => !existingSet.has(id))
  }

  if (pendingIds.length === 0) return result

  // Hydrate the pending shadow rows.
  const { data: shadowFull, error: shadowErr } = await db
    .from('shadow_executions')
    .select(`
      id, user_id, symbol, direction, broker, signal_id,
      intended_lot, intended_entry, intended_sl, intended_tp,
      actual_status, actual_fill_price, actual_lot, slippage_pct, skip_reason,
      leader_pnl, follower_pnl, pnl_drift_pct, created_at, closed_at
    `)
    .in('id', pendingIds)

  if (shadowErr) {
    result.errors.push({ shadow_id: '*', error: shadowErr.message })
    return result
  }

  const shadowRows = (shadowFull ?? []) as ShadowSelect[]
  result.rows_evaluated = shadowRows.length

  // Batch-fetch the signal context for rows that reference one.
  const signalIds = Array.from(new Set(
    shadowRows.map(r => r.signal_id).filter((v): v is string => !!v),
  ))
  const signalById = new Map<string, SignalSelect>()
  if (signalIds.length > 0) {
    const { data: sigs } = await db
      .from('signals')
      .select('id, risk_reward, tier_required')
      .in('id', signalIds)
    for (const s of ((sigs ?? []) as SignalSelect[])) signalById.set(s.id, s)
  }

  // Compute + write per shadow row.
  const explanations: ReturnType<typeof analyzeTradeForensically>['explanation'][] = []
  const reviews:      ReturnType<typeof analyzeTradeForensically>['review'][] = []
  const outcomes:     ReturnType<typeof analyzeTradeForensically>['outcome'][] = []
  const qualities:    ReturnType<typeof analyzeTradeForensically>['quality'][] = []

  for (const s of shadowRows) {
    try {
      const sigRow = s.signal_id ? signalById.get(s.signal_id) ?? null : null
      const ctx: ForensicsSignalContext | null = sigRow ? {
        confidence:    null,                   // not stored on the signals slice we read
        market_regime: null,
        tier_required: sigRow.tier_required,
        risk_reward:   sigRow.risk_reward,
      } : null

      const input: ForensicsShadowInput = {
        id:                s.id,
        user_id:           s.user_id,
        symbol:            s.symbol,
        direction:         s.direction,
        broker:            s.broker,
        intended_lot:      s.intended_lot,
        intended_entry:    s.intended_entry,
        intended_sl:       s.intended_sl,
        intended_tp:       s.intended_tp,
        actual_status:     s.actual_status,
        actual_fill_price: s.actual_fill_price,
        actual_lot:        s.actual_lot,
        slippage_pct:      s.slippage_pct,
        skip_reason:       s.skip_reason,
        leader_pnl:        s.leader_pnl,
        follower_pnl:      s.follower_pnl,
        pnl_drift_pct:     s.pnl_drift_pct,
        created_at:        s.created_at,
        closed_at:         s.closed_at,
      }

      const report = analyzeTradeForensically(input, ctx)
      explanations.push(report.explanation)
      reviews.push(report.review)
      outcomes.push(report.outcome)
      qualities.push(report.quality)
    } catch (e) {
      result.errors.push({
        shadow_id: s.id,
        error:     e instanceof Error ? e.message : String(e),
      })
    }
  }

  // UPSERT in batches. UNIQUE(shadow_execution_id) on each table means
  // re-runs land cleanly; ignoreDuplicates=false so the row is refreshed
  // with the latest engine output.
  const upsertOpts = {
    onConflict:       'shadow_execution_id',
    ignoreDuplicates: false,
  } as const

  if (explanations.length > 0) {
    const { error } = await db.from('trade_explanations').upsert(explanations, upsertOpts)
    if (error) result.errors.push({ shadow_id: '*', error: `trade_explanations: ${error.message}` })
    else result.explanations_written = explanations.length
  }
  if (reviews.length > 0) {
    const { error } = await db.from('trade_reviews').upsert(reviews, upsertOpts)
    if (error) result.errors.push({ shadow_id: '*', error: `trade_reviews: ${error.message}` })
    else result.reviews_written = reviews.length
  }
  if (outcomes.length > 0) {
    const { error } = await db.from('trade_outcomes').upsert(outcomes, upsertOpts)
    if (error) result.errors.push({ shadow_id: '*', error: `trade_outcomes: ${error.message}` })
    else result.outcomes_written = outcomes.length
  }
  if (qualities.length > 0) {
    const { error } = await db.from('trade_quality_scores').upsert(qualities, upsertOpts)
    if (error) result.errors.push({ shadow_id: '*', error: `trade_quality_scores: ${error.message}` })
    else result.scores_written = qualities.length
  }

  return result
}
