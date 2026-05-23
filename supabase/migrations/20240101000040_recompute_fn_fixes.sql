-- ============================================================
-- AlgoSphere — Fix two recompute functions (forward fix)
-- Migration: 20240101000040_recompute_fn_fixes.sql
--
-- The validator (apps/copy-engine/tools/validate_schema.py) caught two
-- runtime SQL errors against live Postgres that compile/eyeball checks
-- could not:
--
--   recompute_copy_health (033)
--     ERROR: function round(double precision, integer) does not exist
--     — the health_score sum is double precision (AVG / PERCENTILE_CONT
--       are double), and two-arg round() requires numeric. Fix: cast the
--       summed expression to ::numeric before ROUND(..., 2).
--
--   recompute_portfolio_exposure (034)
--     ERROR: column "notional" does not exist
--     — the per_user CTE referenced `notional` (and COUNT(*) counted
--       symbol-groups, not positions) while its subquery only exposed
--       `sym_notional`. Fix: aggregate sym_notional and a per-symbol
--       sym_count for a correct open_positions total.
--
-- CREATE OR REPLACE on both — supersedes the definitions in 033/034 for
-- this (already-migrated) DB and for fresh deploys alike. No data change.
-- ============================================================

-- 1. recompute_copy_health — numeric cast on the score ----------------
CREATE OR REPLACE FUNCTION public.recompute_copy_health(p_window_hours INTEGER DEFAULT 24)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH win AS (
    SELECT cj.subscription_id, cj.follower_id, cj.leader_id,
           cj.status, cj.filled_at, se.created_at AS signalled_at
      FROM public.copy_jobs cj
      JOIN public.signal_events se ON se.id = cj.signal_event_id
     WHERE cj.created_at > NOW() - make_interval(hours => p_window_hours)
  ),
  agg AS (
    SELECT
      subscription_id,
      MAX(follower_id::text)::uuid AS follower_id,
      MAX(leader_id::text)::uuid   AS leader_id,
      COUNT(*) FILTER (WHERE status IN ('filled','partial','rejected','skipped','failed')) AS total_jobs,
      COUNT(*) FILTER (WHERE status IN ('filled','partial'))  AS filled,
      COUNT(*) FILTER (WHERE status = 'failed')               AS failed,
      COUNT(*) FILTER (WHERE status = 'rejected')             AS rejected,
      AVG(EXTRACT(EPOCH FROM (filled_at - signalled_at)) * 1000)
        FILTER (WHERE status IN ('filled','partial') AND filled_at IS NOT NULL) AS avg_lag_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (filled_at - signalled_at)) * 1000)
        FILTER (WHERE status IN ('filled','partial') AND filled_at IS NOT NULL) AS p95_lag_ms
    FROM win
    GROUP BY subscription_id
  ),
  scored AS (
    SELECT
      a.*,
      COALESCE((SELECT COUNT(*) FROM public.copy_reconciliation cr
                 WHERE cr.follower_id = a.follower_id AND cr.resolved_at IS NULL), 0) AS desync_open,
      CASE WHEN a.total_jobs > 0 THEN a.filled::numeric / a.total_jobs ELSE NULL END  AS fill_rate,
      CASE WHEN a.total_jobs > 0 THEN a.failed::numeric / a.total_jobs ELSE 0 END     AS failed_rate
    FROM agg a
  )
  INSERT INTO public.copy_health AS ch (
    subscription_id, follower_id, leader_id, window_hours,
    total_jobs, filled, failed, rejected, fill_rate,
    avg_lag_ms, p95_lag_ms, desync_open, failed_rate,
    health_score, health_label, updated_at
  )
  SELECT
    s.subscription_id, s.follower_id, s.leader_id, p_window_hours,
    s.total_jobs, s.filled, s.failed, s.rejected, ROUND(s.fill_rate, 4),
    ROUND(s.avg_lag_ms)::bigint, ROUND(s.p95_lag_ms)::bigint,
    s.desync_open, ROUND(s.failed_rate, 4),
    -- FIX: cast the (double-precision) composite to numeric before ROUND(.,2).
    CASE WHEN s.total_jobs = 0 THEN NULL ELSE GREATEST(0, LEAST(100, ROUND((
        40 * COALESCE(s.fill_rate, 0)
      + 25 * GREATEST(0, 1 - LEAST(COALESCE(s.p95_lag_ms, 0), 30000) / 30000.0)
      + 20 * (1 - LEAST(s.desync_open, 2) / 2.0)
      + 15 * (1 - COALESCE(s.failed_rate, 0))
    )::numeric, 2))) END AS health_score,
    CASE
      WHEN s.total_jobs = 0 THEN 'idle'
      ELSE (CASE
        WHEN (40*COALESCE(s.fill_rate,0) + 25*GREATEST(0,1-LEAST(COALESCE(s.p95_lag_ms,0),30000)/30000.0)
              + 20*(1-LEAST(s.desync_open,2)/2.0) + 15*(1-COALESCE(s.failed_rate,0))) >= 85 THEN 'excellent'
        WHEN (40*COALESCE(s.fill_rate,0) + 25*GREATEST(0,1-LEAST(COALESCE(s.p95_lag_ms,0),30000)/30000.0)
              + 20*(1-LEAST(s.desync_open,2)/2.0) + 15*(1-COALESCE(s.failed_rate,0))) >= 70 THEN 'good'
        WHEN (40*COALESCE(s.fill_rate,0) + 25*GREATEST(0,1-LEAST(COALESCE(s.p95_lag_ms,0),30000)/30000.0)
              + 20*(1-LEAST(s.desync_open,2)/2.0) + 15*(1-COALESCE(s.failed_rate,0))) >= 50 THEN 'degraded'
        ELSE 'poor' END)
    END AS health_label,
    NOW()
  FROM scored s
  ON CONFLICT (subscription_id) DO UPDATE SET
    follower_id  = EXCLUDED.follower_id,
    leader_id    = EXCLUDED.leader_id,
    window_hours = EXCLUDED.window_hours,
    total_jobs   = EXCLUDED.total_jobs,
    filled       = EXCLUDED.filled,
    failed       = EXCLUDED.failed,
    rejected     = EXCLUDED.rejected,
    fill_rate    = EXCLUDED.fill_rate,
    avg_lag_ms   = EXCLUDED.avg_lag_ms,
    p95_lag_ms   = EXCLUDED.p95_lag_ms,
    desync_open  = EXCLUDED.desync_open,
    failed_rate  = EXCLUDED.failed_rate,
    health_score = EXCLUDED.health_score,
    health_label = EXCLUDED.health_label,
    updated_at   = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 2. recompute_portfolio_exposure — correct the per_user CTE ----------
