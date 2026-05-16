-- ============================================================
-- AlgoSphere Quant — Prop Firm Challenge Tracker
-- Migration: 20240101000018_prop_challenges.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.prop_challenges (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  firm_name              TEXT NOT NULL,
  account_size_usd       NUMERIC(15,2) NOT NULL,
  phase                  TEXT NOT NULL DEFAULT 'challenge'
                           CHECK (phase IN ('challenge','verification','funded')),
  profit_target_pct      NUMERIC(5,2) NOT NULL DEFAULT 10.0,
  max_daily_loss_pct     NUMERIC(5,2) NOT NULL DEFAULT 5.0,
  max_total_loss_pct     NUMERIC(5,2) NOT NULL DEFAULT 10.0,
  min_trading_days       INTEGER DEFAULT 4,
  max_trading_days       INTEGER DEFAULT 30,
  current_balance_usd    NUMERIC(15,2),
  highest_balance_usd    NUMERIC(15,2),
  current_daily_pnl_usd  NUMERIC(15,2) DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','passed','failed','funded','closed')),
  breach_type            TEXT,
  started_at             DATE NOT NULL DEFAULT CURRENT_DATE,
  deadline               DATE,
  passed_at              TIMESTAMPTZ,
  failed_at              TIMESTAMPTZ,
  mt5_account_id         TEXT,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.prop_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prop_self" ON public.prop_challenges FOR ALL USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_prop_user_status
  ON public.prop_challenges (user_id, status);
