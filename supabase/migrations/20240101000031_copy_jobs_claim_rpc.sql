-- ============================================================
-- AlgoSphere — Copy-Trading queue claim/reclaim RPCs
-- Migration: 20240101000031_copy_jobs_claim_rpc.sql
--
-- The copy-engine workers run through PostgREST (supabase-py), which
-- cannot express `FOR UPDATE SKIP LOCKED`. These SECURITY DEFINER
-- functions expose the atomic claim/reclaim primitives the durable
-- queue needs:
--
--   claim_signal_event(worker)        — orchestrator grabs ONE pending
--                                       bus event, flips it to 'planning'.
--   claim_copy_jobs(worker, limit)    — executor grabs a BATCH of queued
--                                       jobs via SKIP LOCKED, flips to
--                                       'claimed', bumps attempts.
--   reclaim_stale_copy_jobs(lease_s)  — reconciler/janitor returns jobs
--                                       whose worker died mid-flight back
--                                       to 'queued' (or 'failed' once
--                                       max_attempts is exhausted).
--
-- All are idempotent-safe and concurrency-safe: SKIP LOCKED guarantees
-- no two workers ever claim the same row. service_role executes them
-- (workers authenticate with the service key).
-- ============================================================

-- 1. Orchestrator: claim one pending bus event ------------------------
CREATE OR REPLACE FUNCTION public.claim_signal_event(p_worker TEXT)
RETURNS SETOF public.signal_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.signal_events SET
    status = 'planning'
  WHERE id = (
    SELECT id FROM public.signal_events
    WHERE status = 'pending'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING *;
END;
$$;

-- 2. Executor: claim a batch of queued jobs ---------------------------
CREATE OR REPLACE FUNCTION public.claim_copy_jobs(p_worker TEXT, p_limit INT)
RETURNS SETOF public.copy_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.copy_jobs SET
    status     = 'claimed',
    claimed_by = p_worker,
    claimed_at = NOW(),
    attempts   = attempts + 1
  WHERE id IN (
    SELECT id FROM public.copy_jobs
    WHERE status = 'queued' AND available_at <= NOW()
    ORDER BY available_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(p_limit, 1)
  )
  RETURNING *;
END;
$$;

-- 3. Janitor: reclaim jobs whose worker died mid-flight ---------------
-- A 'claimed'/'risk_check'/'allocating'/'routing'/'submitted' job whose
-- claim is older than the lease is presumed orphaned. If it still has
-- retries left, return it to 'queued' with a short backoff; otherwise
-- mark it 'failed' so it surfaces in reconciliation instead of hanging.
CREATE OR REPLACE FUNCTION public.reclaim_stale_copy_jobs(p_lease_seconds INT DEFAULT 120)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH stale AS (
    SELECT id FROM public.copy_jobs
    WHERE status IN ('claimed','risk_check','allocating','routing','submitted')
      AND claimed_at IS NOT NULL
      AND claimed_at < NOW() - make_interval(secs => p_lease_seconds)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.copy_jobs j SET
    status       = CASE WHEN j.attempts >= j.max_attempts THEN 'failed' ELSE 'queued' END,
    claimed_by   = NULL,
    claimed_at   = NULL,
    available_at = NOW() + make_interval(secs => LEAST(60, 5 * j.attempts)),
    last_error   = COALESCE(j.last_error, 'reclaimed: worker lease expired')
  FROM stale
  WHERE j.id = stale.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Workers authenticate with the service key; grant execute accordingly.
GRANT EXECUTE ON FUNCTION public.claim_signal_event(TEXT)        TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_copy_jobs(TEXT, INT)      TO service_role;
GRANT EXECUTE ON FUNCTION public.reclaim_stale_copy_jobs(INT)    TO service_role;