CREATE OR REPLACE FUNCTION public.recompute_portfolio_exposure(p_user_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH open_pos AS (
    SELECT follower_id,
           symbol,
           direction,
           COALESCE(follower_lot,0) * COALESCE(leader_entry,0) AS notional
      FROM public.copy_trades
     WHERE status IN ('mirrored','partial')
       AND (p_user_id IS NULL OR follower_id = p_user_id)
  ),
  per_user AS (
    -- FIX: aggregate the per-symbol rollup (sym_notional / sym_count);
    -- the previous version referenced open_pos.notional here (not in scope)
    -- and miscounted positions as symbol-groups.
    SELECT s.follower_id,
           SUM(s.sym_notional)                  AS total_notional,
           SUM(s.sym_count)                     AS open_positions,
           jsonb_object_agg(s.symbol, s.sym_notional) AS by_symbol,
           MAX(s.sym_notional)                  AS top_symbol_notional
    FROM (
      SELECT follower_id, symbol,
             SUM(notional) AS sym_notional,
             COUNT(*)      AS sym_count
        FROM open_pos GROUP BY follower_id, symbol
    ) s GROUP BY s.follower_id
  ),
  dir AS (
    SELECT follower_id,
           jsonb_build_object(
             'buy',  COALESCE(SUM(notional) FILTER (WHERE direction='buy'),0),
             'sell', COALESCE(SUM(notional) FILTER (WHERE direction='sell'),0)
           ) AS by_direction
      FROM open_pos GROUP BY follower_id
  ),
  pnl AS (
    SELECT follower_id,
           COALESCE(SUM(follower_pnl) FILTER (
             WHERE closed_at >= date_trunc('day', NOW())), 0)  AS daily_realized_pnl,
           COALESCE(SUM(follower_pnl), 0)                       AS cumulative_realized_pnl
      FROM public.copy_trades
     WHERE status = 'closed'
       AND (p_user_id IS NULL OR follower_id = p_user_id)
     GROUP BY follower_id
  ),
  merged AS (
    SELECT
      COALESCE(pu.follower_id, p.follower_id, d.follower_id)        AS user_id,
      COALESCE(pu.total_notional, 0)                               AS total_notional,
      COALESCE(pu.open_positions, 0)                               AS open_positions,
      COALESCE(pu.by_symbol, '{}'::jsonb)                          AS by_symbol,
      COALESCE(d.by_direction, '{}'::jsonb)                        AS by_direction,
      CASE WHEN COALESCE(pu.total_notional,0) > 0
           THEN ROUND(100 * pu.top_symbol_notional / pu.total_notional, 2)
           ELSE 0 END                                              AS largest_concentration_pct,
      COALESCE(p.daily_realized_pnl, 0)                            AS daily_realized_pnl,
      COALESCE(p.cumulative_realized_pnl, 0)                       AS cumulative_realized_pnl
    FROM per_user pu
    FULL JOIN dir d ON d.follower_id = pu.follower_id
    FULL JOIN pnl p ON p.follower_id = COALESCE(pu.follower_id, d.follower_id)
  )
  INSERT INTO public.portfolio_exposure AS pe (
    user_id, total_notional, by_symbol, by_direction, open_positions,
    largest_concentration_pct, daily_realized_pnl, cumulative_realized_pnl,
    peak_realized_pnl, drawdown_usd, updated_at
  )
  SELECT
    m.user_id, m.total_notional, m.by_symbol, m.by_direction, m.open_positions,
    m.largest_concentration_pct, m.daily_realized_pnl, m.cumulative_realized_pnl,
    GREATEST(m.cumulative_realized_pnl, 0)            AS peak_realized_pnl,
    GREATEST(0 - m.cumulative_realized_pnl, 0)        AS drawdown_usd,
    NOW()
  FROM merged m
  WHERE m.user_id IS NOT NULL
  ON CONFLICT (user_id) DO UPDATE SET
    total_notional            = EXCLUDED.total_notional,
    by_symbol                 = EXCLUDED.by_symbol,
    by_direction              = EXCLUDED.by_direction,
    open_positions            = EXCLUDED.open_positions,
    largest_concentration_pct = EXCLUDED.largest_concentration_pct,
    daily_realized_pnl        = EXCLUDED.daily_realized_pnl,
    cumulative_realized_pnl   = EXCLUDED.cumulative_realized_pnl,
    peak_realized_pnl         = GREATEST(pe.peak_realized_pnl, EXCLUDED.cumulative_realized_pnl),
    drawdown_usd              = GREATEST(0, GREATEST(pe.peak_realized_pnl, EXCLUDED.cumulative_realized_pnl)
                                            - EXCLUDED.cumulative_realized_pnl),
    updated_at                = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_copy_health(INTEGER)        TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_portfolio_exposure(UUID)    TO service_role;
