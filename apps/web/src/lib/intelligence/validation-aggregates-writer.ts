/**
 * Validation Aggregates Writer — Phase 12 (writers 2–5 of 8).
 *
 * Persists per-user rolling aggregates into FOUR tables in one pass:
 *
 *   • broker_quality_scores        — append-only snapshot per (user, broker)
 *   • strategy_validation_scores   — append-only snapshot per (user, strategy)
 *   • ai_strategy_reviews          — append-only coach review per strategy
 *   • validation_milestones        — newly-earned milestones only (unique-indexed)
 *
 * One outer loop over active users keeps the DB hit count linear:
 *   N reads (shadow_executions per user) + ~K writes per user
 *
 * Honesty contract:
 *   - Users with zero closed trades are skipped entirely. No empty rows.
 *   - Strategies below sample threshold (collecting_data=true) are
 *     skipped in strategy_validation_scores AND ai_strategy_reviews
 *     — the coach refuses to review undersampled strategies anyway.
 *   - Brokers below BROKER_MIN_SAMPLE land in broker_quality_scores
 *     with score+grade=null (NOT fabricated grades). We persist them
 *     so trending can show "Collecting → Graded" transitions.
 *   - validation_milestones inserts ONLY earned achievements. Locked
 *     and blocked milestones aren't persisted (the on-page derivation
 *     handles those).
 *   - Existing milestones aren't re-inserted (we pre-query and
 *     diff). The unique index would reject them anyway; this just
 *     avoids the noisy conflict.
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  aggregateBrokerQuality, type BrokerQuality,
} from './broker-quality-aggregate'
import {
  aggregateStrategyPerformance, type StrategyMetrics,
} from './strategy-performance-aggregate'
import {
  reviewAllStrategiesForValidation, type ValidationCoachReview,
} from './validation-coach'
import { deriveMilestones } from './milestones'
import type { MilestoneKind } from './milestones'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface AggregatesWriteResult {
  ran_at:                  string
  users_processed:         number
  users_with_data:         number
  broker_scores_written:   number
  strategy_scores_written: number
  ai_reviews_written:      number
  milestones_inserted:     number
  errors:                  Array<{ user_id: string; error: string }>
}

interface ShadowRow {
  broker:         string
  actual_status:  string
  slippage_pct:   number | null
  pnl_drift_pct:  number | null
  follower_pnl:   number | null
  closed_at:      string | null
  created_at:     string
  copy_trade_id:  string | null
}

interface AttribRow {
  created_at:     string
  closed_at:      string | null
  follower_pnl:   number | null
  actual_status:  string
  slippage_pct:   number | null
  pnl_drift_pct:  number | null
  copy_trade?: {
    subscription?: {
      strategy?: { id: string; name: string } | null
    } | null
  } | null
}

const LOOKBACK_DAYS = 30

export async function writeValidationAggregates(): Promise<AggregatesWriteResult> {
  const db = svc()
  const ranAt = new Date().toISOString()

  const result: AggregatesWriteResult = {
    ran_at:                  ranAt,
    users_processed:         0,
    users_with_data:         0,
    broker_scores_written:   0,
    strategy_scores_written: 0,
    ai_reviews_written:      0,
    milestones_inserted:     0,
    errors:                  [],
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const windowStart = since
  const windowEnd   = ranAt

  // Active users — anyone with shadow activity in the lookback window.
  const { data: actives, error: activeErr } = await db
    .from('shadow_executions')
    .select('user_id')
    .gte('created_at', since)
    .limit(5_000)
  if (activeErr) {
    result.errors.push({ user_id: '*', error: activeErr.message })
    return result
  }
  const userIds = Array.from(new Set(((actives ?? []) as Array<{ user_id: string }>).map(r => r.user_id)))
  result.users_processed = userIds.length

  for (const uid of userIds) {
    try {
      // ── Pull this user's shadow rows (cross-broker, all-time) ─────
      const { data: shadowRows } = await db
        .from('shadow_executions')
        .select(`
          broker, actual_status, slippage_pct, pnl_drift_pct,
          follower_pnl, closed_at, created_at, copy_trade_id
        `)
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(5_000)

      const rows = (shadowRows ?? []) as ShadowRow[]
      const closed = rows.filter(r => r.closed_at && typeof r.follower_pnl === 'number')
      if (closed.length === 0) continue
      result.users_with_data++

      // ── 1. broker_quality_scores ──────────────────────────────────
      const brokerQuality = aggregateBrokerQuality(rows.map(r => ({
        broker:        r.broker,
        actual_status: r.actual_status,
        slippage_pct:  r.slippage_pct,
        pnl_drift_pct: r.pnl_drift_pct,
        skip_reason:   null,
      })))

      const brokerPayloads = brokerQuality.map((b: BrokerQuality) => ({
        user_id:                  uid,
        broker:                   b.broker,
        window_start:             windowStart,
        window_end:               windowEnd,
        sample_size:              b.sample_size,
        fill_rate_pct:            b.fill_rate_pct,
        avg_slippage_pct:         b.avg_slippage_pct,
        avg_drift_pct:            b.avg_drift_pct,
        failed_count:             b.failed_count,
        mirrored_count:           b.mirrored_count,
        skipped_count:            b.skipped_count,
        // requote / spread / latency are nullable in schema — null is
        // correct here, schema doesn't carry the source columns yet.
        requote_count:            b.requote_count,
        spread_efficiency_pct:    b.spread_efficiency_pct,
        execution_latency_ms:     b.execution_latency_ms,
        execution_quality_score:  b.execution_quality_score,
        grade:                    b.grade,
        percentile_rank:          b.percentile_rank,
      }))

      if (brokerPayloads.length > 0) {
        const { error: brokerErr } = await db
          .from('broker_quality_scores')
          .insert(brokerPayloads)
        if (brokerErr) {
          result.errors.push({ user_id: uid, error: `broker_quality_scores: ${brokerErr.message}` })
        } else {
          result.broker_scores_written += brokerPayloads.length
        }
      }

      // ── 2. Attribute rows to strategies (3-hop join) ──────────────
      const { data: attribData } = await db
        .from('shadow_executions')
        .select(`
          created_at, closed_at, follower_pnl, actual_status, slippage_pct, pnl_drift_pct,
          copy_trade:copy_trades (
            subscription:strategy_subscriptions (
              strategy:published_strategies ( id, name )
            )
          )
        `)
        .eq('user_id', uid)
        .not('copy_trade_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5_000)

      const strategyRows = ((attribData ?? []) as AttribRow[])
        .map(r => {
          const s = r.copy_trade?.subscription?.strategy
          if (!s?.id) return null
          return {
            strategy_id:   s.id,
            strategy_name: s.name,
            follower_pnl:  r.follower_pnl,
            closed_at:     r.closed_at,
            created_at:    r.created_at,
            actual_status: r.actual_status,
            slippage_pct:  r.slippage_pct,
            pnl_drift_pct: r.pnl_drift_pct,
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      const stratReport = aggregateStrategyPerformance(strategyRows)
      const gradedStrats = stratReport.strategies.filter((s: StrategyMetrics) => !s.collecting_data)

      // ── 3. strategy_validation_scores ─────────────────────────────
      interface StratPayload {
        user_id:              string
        strategy_name:        string
        window_start:         string
        window_end:           string
        sample_size:          number
        win_rate_pct:         number | null
        profit_factor:        number | null
        sharpe:               number | null
        sortino:              number | null
        calmar:               number | null
        max_drawdown:         number | null
        max_drawdown_pct:     number | null
        avg_r_multiple:       number | null
        expected_value:       number | null
        confidence_score:     number | null
        readiness_score:      number | null
        qualification_status: string | null
      }
      const stratPayloads: StratPayload[] = gradedStrats.map((s: StrategyMetrics) => ({
        user_id:              uid,
        strategy_name:        s.strategy_name,
        window_start:         windowStart,
        window_end:           windowEnd,
        sample_size:          s.sample_size,
        win_rate_pct:         s.win_rate_pct,
        profit_factor:        s.profit_factor,
        sharpe:               s.sharpe,
        sortino:              s.sortino,
        // calmar is computed on the validation-analytics surface but
        // not exposed on StrategyMetrics yet; leave null (schema allows).
        calmar:               null,
        max_drawdown:         s.max_drawdown,
        // max_drawdown_pct expressed against net_pnl when both known
        max_drawdown_pct:     (s.max_drawdown != null && s.net_pnl != null && s.net_pnl !== 0)
                                ? Math.abs(s.max_drawdown / s.net_pnl) * 100 : null,
        avg_r_multiple:       null,   // not collected in shadow-only path yet
        expected_value:       s.expectancy,
        confidence_score:     s.confidence_score,
        readiness_score:      null,   // filled below from coach review
        qualification_status: null,   // filled below from coach review
      }))

      // ── 4. ai_strategy_reviews ────────────────────────────────────
      const reviews = reviewAllStrategiesForValidation(gradedStrats)
      const reviewById = new Map<string, ValidationCoachReview>()
      for (const r of reviews) reviewById.set(r.strategy_name, r)

      // Backfill readiness + qualification_status from the coach.
      for (const p of stratPayloads) {
        const r = reviewById.get(p.strategy_name)
        if (r) {
          p.readiness_score      = r.readiness_score
          p.qualification_status = r.recommendation
        }
      }

      if (stratPayloads.length > 0) {
        const { error: stratErr } = await db
          .from('strategy_validation_scores')
          .insert(stratPayloads)
        if (stratErr) {
          result.errors.push({ user_id: uid, error: `strategy_validation_scores: ${stratErr.message}` })
        } else {
          result.strategy_scores_written += stratPayloads.length
        }
      }

      const reviewPayloads = reviews.map(r => ({
        user_id:         uid,
        strategy_name:   r.strategy_name,
        overall_grade:   r.overall_grade,
        readiness_score: r.readiness_score,
        recommendation:  r.recommendation,
        whats_working:   r.whats_working.join('\n'),
        whats_failing:   r.whats_failing.join('\n'),
        whats_to_fix:    r.whats_to_fix.join('\n'),
        risk_assessment: r.risk_assessment,
        reviewer:        'algospherequant_coach_v2',
      }))

      if (reviewPayloads.length > 0) {
        const { error: reviewErr } = await db
          .from('ai_strategy_reviews')
          .insert(reviewPayloads)
        if (reviewErr) {
          result.errors.push({ user_id: uid, error: `ai_strategy_reviews: ${reviewErr.message}` })
        } else {
          result.ai_reviews_written += reviewPayloads.length
        }
      }

      // ── 5. validation_milestones (only EARNED) ────────────────────
      const milestones = deriveMilestones({
        closedTrades: closed.map(r => ({
          follower_pnl: r.follower_pnl as number,
          closed_at:    r.closed_at,
        })),
        brokerQuality,
        strategies:   gradedStrats,
        coachReviews: reviews,
      })

      // Diff against existing — the unique index would reject dupes
      // but pre-filtering avoids the conflict noise.
      const { data: existing } = await db
        .from('validation_milestones')
        .select('milestone_kind')
        .eq('user_id', uid)

      const existingKinds = new Set<MilestoneKind>(
        ((existing ?? []) as Array<{ milestone_kind: MilestoneKind }>).map(e => e.milestone_kind),
      )

      const newMilestones = milestones.achievements
        .filter(a => a.earned && !existingKinds.has(a.kind))
        .map(a => ({
          user_id:        uid,
          milestone_kind: a.kind,
          strategy_name:  null,
          broker:         null,
          metadata:       {
            criterion:    a.criterion,
            label:        a.label,
            progress_label: a.progress_label,
          },
        }))

      if (newMilestones.length > 0) {
        const { error: msErr } = await db
          .from('validation_milestones')
          .insert(newMilestones)
        if (msErr) {
          result.errors.push({ user_id: uid, error: `validation_milestones: ${msErr.message}` })
        } else {
          result.milestones_inserted += newMilestones.length
        }
      }
    } catch (e) {
      result.errors.push({
        user_id: uid,
        error:   e instanceof Error ? e.message : String(e),
      })
    }
  }

  return result
}
