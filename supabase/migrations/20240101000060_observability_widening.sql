-- 20240101000060_observability_widening.sql
--
-- Critical observability widening — Phase 5 of the production
-- observability rescue. Widens system_event_log.surface to cover the
-- full set of decision-point events the engine must emit, and adds
-- engine_heartbeats so the diagnostics endpoint can answer "is the
-- worker actually running?" without a log dive.
--
-- Idempotent. Non-destructive.

-- ── 1. Widen system_event_log.surface CHECK ───────────────────────
-- Previously: signal_generated / signal_rejected / trade_open /
--             trade_close / sl_hit / tp_hit / risk_locked /
--             breaker_open / health_alert / mt5_status
-- Add: trade_sent / trade_failed / risk_block / regime_classification /
--      signal_skipped / signal_drought / data_drought / engine_event
ALTER TABLE public.system_event_log
  DROP CONSTRAINT IF EXISTS system_event_log_surface_check;
ALTER TABLE public.system_event_log
  ADD CONSTRAINT system_event_log_surface_check
  CHECK (surface IN (
    -- Signal lifecycle
    'signal_generated',
    'signal_skipped',          -- pre-ensemble drop (no bars / invalid features)
    'signal_rejected',         -- post-ensemble drop (confidence / gate / risk)
    'signal_drought',          -- no signals in last N hours alarm
    -- Trade lifecycle
    'trade_sent',              -- order_send issued, awaiting fill
    'trade_open',              -- fill confirmed (broker retcode OK)
    'trade_failed',            -- order rejected at the broker (retcode NOT OK)
    'trade_close',             -- position closed (any reason)
    'sl_hit',
    'tp_hit',
    -- Risk
    'risk_block',              -- per-trade risk gate rejection
    'risk_locked',             -- global risk engine LOCKED
    'breaker_open',            -- circuit breaker per symbol
    -- System / health
    'health_alert',
    'mt5_status',
    'data_drought',            -- provider returned <min bars across universe
    'regime_classification',   -- diagnostic regime snapshot
    'engine_event'             -- catch-all engine-internal event
  ));


-- ── 2. NEW engine_heartbeats — liveness probe ─────────────────────
-- One row per long-running component. Upserted on every cycle. The
-- diagnostics endpoint reads this to answer "is the worker alive?"
-- without scanning the event log. The component string is free-form
-- (signal_worker / execution / mt5_bridge / data_provider / etc.).
CREATE TABLE IF NOT EXISTS public.engine_heartbeats (
  component   TEXT PRIMARY KEY,
  last_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 'live' = healthy; 'degraded' = partial failure (e.g. one of the
  -- data providers down); 'down' = component reports it cannot work.
  status      TEXT NOT NULL DEFAULT 'live'
                CHECK (status IN ('live','degraded','down')),
  -- Free-form context the component wants the operator to see
  -- (e.g. {"symbols_scanned": 17, "signals_published": 0, "dry_run": false}).
  context     JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.engine_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "engine_heartbeats_admin_read"
  ON public.engine_heartbeats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND account_type = 'admin'
    )
  );
CREATE POLICY "engine_heartbeats_service_write"
  ON public.engine_heartbeats FOR ALL
  USING (auth.role() = 'service_role');
