-- 20240101000083_auto_live_engine.sql
--
-- Auto-Live Engine infrastructure (Phases A, C, D, J, N of the
-- v1000000 spec). Adds:
--   1. signal_source + lifecycle_status columns on shadow_executions
--   2. position_lifecycle_history — append-only state log per position
--   3. signal_factory_runs        — every auto-signal-factory invocation
--   4. market_feed_status         — circuit-breaker state per provider
--   5. alert_queue                — pending alerts to dispatch
--   6. alert_channels             — per-user delivery config
--   7. recovery_logs              — auto-recovery actions taken

BEGIN;

-- 1 — Extend shadow_executions with provenance + lifecycle status
ALTER TABLE public.shadow_executions
  ADD COLUMN IF NOT EXISTS signal_source TEXT
    CHECK (signal_source IN (
      'user_strategy', 'validation_strategy', 'synthetic_validation', 'manual'
    ));

ALTER TABLE public.shadow_executions
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT
    CHECK (lifecycle_status IN (
      'OPEN', 'FILLED', 'PARTIAL', 'CLOSED', 'EXPIRED', 'SKIPPED'
    ));

CREATE INDEX IF NOT EXISTS idx_shadow_executions_signal_source
  ON public.shadow_executions (signal_source) WHERE signal_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shadow_executions_lifecycle_status
  ON public.shadow_executions (lifecycle_status) WHERE lifecycle_status IS NOT NULL;


-- 2 — Position lifecycle history (append-only state transitions)
CREATE TABLE IF NOT EXISTS public.position_lifecycle_history (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shadow_execution_id  UUID NOT NULL REFERENCES public.shadow_executions(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  from_state           TEXT,
  to_state             TEXT NOT NULL,
  reason               TEXT,
  metadata             JSONB DEFAULT '{}'::jsonb,
  transitioned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_position_lifecycle_user_time
  ON public.position_lifecycle_history (user_id, transitioned_at DESC);
ALTER TABLE public.position_lifecycle_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plh_self" ON public.position_lifecycle_history;
CREATE POLICY "plh_self"
  ON public.position_lifecycle_history FOR SELECT USING (user_id = auth.uid());


-- 3 — Signal-factory run log
CREATE TABLE IF NOT EXISTS public.signal_factory_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INT,
  signals_attempted INT NOT NULL DEFAULT 0,
  signals_ingested  INT NOT NULL DEFAULT 0,
  signals_skipped   INT NOT NULL DEFAULT 0,
  symbols_evaluated INT NOT NULL DEFAULT 0,
  rate_limited_users INT NOT NULL DEFAULT 0,
  result_summary  JSONB,
  outcome         TEXT NOT NULL DEFAULT 'running'
                    CHECK (outcome IN ('running', 'ok', 'partial', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_sfr_started
  ON public.signal_factory_runs (started_at DESC);
ALTER TABLE public.signal_factory_runs ENABLE ROW LEVEL SECURITY;
-- No SELECT policy → service-role only.


-- 4 — Market feed provider status (circuit breaker state)
CREATE TABLE IF NOT EXISTS public.market_feed_status (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,            -- 'binance' | 'coinbase' | 'twelvedata' | ...
  asset_class     TEXT NOT NULL,            -- 'crypto' | 'forex' | 'metals'
  state           TEXT NOT NULL DEFAULT 'closed'
                    CHECK (state IN ('closed', 'open', 'half_open')),
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_success_at  TIMESTAMPTZ,
  last_failure_at  TIMESTAMPTZ,
  last_error       TEXT,
  next_retry_at    TIMESTAMPTZ,
  total_requests   BIGINT NOT NULL DEFAULT 0,
  total_failures   BIGINT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, asset_class)
);
ALTER TABLE public.market_feed_status ENABLE ROW LEVEL SECURITY;


-- 5 — Alert queue (pending alerts to dispatch)
CREATE TABLE IF NOT EXISTS public.alert_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL
                    CHECK (kind IN (
                      'no_signals_24h', 'no_lifecycle_ticks', 'writer_failure',
                      'stale_positions', 'high_error_rate', 'circuit_breaker_open',
                      'recovery_action', 'state_transition_live_eligible'
                    )),
  severity        TEXT NOT NULL DEFAULT 'warn'
                    CHECK (severity IN ('info', 'warn', 'error', 'critical')),
  user_id         UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  body            TEXT,
  payload         JSONB DEFAULT '{}'::jsonb,
  dedupe_key      TEXT,            -- prevents firing the same alert twice
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'dispatched', 'failed', 'suppressed')),
  dispatched_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Dedupe via a generated column (immutable date_trunc on the date).
ALTER TABLE public.alert_queue
  ADD COLUMN IF NOT EXISTS created_date DATE GENERATED ALWAYS AS ((created_at AT TIME ZONE 'UTC')::date) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_alert_dedupe
  ON public.alert_queue (kind, COALESCE(dedupe_key, ''), created_date);
CREATE INDEX IF NOT EXISTS idx_alert_queue_pending
  ON public.alert_queue (created_at DESC) WHERE status = 'pending';
ALTER TABLE public.alert_queue ENABLE ROW LEVEL SECURITY;


-- 6 — Alert delivery channels per user/admin
CREATE TABLE IF NOT EXISTS public.alert_channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES public.profiles(id) ON DELETE CASCADE,  -- null = global admin channel
  channel         TEXT NOT NULL
                    CHECK (channel IN ('telegram', 'discord', 'email', 'webhook')),
  endpoint        TEXT NOT NULL,    -- chat_id / webhook URL / email
  min_severity    TEXT NOT NULL DEFAULT 'warn'
                    CHECK (min_severity IN ('info', 'warn', 'error', 'critical')),
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alert_channels_enabled
  ON public.alert_channels (enabled, channel) WHERE enabled = true;
ALTER TABLE public.alert_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ac_self" ON public.alert_channels;
CREATE POLICY "ac_self"
  ON public.alert_channels FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);


-- 7 — Recovery action log
CREATE TABLE IF NOT EXISTS public.recovery_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  problem_kind    TEXT NOT NULL
                    CHECK (problem_kind IN (
                      'dlq_retry', 'stuck_lifecycle', 'stale_writer',
                      'circuit_breaker_recovery', 'orphaned_position'
                    )),
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_taken    TEXT NOT NULL,
  outcome         TEXT NOT NULL DEFAULT 'pending'
                    CHECK (outcome IN ('pending', 'recovered', 'failed', 'skipped')),
  duration_ms     INT,
  error           TEXT,
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_recovery_logs_detected
  ON public.recovery_logs (detected_at DESC);
ALTER TABLE public.recovery_logs ENABLE ROW LEVEL SECURITY;

COMMIT;
