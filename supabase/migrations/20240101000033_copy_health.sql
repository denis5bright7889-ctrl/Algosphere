-- ============================================================
-- AlgoSphere — Follower lag + copy-health scoring (Phase 6)
-- Migration: 20240101000033_copy_health.sql
--
-- Adds the data + SQL to measure how well each follower's copy is
-- tracking its leader, at 10k-follower scale:
--   • copy_jobs.filled_at — exact fill timestamp so lag is accurate
--     (lag = filled_at − signal_events.created_at, the full
--      signal→fill latency a follower actually experiences).
--   • copy_health — one rolling-window scorecard per subscription:
--     fill rate, avg/p95 lag, open desyncs, failure rate, and a
--     composite 0–100 health_score + label.
--   • recompute_copy_health() — does the aggregation in SQL (cheap,
--     set-based) and upserts copy_health. The reconciler calls it on a
--     cadence; PostgREST can't express the GROUP BY + percentile, so it
--     lives server-side as a SECURITY DEFINER function.
--
-- Strictly additive. Backward compatible. No trading table altered
-- destructively; copy_health is derived/disposable (safe to TRUNCATE).
-- ============================================================

-- 1. Accurate fill timestamp on the job -------------------------------
ALTER TABLE public.copy_jobs
  ADD COLUMN IF NOT EXISTS filled_at TIMESTAMPTZ;

-- 2. copy_health scorecard --------------------------------------------
CREATE TABLE IF NOT EXISTS public.copy_health (
  subscription_id UUID PRIMARY KEY
                    REFERENCES public.strategy_subscriptions(id) ON DELETE CASCADE,
  follower_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  leader_id       UUID,
  window_hours    INTEGER NOT NULL DEFAULT 24,
  total_jobs      INTEGER NOT NULL DEFAULT 0,
  filled          INTEGER NOT NULL DEFAULT 0,
  failed          INTEGER NOT NULL DEFAULT 0,
  rejected        INTEGER NOT NULL DEFAULT 0,
  fill_rate       NUMERIC(5,4),       -- 0..1
  avg_lag_ms      BIGINT,
  p95_lag_ms      BIGINT,
  desync_open     INTEGER NOT NULL DEFAULT 0,
  failed_rate     NUMERIC(5,4),       -- 0..1
  health_score    NUMERIC(5,2),       -- 0..100, NULL when idle (no jobs in window)
  health_label    TEXT CHECK (health_label IN
                    ('excellent','good','degraded','poor','idle')),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copy_health_follower
  ON public.copy_health (follower_id, health_score);
CREATE INDEX IF NOT EXISTS idx_copy_health_leader
  ON public.copy_health (leader_id, health_score);

ALTER TABLE public.copy_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "copy_health_users_read"
  ON public.copy_health FOR SELECT
  USING (follower_id = auth.uid() OR leader_id = auth.uid());
CREATE POLICY "copy_health_system_write"
  ON public.copy_health FOR ALL USING (auth.role() = 'service_role');

-- 3. recompute_copy_health() — set-based aggregation + upsert ---------
-- Returns the number of subscriptions scored. Window-scoped so a one-off
-- bad day decays out of the score naturally.
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
    -- Composite 0..100: 40 fill + 25 lag + 20 desync + 15 reliability.
    -- Idle subscriptions (no terminal jobs) score NULL.
    CASE WHEN s.total_jobs = 0 THEN NULL ELSE GREATEST(0, LEAST(100, ROUND(
        40 * COALESCE(s.fill_rate, 0)
      + 25 * GREATEST(0, 1 - LEAST(COALESCE(s.p95_lag_ms, 0), 30000) / 30000.0)
      + 20 * (1 - LEAST(s.desync_open, 2) / 2.0)
      + 15 * (1 - COALESCE(s.failed_rate, 0))
    , 2))) END AS health_score,
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

GRANT EXECUTE ON FUNCTION public.recompute_copy_health(INTEGER) TO service_role;

-- ============================================================
-- The reconciler calls recompute_copy_health(24) on a cadence; the web
-- app reads copy_health for the follower's "copy health" widget and the
-- leader's per-follower sync table. health_label drives the UI badge.
-- ============================================================
