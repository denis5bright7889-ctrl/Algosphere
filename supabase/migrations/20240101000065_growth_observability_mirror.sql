-- 20240101000065_growth_observability_mirror.sql
--
-- Bridge the Growth Engine's publish log into system_event_log so the
-- ops view at /admin/intelligence-health (and any future unified feed)
-- sees every Discord/Telegram/Meta/LinkedIn publish attempt alongside
-- the signal-engine events.
--
-- Why: growth_post_attempts is the source of truth for what was sent
-- where, but it's in a different table than the rest of our ops
-- telemetry. Operators were having to query two surfaces to answer
-- "did anything publish today?"
--
-- What:
--   1. Widen system_event_log.surface CHECK to include the growth
--      publish event types.
--   2. Add an AFTER INSERT trigger on growth_post_attempts that mirrors
--      a sanitised row into system_event_log. Channel comes from the
--      attempt; error class is normalised; the original attempt id is
--      preserved in reference_id so the operator can cross-link.
--
-- Idempotent. Safe to re-run.

-- ── 1. Widen system_event_log.surface CHECK ──────────────────────
ALTER TABLE public.system_event_log
  DROP CONSTRAINT IF EXISTS system_event_log_surface_check;
ALTER TABLE public.system_event_log
  ADD CONSTRAINT system_event_log_surface_check
  CHECK (surface IN (
    -- Signal lifecycle (existing)
    'signal_generated', 'signal_skipped', 'signal_rejected', 'signal_drought',
    -- Trade lifecycle (existing)
    'trade_sent', 'trade_open', 'trade_failed', 'trade_close',
    'sl_hit', 'tp_hit',
    -- Risk (existing)
    'risk_block', 'risk_locked', 'breaker_open',
    -- System / health (existing)
    'health_alert', 'mt5_status', 'data_drought',
    'regime_classification', 'engine_event',
    -- NEW: Growth publish lifecycle
    'growth_publish_attempt',  -- channel-level attempt (Discord/Telegram/Meta/LinkedIn)
    'growth_publish_failed',   -- attempt returned non-2xx
    'growth_publish_ok',       -- attempt succeeded
    'growth_smoke_test'        -- manual smoke test run
  ));


-- ── 2. Mirror trigger ─────────────────────────────────────────────
-- Reads from public.growth_post_attempts after each insert and
-- appends a sanitised summary to public.system_event_log. Reference
-- id links back to the attempt row so the operator can navigate.
--
-- The function is SECURITY DEFINER so the trigger writes regardless
-- of the caller's RLS — same controlled-bypass pattern the existing
-- journal auto-detection trigger uses (migration 20240101000029).
--
-- Defensive: the body is wrapped in EXCEPTION → NULL so a malformed
-- attempt row CAN NEVER block the publish path.

CREATE OR REPLACE FUNCTION public.mirror_growth_attempt_to_event_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_surface     TEXT;
  v_status      TEXT;
  v_error_class TEXT;
  v_summary     JSONB;
BEGIN
  BEGIN
    -- Surface: succeed → growth_publish_ok, fail → growth_publish_failed.
    -- Either way we ALSO emit the attempt-level event so the operator
    -- can see attempts that retried before succeeding.
    IF NEW.ok = TRUE THEN
      v_surface := 'growth_publish_ok';
      v_status  := 'sent';
    ELSE
      v_surface := 'growth_publish_failed';
      v_status  := 'failed';
    END IF;

    -- Normalise the error class so the unified feed can group failures.
    -- Provider names + raw bodies are NOT included — same sanitization
    -- contract as the rest of the engine surfaces.
    v_error_class := CASE
      WHEN NEW.error IS NULL OR NEW.error = ''        THEN NULL
      WHEN NEW.error ~* 'rate.?limit'                  THEN 'rate_limit'
      WHEN NEW.error ~* 'unauthor|forbidden|api[_ -]?key' THEN 'auth_failure'
      WHEN NEW.error ~* 'timeout|timed out'            THEN 'timeout'
      WHEN NEW.error ~* '\m5\d\d\M|http\s*5\d\d'       THEN 'http_5xx'
      WHEN NEW.error ~* '\m4\d\d\M|http\s*4\d\d'       THEN 'http_4xx'
      ELSE 'other'
    END;

    v_summary := jsonb_build_object(
      'attempt_id',  NEW.id,
      'channel',     NEW.channel,
      'target',      NEW.target,
      'external_id', NEW.external_id,
      'attempt_n',   NEW.attempt
    );

    INSERT INTO public.system_event_log (
      surface, channel, payload_summary, reference_id,
      status, status_code, error_class
    ) VALUES (
      v_surface, NEW.channel, v_summary, NEW.scheduled_post_id,
      v_status, NEW.status_code, v_error_class
    );

  EXCEPTION WHEN OTHERS THEN
    -- Mirror failure must NEVER block the publish path. Swallow.
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_growth_attempt_mirror ON public.growth_post_attempts;
CREATE TRIGGER trg_growth_attempt_mirror
  AFTER INSERT ON public.growth_post_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.mirror_growth_attempt_to_event_log();
