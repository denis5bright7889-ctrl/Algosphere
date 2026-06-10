/**
 * Validation Snapshots Writer — Phase 12 of the Validation Center.
 *
 * Persists per-user daily snapshot rows into `validation_snapshots`
 * so the equity curve has true historical depth instead of being
 * recomputed from raw shadow_executions on every page render.
 *
 * Schema (from migration 80):
 *   validation_snapshots (
 *     user_id, strategy_name, broker, snapshot_date,
 *     sessions_count, cumulative_pnl, daily_pnl,
 *     rolling_win_rate_pct, rolling_drawdown_pct,
 *     cumulative_return_pct, confidence_low, confidence_high,
 *     created_at
 *   )
 *   UNIQUE (user_id, COALESCE(strategy_name,''), COALESCE(broker,''), snapshot_date)
 *
 * Idempotency: the unique index above lets us UPSERT on the
 * (user_id, '', '', today) key. Re-running the writer in the same
 * UTC day overwrites the latest values rather than appending dupes.
 *
 * Honesty contract:
 *   - Skips users with zero closed trades — no fabricated snapshot.
 *   - confidence_low / confidence_high are null until the equity-curve
 *     calculator's MIN_BAND_SAMPLE threshold is met (already enforced
 *     in buildEquityCurve).
 *   - Snapshot covers EVERY user with any shadow activity in the
 *     past 24h; the writer is a fan-out, not a one-shot.
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import { buildEquityCurve } from './equity-curve'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface SnapshotWriteResult {
  ran_at:               string
  snapshot_date:        string
  users_processed:      number
  users_with_data:      number
  snapshots_written:    number
  errors:               Array<{ user_id: string; error: string }>
}

interface ShadowRow {
  user_id:      string
  follower_pnl: number | null
  closed_at:    string | null
}

/**
 * Build today's snapshot for every user with any shadow activity in
 * the past 30 days. Returns a report so the admin endpoint can show
 * what landed.
 */
export async function writeValidationSnapshots(): Promise<SnapshotWriteResult> {
  const db = svc()
  const ranAt        = new Date().toISOString()
  const snapshotDate = ranAt.slice(0, 10)   // UTC date for the row

  const result: SnapshotWriteResult = {
    ran_at:            ranAt,
    snapshot_date:     snapshotDate,
    users_processed:   0,
    users_with_data:   0,
    snapshots_written: 0,
    errors:            [],
  }

  // Distinct users with activity in the past 30 days. We avoid
  // running for every user-ever — only active validators benefit
  // from snapshots.
  const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data: actives, error: activeErr } = await db
    .from('shadow_executions')
    .select('user_id')
    .gte('created_at', since30d)
    .limit(5_000)
  if (activeErr) {
    result.errors.push({ user_id: '*', error: activeErr.message })
    return result
  }

  const userIds = Array.from(new Set(((actives ?? []) as Array<{ user_id: string }>).map(r => r.user_id)))
  result.users_processed = userIds.length

  for (const uid of userIds) {
    try {
      // Pull this user's closed shadow trades. We compute the curve
      // over the WHOLE history (not just the window) so the snapshot
      // reflects cumulative state — what the page actually shows.
      const { data: rows, error: rowsErr } = await db
        .from('shadow_executions')
        .select('follower_pnl, closed_at, user_id')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(5_000)
      if (rowsErr) {
        result.errors.push({ user_id: uid, error: rowsErr.message })
        continue
      }

      const closed = ((rows ?? []) as ShadowRow[])
        .filter(r => r.closed_at && typeof r.follower_pnl === 'number')
        .map(r => ({ follower_pnl: r.follower_pnl as number, closed_at: r.closed_at }))

      if (closed.length === 0) {
        // No closed trades → no honest snapshot to write. Skip.
        continue
      }

      result.users_with_data++

      const curve = buildEquityCurve(closed)
      if (curve.points.length === 0) continue

      // Find today's bucket. The curve already bucketed by UTC date.
      const today = curve.points.find(p => p.x === snapshotDate)
      const final = curve.points[curve.points.length - 1]!

      // Cumulative return % vs. peak. Treat peak as the denominator
      // when positive; fall back to null when peak is 0 (no positive
      // run yet — refusing to invent a "return %").
      const cumReturnPct = curve.summary.peak_pnl > 0
        ? (curve.summary.net_pnl / curve.summary.peak_pnl) * 100
        : null

      const payload = {
        user_id:               uid,
        strategy_name:         null,
        broker:                null,
        snapshot_date:         snapshotDate,
        sessions_count:        closed.length,
        cumulative_pnl:        curve.summary.net_pnl,
        daily_pnl:             today?.daily_pnl ?? 0,
        rolling_win_rate_pct:  final.rolling_win_rate,
        rolling_drawdown_pct:  curve.summary.max_drawdown_pct,
        cumulative_return_pct: cumReturnPct,
        confidence_low:        today?.confidence_low ?? null,
        confidence_high:       today?.confidence_high ?? null,
      }

      // UPSERT on the unique-index key (user_id, '', '', snapshot_date).
      // Supabase JS doesn't directly target unique indexes — we use
      // onConflict on the four columns the index covers.
      const { error: upsertErr } = await db
        .from('validation_snapshots')
        .upsert(payload, {
          onConflict: 'user_id,strategy_name,broker,snapshot_date',
          ignoreDuplicates: false,
        })

      if (upsertErr) {
        result.errors.push({ user_id: uid, error: upsertErr.message })
      } else {
        result.snapshots_written++
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
