-- ============================================================
-- AlgoSphere — Observability & Durability Foundation
-- Migration: 20240101000032_observability_foundation.sql
--
-- Phase-1 production hardening, load-bearing layer. Adds:
--   • trace_id threaded signal_events → copy_jobs → execution_events
--     (end-to-end signal-to-execution traceability). The bus mints the
--     trace; the orchestrator propagates it; the executor stamps it on
--     the order. execution_events join via client_order_id = copy_<job>.
--   • copy_jobs_dlq — a real dead-letter queue with failure
--     categorization, a job snapshot for forensics, and replay lineage.
--   • dead_letter_copy_job() / replay_dlq_job() — atomic, idempotent,
--     replay-safe primitives (SECURITY DEFINER, service_role only).
--
-- Strictly additive. No column dropped, no row rewritten, no trading
-- table touched destructively. Backward compatible: existing inserts
-- that omit trace_id get one via DEFAULT (signal_events) or NULL
-- (copy_jobs/execution_events, backfilled by the workers going forward).
-- ============================================================

-- 1. Trace propagation columns ----------------------------------------
-- signal_events is the origin of a trace — every bus event auto-mints one
-- so even manual/legacy inserts are traceable.
ALTER TABLE public.signal_events
  ADD COLUMN IF NOT EXISTS trace_id UUID NOT NULL DEFAULT gen_random_uuid();

-- copy_jobs carries the trace forward (set by the orchestrator from the
-- originating signal_event). Nullable so pre-existing rows are valid.
ALTER TABLE public.copy_jobs
  ADD COLUMN IF NOT EXISTS trace_id UUID;

-- execution_events: additive trace column for future direct writers.
-- Until adapters populate it, traceability holds via the join
-- client_order_id = 'copy_' || copy_jobs.id → copy_jobs.trace_id.
ALTER TABLE public.execution_events
  ADD COLUMN IF NOT EXISTS trace_id UUID;

