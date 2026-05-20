-- ============================================================
-- Paper broker (zero-credential virtual trading) + immutable
-- execution event log.
-- Migration: 20240101000026_paper_broker.sql
--
-- Lets new users explore every dashboard (signals / execution /
-- risk / analytics / shadow / backtest / journal) end-to-end with
-- no API keys and no VPS. The engine's PaperBroker adapter
-- implements the same ExecutionAdapter interface as the real ones
-- — every downstream surface works unchanged.
-- ============================================================

-- ─── 1. Allow 'paper' in broker_connections ──────────────────

ALTER TABLE public.broker_connections
  DROP CONSTRAINT IF EXISTS broker_connections_broker_check;

ALTER TABLE public.broker_connections
  ADD CONSTRAINT broker_connections_broker_check
    CHECK (broker IN ('binance','bybit','okx','mt5','ctrader','paper'));

-- The vault columns are NOT NULL on real brokers but irrelevant for
-- paper. Relax them — the api/brokers/paper route inserts empty
-- strings for these so the existing NOT NULL constraint isn't
-- violated; the column remains valid for real brokers.
ALTER TABLE public.broker_connections
  ALTER COLUMN api_key_enc DROP NOT NULL,
  ALTER COLUMN api_secret_enc DROP NOT NULL;

-- ─── 2. Per-user virtual state for the paper adapter ─────────

CREATE TABLE IF NOT EXISTS public.paper_state (
  user_id      UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance      NUMERIC(20,8) NOT NULL DEFAULT 10000.0,
  positions    JSONB         NOT NULL DEFAULT '[]'::jsonb,
  last_quote   JSONB         NOT NULL DEFAULT '{}'::jsonb,
  volatile     BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.touch_paper_state() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_paper_state_touch ON public.paper_state;
CREATE TRIGGER trg_paper_state_touch
  BEFORE UPDATE ON public.paper_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_paper_state();

ALTER TABLE public.paper_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_state_self_read"
  ON public.paper_state FOR SELECT USING (user_id = auth.uid());
-- Engine writes via service role only — users can't directly mutate
-- their balance.
CREATE POLICY "paper_state_service"
  ON public.paper_state FOR ALL USING (auth.role() = 'service_role');

-- ─── 3. Immutable execution event log ─────────────────────────
--
-- Append-only typed event stream. Spec requirement:
-- SIGNAL_GENERATED, SIGNAL_VALIDATED, ORDER_PLACED, ORDER_FILLED,
-- POSITION_UPDATED, POSITION_CLOSED, RISK_TRIGGERED. Paper adapter
-- emits ORDER_FILLED / ORDER_REJECTED / POSITION_CLOSED / PAPER_INIT;
-- signal_engine and risk_engine will emit the remaining types in
-- follow-up commits. Used by future /sim event-stream dashboards.

CREATE TABLE IF NOT EXISTS public.execution_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  broker      TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exec_events_user_time
  ON public.execution_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_events_type
  ON public.execution_events (event_type, created_at DESC);

ALTER TABLE public.execution_events ENABLE ROW LEVEL SECURITY;

-- Append-only by design — no UPDATE / DELETE policies for users.
CREATE POLICY "exec_events_self_read"
  ON public.execution_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "exec_events_service"
  ON public.execution_events FOR ALL USING (auth.role() = 'service_role');
