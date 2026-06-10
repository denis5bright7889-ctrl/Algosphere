/**
 * Strategy State Machine — Phase 2 spec's auto-qualification system.
 *
 * States: OBSERVATION → WATCHLIST → QUALIFICATION → LIVE_ELIGIBLE
 *          (any state can transition to REJECTED on rule failure)
 *
 * Rules (from the spec):
 *   LIVE_ELIGIBLE  sample ≥ 100, win rate ≥ 55%, Sharpe ≥ 1.5,
 *                  max_dd ≤ 10%, profit_factor ≥ 1.3
 *   QUALIFICATION  sample ≥ 50  AND meets ≥ 3 of the above thresholds
 *   WATCHLIST      sample ≥ 20  AND positive expectancy
 *   OBSERVATION    sample < 20  OR fresh strategy
 *   REJECTED       sample ≥ 50  AND fails ≥ 3 of the above thresholds
 *
 * Honesty contract:
 *   - State derives only from real strategy_validation_scores rows
 *     (which derive only from shadow_executions).
 *   - Transitions are UPSERT into strategy_state. Every transition
 *     also appends to strategy_qualification_history (existing table
 *     from migration 80).
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export type StrategyStateKind =
  | 'OBSERVATION' | 'WATCHLIST' | 'QUALIFICATION' | 'LIVE_ELIGIBLE' | 'REJECTED'

export interface StateMachineResult {
  ran_at:              string
  strategies_evaluated: number
  transitions_written: number
  by_state:            Record<StrategyStateKind, number>
  errors:              Array<{ user_id?: string; strategy_name?: string; error: string }>
  rows_written:        number
}

interface ScoreRow {
  user_id:           string
  strategy_name:     string
  sample_size:       number
  win_rate_pct:      number | null
  profit_factor:     number | null
  sharpe:            number | null
  max_drawdown_pct:  number | null
  expected_value:    number | null
  computed_at:       string
}

function evaluateState(s: ScoreRow): { state: StrategyStateKind; evidence: Record<string, unknown> } {
  const thresholds = {
    sample_ge_100: s.sample_size >= 100,
    sample_ge_50:  s.sample_size >= 50,
    sample_ge_20:  s.sample_size >= 20,
    win_rate_ge_55: (s.win_rate_pct ?? 0) >= 55,
    sharpe_ge_15:  (s.sharpe ?? 0) >= 1.5,
    pf_ge_13:      (s.profit_factor ?? 0) >= 1.3,
    dd_le_10:      (s.max_drawdown_pct ?? 100) <= 10,
    positive_ev:   (s.expected_value ?? 0) > 0,
  }

  const liveSet = ['win_rate_ge_55', 'sharpe_ge_15', 'pf_ge_13', 'dd_le_10'] as const
  const livePassed = liveSet.filter(k => thresholds[k]).length
  const liveEligible = thresholds.sample_ge_100 && livePassed === liveSet.length

  if (liveEligible) {
    return { state: 'LIVE_ELIGIBLE', evidence: { thresholds, passed: livePassed } }
  }
  if (thresholds.sample_ge_50 && livePassed >= 3) {
    return { state: 'QUALIFICATION', evidence: { thresholds, passed: livePassed } }
  }
  if (thresholds.sample_ge_50 && livePassed <= 1) {
    return { state: 'REJECTED', evidence: { thresholds, passed: livePassed } }
  }
  if (thresholds.sample_ge_20 && thresholds.positive_ev) {
    return { state: 'WATCHLIST', evidence: { thresholds, passed: livePassed } }
  }
  return { state: 'OBSERVATION', evidence: { thresholds, passed: livePassed } }
}

export async function writeStrategyStateMachine(): Promise<StateMachineResult> {
  const db = svc()
  const ranAt = new Date().toISOString()

  const result: StateMachineResult = {
    ran_at:               ranAt,
    strategies_evaluated: 0,
    transitions_written:  0,
    rows_written:         0,
    by_state: {
      OBSERVATION: 0, WATCHLIST: 0, QUALIFICATION: 0,
      LIVE_ELIGIBLE: 0, REJECTED: 0,
    },
    errors:               [],
  }

  // Pull the LATEST score per (user_id, strategy_name).
  const { data: scores } = await db
    .from('strategy_validation_scores')
    .select('user_id, strategy_name, sample_size, win_rate_pct, profit_factor, sharpe, max_drawdown_pct, expected_value, computed_at')
    .order('computed_at', { ascending: false })
    .limit(5_000)

  const latestByKey = new Map<string, ScoreRow>()
  for (const r of ((scores ?? []) as ScoreRow[])) {
    const key = `${r.user_id}|${r.strategy_name}`
    if (!latestByKey.has(key)) latestByKey.set(key, r)
  }

  // Pre-fetch current state for diff
  const { data: currentStates } = await db
    .from('strategy_state')
    .select('user_id, strategy_name, state')
  const currentByKey = new Map<string, StrategyStateKind>()
  for (const r of ((currentStates ?? []) as Array<{ user_id: string; strategy_name: string; state: StrategyStateKind }>)) {
    currentByKey.set(`${r.user_id}|${r.strategy_name}`, r.state)
  }

  for (const [key, score] of latestByKey) {
    result.strategies_evaluated++
    try {
      const { state, evidence } = evaluateState(score)
      result.by_state[state]++

      const prev = currentByKey.get(key) ?? null
      // UPSERT strategy_state (current snapshot)
      await db.from('strategy_state').upsert({
        user_id:           score.user_id,
        strategy_name:     score.strategy_name,
        state,
        last_evaluated_at: ranAt,
        ...(prev === state ? {} : { entered_state_at: ranAt }),
        evidence,
      }, { onConflict: 'user_id,strategy_name', ignoreDuplicates: false })

      // History row only on transition
      if (prev !== state) {
        await db.from('strategy_qualification_history').insert({
          user_id:       score.user_id,
          strategy_name: score.strategy_name,
          from_stage:    prev,
          to_stage:      state,
          reason:        `state_machine: sample=${score.sample_size}, sharpe=${score.sharpe ?? '—'}, pf=${score.profit_factor ?? '—'}`,
          metadata:      { source: 'state_machine', ran_at: ranAt, evidence },
        })
        result.transitions_written++
      }
      result.rows_written++
    } catch (e) {
      result.errors.push({
        user_id:       score.user_id,
        strategy_name: score.strategy_name,
        error:         e instanceof Error ? e.message : String(e),
      })
    }
  }

  return result
}