CREATE INDEX IF NOT EXISTS idx_copy_jobs_trace
  ON public.copy_jobs (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exec_events_trace
  ON public.execution_events (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_events_trace
  ON public.signal_events (trace_id);

-- 2. Dead-letter queue ------------------------------------------------
-- A copy_job that exhausts its retries (or hits a non-retryable engine
-- error) is dead-lettered here: the live queue stays clean, the failure
-- is categorized + snapshotted, and an operator can replay it safely.

CREATE TABLE IF NOT EXISTS public.copy_jobs_dlq (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_job_id  UUID,                              -- the copy_jobs.id that died
  signal_event_id  UUID,
  subscription_id  UUID,
  follower_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  leader_id        UUID,
  broker           TEXT,
  trace_id         UUID,
  failure_category TEXT NOT NULL DEFAULT 'unknown' CHECK (failure_category IN (
                     'broker_rejection','broker_timeout','engine_error',
                     'decrypt_error','allocation_error','retry_exhausted','unknown')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  job_snapshot     JSONB NOT NULL DEFAULT '{}',       -- enough to rebuild a fresh job
  -- Replay lineage.
  replay_of        UUID REFERENCES public.copy_jobs_dlq(id) ON DELETE SET NULL,
  replayed_at      TIMESTAMPTZ,
  replay_job_id    UUID,                              -- copy_jobs.id created/reset on replay
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlq_follower
  ON public.copy_jobs_dlq (follower_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_unreplayed
  ON public.copy_jobs_dlq (failure_category, created_at DESC)
  WHERE replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dlq_trace
  ON public.copy_jobs_dlq (trace_id) WHERE trace_id IS NOT NULL;

ALTER TABLE public.copy_jobs_dlq ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dlq_users_read"
  ON public.copy_jobs_dlq FOR SELECT
  USING (follower_id = auth.uid() OR leader_id = auth.uid());
CREATE POLICY "dlq_system_write"
  ON public.copy_jobs_dlq FOR ALL USING (auth.role() = 'service_role');

-- 3. dead_letter_copy_job() — atomic move to DLQ ----------------------
-- Snapshots the job, inserts a DLQ row, and marks the live job 'failed'
-- in one transaction. Returns the new DLQ id.
CREATE OR REPLACE FUNCTION public.dead_letter_copy_job(
  p_job_id UUID, p_category TEXT, p_error TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  j        public.copy_jobs%ROWTYPE;
  v_dlq_id UUID;
BEGIN
  SELECT * INTO j FROM public.copy_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.copy_jobs_dlq (
    original_job_id, signal_event_id, subscription_id, follower_id,
    leader_id, broker, trace_id, failure_category, attempts, last_error,
    job_snapshot
  ) VALUES (
    j.id, j.signal_event_id, j.subscription_id, j.follower_id,
    j.leader_id, j.broker, j.trace_id,
    COALESCE(NULLIF(p_category,''), 'unknown'), j.attempts, LEFT(p_error, 1000),
    jsonb_build_object(
      'signal_event_id', j.signal_event_id,
      'subscription_id', j.subscription_id,
      'follower_id',     j.follower_id,
      'leader_id',       j.leader_id,
      'broker',          j.broker,
      'trace_id',        j.trace_id
    )
  ) RETURNING id INTO v_dlq_id;

  UPDATE public.copy_jobs
    SET status = 'failed', last_error = LEFT(p_error, 500)
    WHERE id = p_job_id;

  RETURN v_dlq_id;
END;
$$;

-- 4. replay_dlq_job() — idempotent, replay-safe -----------------------
-- Re-activates the work. Prefers resetting the original job row (honors
-- UNIQUE(signal_event_id, subscription_id)); if it was deleted, rebuilds
-- from the snapshot. Idempotent: a second call returns the same job id
-- and never double-enqueues.
CREATE OR REPLACE FUNCTION public.replay_dlq_job(p_dlq_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d          public.copy_jobs_dlq%ROWTYPE;
  v_exists   BOOLEAN;
  v_new_id   UUID;
BEGIN
  SELECT * INTO d FROM public.copy_jobs_dlq WHERE id = p_dlq_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- Already replayed → idempotent no-op, return prior job id.
  IF d.replayed_at IS NOT NULL THEN
    RETURN d.replay_job_id;
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.copy_jobs WHERE id = d.original_job_id)
    INTO v_exists;

  IF v_exists THEN
    -- Reset the original row back into the queue.
    UPDATE public.copy_jobs SET
      status='queued', attempts=0, claimed_by=NULL, claimed_at=NULL,
      available_at=NOW(), last_error=NULL, risk_passed_at=NULL, risk_reason=NULL
      WHERE id = d.original_job_id;
    v_new_id := d.original_job_id;
  ELSE
    -- Rebuild from snapshot (original was purged). Honor idempotency
    -- against the unique (signal_event_id, subscription_id) key.
    INSERT INTO public.copy_jobs (
      signal_event_id, subscription_id, follower_id, leader_id, broker,
      trace_id, status
    ) VALUES (
      (d.job_snapshot->>'signal_event_id')::uuid,
      (d.job_snapshot->>'subscription_id')::uuid,
      (d.job_snapshot->>'follower_id')::uuid,
      NULLIF(d.job_snapshot->>'leader_id','')::uuid,
      d.job_snapshot->>'broker',
      NULLIF(d.job_snapshot->>'trace_id','')::uuid,
      'queued'
    )
    ON CONFLICT (signal_event_id, subscription_id) DO UPDATE
      SET status='queued', attempts=0, claimed_by=NULL, claimed_at=NULL,
          available_at=NOW(), last_error=NULL
    RETURNING id INTO v_new_id;
  END IF;

  UPDATE public.copy_jobs_dlq
    SET replayed_at = NOW(), replay_job_id = v_new_id
    WHERE id = p_dlq_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dead_letter_copy_job(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.replay_dlq_job(UUID)                   TO service_role;

-- ============================================================
-- After this migration:
--   • every signal_events row has a trace_id; the orchestrator copies it
--     onto each copy_jobs row; the executor passes it to the engine.
--   • the executor dead-letters retry-exhausted / non-retryable jobs via
--     dead_letter_copy_job(); operators replay via replay_dlq_job() or the
--     dlq.py CLI — idempotent and replay-safe.
-- ============================================================
