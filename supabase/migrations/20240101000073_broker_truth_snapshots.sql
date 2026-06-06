-- 20240101000073_broker_truth_snapshots.sql
--
-- Broker-truth data layer (V4.1). Permanent, historical broker state so any
-- dashboard / AI / analytics / risk engine can reconstruct account state at any
-- past timestamp. Written ONLY by the equity_snapshot_worker (service role)
-- from real broker polls — never from estimates or UI cache.
--
-- Apply with: supabase db push  (the engine can't run DDL; this is operator-run).
-- Idempotent.

-- ── Account snapshots ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.broker_account_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_connection_id UUID REFERENCES public.broker_connections(id) ON DELETE CASCADE,
  user_id              UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  broker_name          TEXT NOT NULL,
  account_id           TEXT,
  ts                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  balance              NUMERIC,
  equity               NUMERIC,
  free_margin          NUMERIC,
  used_margin          NUMERIC,
  margin_level         NUMERIC,
  leverage             NUMERIC,   -- null until an adapter exposes it (not fabricated)
  currency             TEXT,      -- null until an adapter exposes it
  open_positions       INTEGER NOT NULL DEFAULT 0,
  source               TEXT NOT NULL DEFAULT 'broker_poll'
);
CREATE INDEX IF NOT EXISTS idx_bas_conn_ts ON public.broker_account_snapshots (broker_connection_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_bas_ts      ON public.broker_account_snapshots (ts DESC);

-- ── Position snapshots ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.broker_position_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_connection_id UUID REFERENCES public.broker_connections(id) ON DELETE CASCADE,
  user_id              UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  position_id          TEXT NOT NULL,
  symbol               TEXT NOT NULL,
  side                 TEXT,
  volume               NUMERIC,
  entry_price          NUMERIC,
  current_price        NUMERIC,
  stop_loss            NUMERIC,
  take_profit          NUMERIC,
  unrealized_pnl       NUMERIC,
  ts                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bps_position ON public.broker_position_snapshots (position_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_bps_symbol   ON public.broker_position_snapshots (symbol, ts DESC);
CREATE INDEX IF NOT EXISTS idx_bps_ts       ON public.broker_position_snapshots (ts DESC);

-- ── Equity timeseries (chart source) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equity_timeseries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_connection_id UUID REFERENCES public.broker_connections(id) ON DELETE CASCADE,
  user_id              UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ts                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  balance              NUMERIC,
  equity               NUMERIC,
  drawdown             NUMERIC,   -- (peak_equity - equity) / peak_equity, 0..1
  open_pnl             NUMERIC,
  closed_pnl           NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_eq_conn_ts ON public.equity_timeseries (broker_connection_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_eq_ts      ON public.equity_timeseries (ts DESC);

-- ── RLS — owner-read + service-write (same model as growth_asset_attempts) ────
ALTER TABLE public.broker_account_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_position_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equity_timeseries         ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['broker_account_snapshots','broker_position_snapshots','equity_timeseries']
  LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS "%1$s_owner_read" ON public.%1$s;
      CREATE POLICY "%1$s_owner_read" ON public.%1$s FOR SELECT
        USING (auth.uid() = user_id OR EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.account_type = 'admin'));
      DROP POLICY IF EXISTS "%1$s_service_write" ON public.%1$s;
      CREATE POLICY "%1$s_service_write" ON public.%1$s FOR ALL
        USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
    $f$, t);
  END LOOP;
END $$;
