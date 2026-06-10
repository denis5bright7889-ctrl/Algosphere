-- 20240101000082_validation_ops_infrastructure.sql
--
-- Operational infrastructure for the Validation Center:
--   1. writer_runs       — persistent log of every writer execution
--   2. writer_dlq        — dead-letter queue for failed writes
--   3. strategy_state    — current state-machine position per (user, strategy)
--   4. forensics_jobs    — queue for forensics backfill batches
--
-- All RLS-enabled. writer_runs + writer_dlq are admin-only (no user
-- policy). strategy_state is self-only SELECT. forensics_jobs is
-- admin-only.

BEGIN;

-- 1 — writer_runs: every cron/admin invocation of a writer logs here
CREATE TABLE IF NOT EXISTS public.writer_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  writer_name     TEXT NOT NULL,
  triggered_by    TEXT NOT NULL,    -- 'cron' | 'admin' | 'system'
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INT,
  rows_written    INT,
  errors_count    INT,
  result_summary  JSONB,
  outcome         TEXT NOT NULL DEFAULT 'running'
                    CHECK (outcome IN ('running', 'ok', 'partial', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_writer_runs_name_started
  ON public.writer_runs (writer_name, started_at DESC);
ALTER TABLE public.writer_runs ENABLE ROW LEVEL SECURITY;
-- No SELECT policy → only service role can read. Admin endpoints use
-- the service role; users never see this table.


-- 2 — writer_dlq: failed writes go here for retry/inspection
CREATE TABLE IF NOT EXISTS public.writer_dlq (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  writer_name     TEXT NOT NULL,
  run_id          UUID REFERENCES public.writer_runs(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  error_message   TEXT NOT NULL,
  error_context   JSONB,
  retry_count     INT NOT NULL DEFAULT 0,
  resolved        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_writer_dlq_unresolved
  ON public.writer_dlq (writer_name, created_at DESC) WHERE resolved = false;
ALTER TABLE public.writer_dlq ENABLE ROW LEVEL SECURITY;


-- 3 — strategy_state: current state-machine position per strategy
CREATE TABLE IF NOT EXISTS public.strategy_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_name   TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'OBSERVATION'
                    CHECK (state IN (
                      'OBSERVATION', 'WATCHLIST', 'QUALIFICATION',
                      'LIVE_ELIGIBLE', 'REJECTED'
                    )),
  entered_state_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, strategy_name)
);
CREATE INDEX IF NOT EXISTS idx_strategy_state_user_state
  ON public.strategy_state (user_id, state);
ALTER TABLE public.strategy_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ss_self" ON public.strategy_state;
CREATE POLICY "ss_self"
  ON public.strategy_state FOR SELECT USING (user_id = auth.uid());


-- 4 — forensics_jobs: queue for backfill batches
CREATE TABLE IF NOT EXISTS public.forensics_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shadow_execution_id UUID NOT NULL REFERENCES public.shadow_executions(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL DEFAULT 'backfill'
                    CHECK (reason IN ('backfill', 'engine_version_bump', 'manual')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,
  error           TEXT,
  UNIQUE (shadow_execution_id, reason)
);
CREATE INDEX IF NOT EXISTS idx_forensics_jobs_pending
  ON public.forensics_jobs (enqueued_at) WHERE status = 'pending';
ALTER TABLE public.forensics_jobs ENABLE ROW LEVEL SECURITY;

COMMIT;
