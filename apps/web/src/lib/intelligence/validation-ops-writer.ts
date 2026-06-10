/**
 * Validation Ops Writer — Phase 12 writers 6, 7, 8 (final batch).
 *
 * Populates the last three Phase-12 tables:
 *   • strategy_rankings              — top/worst/consistent/risky per user
 *   • shadow_sessions                — one logical session per (user,
 *                                       strategy, broker, UTC day) when
 *                                       there's any shadow activity
 *   • strategy_qualification_history — append-only state-transition log
 *                                       (e.g. "Watchlist → Approve")
 *
 * Honesty contract:
 *   - Rankings only emitted when ≥2 graded strategies exist per user
 *     (one-strategy "leaderboard" is dishonest).
 *   - Sessions only created from days with actual shadow_executions
 *     activity. No empty placeholder rows.
 *   - Qualification history only records TRANSITIONS — if a strategy's
 *     current recommendation matches the latest history row, nothing
 *     is appended. Avoids polluting the audit log with no-op rows.
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  aggregateStrategyPerformance, type StrategyMetrics,
} from './strategy-performance-aggregate'
import { reviewAllStrategiesForValidation } from './validation-coach'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface OpsWriteResult {
  ran_at:                       string
  users_processed:              number
  users_with_data:              number
  rankings_written:             number
  sessions_written:             number
  qualification_transitions:    number
  errors:                       Array<{ user_id: string; error: string }>
}

interface AttribRow {
  created_at:     string
  closed_at:      string | null
  follower_pnl:   number | null
  actual_status:  string
  slippage_pct:   number | null
  pnl_drift_pct:  number | null
  broker?:        string | null
  copy_trade?: {
    subscription?: {
      strategy?: { id: string; name: string } | null
    } | null
  } | null
}

const LOOKBACK_DAYS = 30

export async function writeValidationOps(): Promise<OpsWriteResult> {
  const db = svc()
  const ranAt = new Date().toISOString()
  const windowStart = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()

  const result: OpsWriteResult = {
    ran_at:                    ranAt,
    users_processed:           0,
    users_with_data:           0,
    rankings_written:          0,
    sessions_written:          0,
    qualification_transitions: 0,
    errors:                    [],
  }

  // Active users — anyone with shadow activity in window
  const { data: actives, error: activeErr } = await db
    .from('shadow_executions')
    .select('user_id')
    .gte('created_at', windowStart)
    .limit(5_000)
  if (activeErr) {
    result.errors.push({ user_id: '*', error: activeErr.message })
    return result
  }
  const userIds = Array.from(new Set(((actives ?? []) as Array<{ user_id: string }>).map(r => r.user_id)))
  result.users_processed = userIds.length

  for (const uid of userIds) {
    try {
      // Pull this user's attributed rows (3-hop join). We also pull
      // broker so sessions can group by (user, strategy, broker, day).
      const { data: attribData } = await db
        .from('shadow_executions')
        .select(`
          created_at, closed_at, follower_pnl, actual_status,
          slippage_pct, pnl_drift_pct, broker,
          copy_trade:copy_trades (
            subscription:strategy_subscriptions (
              strategy:published_strategies ( id, name )
            )
          )
        `)
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(5_000)

      const attribRows = (attribData ?? []) as AttribRow[]
      if (attribRows.length === 0) continue
      result.users_with_data++

      // Strategy aggregate (for rankings + qualification history)
      const strategyRows = attribRows
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

      const report = aggregateStrategyPerformance(strategyRows)
      const graded = report.strategies.filter((s: StrategyMetrics) => !s.collecting_data)

      // ── strategy_rankings ─────────────────────────────────────────
      if (report.rankings.length > 0) {
        const rankingRows: Array<{
          user_id: string; strategy_name: string; category: string;
          rank: number; score: number; window_start: string; window_end: string;
        }> = []
        for (const r of report.rankings) {
          for (let i = 0; i < r.entries.length; i++) {
            const e = r.entries[i]!
            rankingRows.push({
              user_id:       uid,
              strategy_name: e.strategy_name,
              category:      r.category,
              rank:          i + 1,
              score:         e.score,
              window_start:  windowStart,
              window_end:    ranAt,
            })
          }
        }
        if (rankingRows.length > 0) {
          const { error: rankErr } = await db.from('strategy_rankings').insert(rankingRows)
          if (rankErr) {
            result.errors.push({ user_id: uid, error: `strategy_rankings: ${rankErr.message}` })
          } else {
            result.rankings_written += rankingRows.length
          }
        }
      }

      // ── shadow_sessions ───────────────────────────────────────────
      // Bucket by (strategy, broker, UTC day). For each bucket
      // compute trade_count + win_count + total_pnl.
      type SessKey = string
      type SessBucket = {
        strategy_name: string | null
        broker:        string | null
        day:           string
        trade_count:   number
        win_count:     number
        total_pnl:     number
        earliest:      string
        latest:        string | null
      }
      const buckets = new Map<SessKey, SessBucket>()
      for (const r of attribRows) {
        if (!r.closed_at) continue   // open trades don't form sessions
        const day = r.closed_at.slice(0, 10)
        const strat = r.copy_trade?.subscription?.strategy?.name ?? null
        const broker = (r.broker ?? null)
        const key = `${strat ?? ''}|${broker ?? ''}|${day}`
        const pnl = typeof r.follower_pnl === 'number' ? r.follower_pnl : 0
        const win = pnl > 0
        const b = buckets.get(key)
        if (b) {
          b.trade_count += 1
          if (win) b.win_count += 1
          b.total_pnl += pnl
          if (r.created_at < b.earliest) b.earliest = r.created_at
          if (!b.latest || r.closed_at > b.latest) b.latest = r.closed_at
        } else {
          buckets.set(key, {
            strategy_name: strat,
            broker,
            day,
            trade_count:   1,
            win_count:     win ? 1 : 0,
            total_pnl:     pnl,
            earliest:      r.created_at,
            latest:        r.closed_at,
          })
        }
      }

      if (buckets.size > 0) {
        const sessionRows = [...buckets.values()].map(b => ({
          user_id:       uid,
          strategy_name: b.strategy_name,
          broker:        b.broker,
          started_at:    b.earliest,
          ended_at:      b.latest,
          trade_count:   b.trade_count,
          win_count:     b.win_count,
          total_pnl:     Math.round(b.total_pnl * 100) / 100,
          status:        'closed' as const,
          metadata:      { day: b.day, source: 'validation_ops_writer' },
        }))
        // Append-only — shadow_sessions has no unique index, so each
        // writer run creates a fresh row per bucket. Trending across
        // sessions remains queryable; consumers de-dup on (user_id,
        // strategy_name, broker, started_at, ended_at) if they need to.
        const { error: sessErr } = await db.from('shadow_sessions').insert(sessionRows)
        if (sessErr) {
          result.errors.push({ user_id: uid, error: `shadow_sessions: ${sessErr.message}` })
        } else {
          result.sessions_written += sessionRows.length
        }
      }

      // ── strategy_qualification_history ────────────────────────────
      // Compare each graded strategy's CURRENT coach recommendation
      // against the LATEST history row. If they differ → append.
      if (graded.length > 0) {
        const reviews = reviewAllStrategiesForValidation(graded)
        const reviewByName = new Map<string, string>()  // name → recommendation
        for (const r of reviews) reviewByName.set(r.strategy_name, r.recommendation)

        // Pull latest history rows per strategy_name for this user.
        const { data: history } = await db
          .from('strategy_qualification_history')
          .select('strategy_name, to_stage, transitioned_at')
          .eq('user_id', uid)
          .order('transitioned_at', { ascending: false })

        const latestByStrategy = new Map<string, string>()
        for (const h of ((history ?? []) as Array<{ strategy_name: string; to_stage: string }>)) {
          if (!latestByStrategy.has(h.strategy_name)) {
            latestByStrategy.set(h.strategy_name, h.to_stage)
          }
        }

        const transitions: Array<{
          user_id: string; strategy_name: string;
          from_stage: string | null; to_stage: string; reason: string;
          metadata: Record<string, unknown>;
        }> = []
        for (const [name, rec] of reviewByName) {
          const prev = latestByStrategy.get(name) ?? null
          if (prev !== rec) {
            transitions.push({
              user_id:       uid,
              strategy_name: name,
              from_stage:    prev,
              to_stage:      rec,
              reason:        prev === null
                               ? 'First qualification entry'
                               : `Transitioned by validation_ops_writer (${prev} → ${rec})`,
              metadata:      { source: 'validation_ops_writer', ran_at: ranAt },
            })
          }
        }
        if (transitions.length > 0) {
          const { error: histErr } = await db.from('strategy_qualification_history').insert(transitions)
          if (histErr) {
            result.errors.push({ user_id: uid, error: `qualification_history: ${histErr.message}` })
          } else {
            result.qualification_transitions += transitions.length
          }
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
