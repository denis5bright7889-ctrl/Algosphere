-- 20240101000084_user_auto_trading_settings.sql
--
-- Per-user auto-trading gate configuration. The presence of an enabled
-- row here is necessary but NOT sufficient for auto-execution — the
-- executor (separate slice) ALSO requires:
--   • a connected broker_connections row
--   • the signal's confidence ≥ min_confidence
--   • the signal's pair in allowed_symbols
--   • the signal's broker in allowed_brokers (or empty = any)
--   • daily-trade count below max_trades_per_day
--   • paused_until in the past (or null)
--
-- Schema is self-only via RLS. Service-role aux clients (executor cron)
-- bypass RLS by design.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_auto_trading_settings (
  user_id                 UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Master switch. Off by default — explicit opt-in only.
  enabled                 BOOLEAN NOT NULL DEFAULT FALSE,

  -- Allow-list of symbols. Empty array = no symbols allowed (safer
  -- default than "all"). User must explicitly add symbols.
  allowed_symbols         TEXT[] NOT NULL DEFAULT '{}',

  -- Confidence floor (1-100). Signals below this never auto-execute.
  min_confidence          INT NOT NULL DEFAULT 80
                            CHECK (min_confidence BETWEEN 1 AND 100),

  -- Per-trade risk cap (% of account equity).
  max_risk_pct            NUMERIC(5, 2) NOT NULL DEFAULT 1.0
                            CHECK (max_risk_pct > 0 AND max_risk_pct <= 5),

  -- Hard cap on auto-executed trades per UTC day.
  max_trades_per_day      INT NOT NULL DEFAULT 5
                            CHECK (max_trades_per_day BETWEEN 1 AND 50),

  -- Directional allow-list. Empty array = no auto-trades.
  allowed_directions      TEXT[] NOT NULL DEFAULT ARRAY['buy', 'sell']::TEXT[],

  -- Broker allow-list. Empty array = ANY connected broker is allowed.
  allowed_brokers         TEXT[] NOT NULL DEFAULT '{}',

  -- Restrict to known trading sessions (London / NY / overlap).
  require_active_session  BOOLEAN NOT NULL DEFAULT TRUE,

  -- Manual pause (e.g. during news event). When set in the future,
  -- executor skips this user until the timestamp passes.
  paused_until            TIMESTAMPTZ,

  -- Audit trail
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enabled_at              TIMESTAMPTZ,    -- set on first enable
  total_auto_executions   BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auto_trading_enabled
  ON public.user_auto_trading_settings (enabled) WHERE enabled = true;

ALTER TABLE public.user_auto_trading_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uats_self_select" ON public.user_auto_trading_settings;
CREATE POLICY "uats_self_select"
  ON public.user_auto_trading_settings FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "uats_self_upsert" ON public.user_auto_trading_settings;
CREATE POLICY "uats_self_upsert"
  ON public.user_auto_trading_settings FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "uats_self_update" ON public.user_auto_trading_settings;
CREATE POLICY "uats_self_update"
  ON public.user_auto_trading_settings FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Auto-stamp updated_at on every UPDATE
CREATE OR REPLACE FUNCTION public.uats_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  IF NEW.enabled = TRUE AND OLD.enabled = FALSE AND NEW.enabled_at IS NULL THEN
    NEW.enabled_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS uats_touch_updated_at_trg ON public.user_auto_trading_settings;
CREATE TRIGGER uats_touch_updated_at_trg
  BEFORE UPDATE ON public.user_auto_trading_settings
  FOR EACH ROW EXECUTE FUNCTION public.uats_touch_updated_at();

COMMIT;
