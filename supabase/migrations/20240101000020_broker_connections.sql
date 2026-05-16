-- ============================================================
-- AlgoSphere Quant — Per-user broker credentials + shadow execution log
-- Migration: 20240101000020_broker_connections.sql
-- ============================================================

-- One row per user-broker connection. Credentials encrypted at the app layer
-- before insert (AES-256-GCM keyed by CREDENTIAL_ENCRYPTION_KEY env var).
CREATE TABLE IF NOT EXISTS public.broker_connections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  broker             TEXT NOT NULL
                       CHECK (broker IN ('binance','bybit','okx','mt5','ctrader')),
  label              TEXT,                    -- e.g. "My Binance Testnet"
  account_id         TEXT,                    -- broker-side account number where applicable
  -- Encrypted credentials (never store plaintext)
  api_key_enc        TEXT NOT NULL,
  api_secret_enc     TEXT NOT NULL,
  passphrase_enc     TEXT,                    -- OKX requires this
  metaapi_token_enc  TEXT,                    -- MT5 via MetaApi
  access_token_enc   TEXT,                    -- cTrader OAuth token
  -- Environment
  is_live            BOOLEAN NOT NULL DEFAULT FALSE,
  is_testnet         BOOLEAN NOT NULL DEFAULT TRUE,
  -- Liveness probe state (refreshed by signal-engine /execute)
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','connected','error','disconnected','revoked')),
  equity_usd         NUMERIC(20,8),
  equity_updated_at  TIMESTAMPTZ,
  last_synced_at     TIMESTAMPTZ,
  error_message      TEXT,
  -- Defaults
  is_default         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, broker, account_id)
);

CREATE INDEX IF NOT EXISTS idx_broker_conn_user
  ON public.broker_connections (user_id, status);
CREATE INDEX IF NOT EXISTS idx_broker_conn_default
  ON public.broker_connections (user_id) WHERE is_default = TRUE;

-- Only one default broker per user — enforce at the row level
CREATE OR REPLACE FUNCTION public.enforce_single_default_broker()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_default = TRUE THEN
    UPDATE public.broker_connections
    SET is_default = FALSE
    WHERE user_id = NEW.user_id
      AND id != NEW.id
      AND is_default = TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_single_default_broker ON public.broker_connections;
CREATE TRIGGER trg_single_default_broker
  BEFORE INSERT OR UPDATE ON public.broker_connections
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_default_broker();

ALTER TABLE public.broker_connections ENABLE ROW LEVEL SECURITY;

-- Users see only their own connections.
CREATE POLICY "broker_conn_self_read"
  ON public.broker_connections FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "broker_conn_self_insert"
  ON public.broker_connections FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "broker_conn_self_update"
  ON public.broker_connections FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "broker_conn_self_delete"
  ON public.broker_connections FOR DELETE USING (user_id = auth.uid());
-- Service role bypasses all of the above for engine use.
CREATE POLICY "broker_conn_service"
  ON public.broker_connections FOR ALL USING (auth.role() = 'service_role');

-- Shadow-mode execution log: every full_auto signal that WOULD have fired
-- (whether it actually did or not). Used to validate execution quality
-- before flipping testnet→live.
CREATE TABLE IF NOT EXISTS public.shadow_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  signal_id         UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  copy_trade_id     UUID REFERENCES public.copy_trades(id) ON DELETE SET NULL,
  broker            TEXT NOT NULL,
  symbol            TEXT NOT NULL,
  direction         TEXT NOT NULL CHECK (direction IN ('buy','sell')),
  -- What the relay decided to fire
  intended_lot      NUMERIC(20,8) NOT NULL,
  intended_entry    NUMERIC(20,8),
  intended_sl       NUMERIC(20,8),
  intended_tp       NUMERIC(20,8),
  -- What actually happened on the broker
  actual_status     TEXT NOT NULL
                      CHECK (actual_status IN ('mirrored','failed','skipped','testnet','shadow_only')),
  actual_fill_price NUMERIC(20,8),
  actual_lot        NUMERIC(20,8),
  slippage_pct      NUMERIC(10,6),
  skip_reason       TEXT,
  -- Leader's actual outcome for diffing once both close
  leader_pnl        NUMERIC(20,8),
  follower_pnl      NUMERIC(20,8),
  pnl_drift_pct     NUMERIC(10,4),       -- (leader - follower) / leader, signed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shadow_user
  ON public.shadow_executions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shadow_open
  ON public.shadow_executions (user_id) WHERE closed_at IS NULL;

ALTER TABLE public.shadow_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shadow_self"     ON public.shadow_executions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "shadow_service"  ON public.shadow_executions FOR ALL    USING (auth.role() = 'service_role');
