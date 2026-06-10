-- 20240101000081_trade_forensics_tables.sql
--
-- Phase 4 of the Validation Center — Trade Forensics Engine. Four
-- tables that store per-shadow-execution explanations + reviews +
-- outcomes + quality scores. Pure-deterministic content (no LLM),
-- so every row is reproducible from the same shadow_executions
-- input.
--
-- All RLS-enabled with self-only SELECT. Writes come from the
-- service-role forensics writer; users never write directly.
--
-- Foreign key on shadow_execution_id cascades on delete so a removed
-- shadow row takes its forensics with it.

BEGIN;

-- 1 — trade_explanations: WHY this trade qualified + how it
--     executed + how it played out. One row per shadow execution.
CREATE TABLE IF NOT EXISTS public.trade_explanations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shadow_execution_id      UUID NOT NULL REFERENCES public.shadow_executions(id) ON DELETE CASCADE,
  -- Entry analysis
  entry_signal_strength    TEXT,    -- 'strong' | 'moderate' | 'weak'
  entry_market_regime      TEXT,    -- 'trending' | 'ranging' | 'volatile' | 'reversal' | 'low_liquidity'
  entry_trend_alignment    TEXT,    -- 'aligned' | 'counter' | 'neutral'
  entry_volatility         TEXT,    -- 'low' | 'normal' | 'elevated' | 'extreme'
  entry_risk_score         INT,     -- 0-100
  entry_qualification      TEXT,    -- narrative bullet summary
  -- Execution analysis
  exec_intended_entry      NUMERIC(20, 8),
  exec_actual_fill         NUMERIC(20, 8),
  exec_slippage_pct        NUMERIC(10, 6),
  exec_efficiency          INT,     -- 0-100 (fill quality vs intent)
  exec_broker_contribution TEXT,    -- 'positive' | 'neutral' | 'negative'
  -- Outcome analysis
  outcome_expected_pnl     NUMERIC(20, 8),
  outcome_actual_pnl       NUMERIC(20, 8),
  outcome_pnl_drift_pct    NUMERIC(10, 4),
  outcome_risk_adjusted    NUMERIC(10, 4),  -- pnl / |risk_amount|, when known
  outcome_grade            TEXT,    -- 'A' | 'B' | 'C' | 'D' | 'F'
  -- Engine + audit
  engine_version           TEXT NOT NULL DEFAULT 'forensics_v1',
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One forensics row per shadow execution — re-runs UPSERT.
  UNIQUE (shadow_execution_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_explanations_user_generated
  ON public.trade_explanations (user_id, generated_at DESC);
ALTER TABLE public.trade_explanations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "te_self" ON public.trade_explanations;
CREATE POLICY "te_self"
  ON public.trade_explanations FOR SELECT USING (user_id = auth.uid());


-- 2 — trade_reviews: post-trade institutional rating + lessons.
CREATE TABLE IF NOT EXISTS public.trade_reviews (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shadow_execution_id    UUID NOT NULL REFERENCES public.shadow_executions(id) ON DELETE CASCADE,
  what_worked            TEXT[],
  what_failed            TEXT[],
  lessons_learned        TEXT[],
  confidence_score       INT,    -- 0-100
  institutional_rating   TEXT,   -- 'A' | 'B' | 'C' | 'D' | 'F'
  reviewer               TEXT NOT NULL DEFAULT 'forensics_v1',
  reviewed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shadow_execution_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_reviews_user_reviewed
  ON public.trade_reviews (user_id, reviewed_at DESC);
ALTER TABLE public.trade_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tr_self" ON public.trade_reviews;
CREATE POLICY "tr_self"
  ON public.trade_reviews FOR SELECT USING (user_id = auth.uid());


-- 3 — trade_outcomes: structured PnL + drift facts. Distinct from
--     shadow_executions itself in that this carries the DERIVED
--     metrics (risk-adjusted, drift cohort etc) — easier to query.
CREATE TABLE IF NOT EXISTS public.trade_outcomes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shadow_execution_id   UUID NOT NULL REFERENCES public.shadow_executions(id) ON DELETE CASCADE,
  expected_pnl          NUMERIC(20, 8),
  actual_pnl            NUMERIC(20, 8),
  pnl_drift_pct         NUMERIC(10, 4),
  risk_adjusted_pnl     NUMERIC(10, 4),
  duration_seconds      INT,
  was_winner            BOOLEAN,
  was_breakeven         BOOLEAN,
  hit_target            BOOLEAN,    -- closed near intended TP (within 5%)
  hit_stop              BOOLEAN,    -- closed near intended SL (within 5%)
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shadow_execution_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_outcomes_user_computed
  ON public.trade_outcomes (user_id, computed_at DESC);
ALTER TABLE public.trade_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "to_self" ON public.trade_outcomes;
CREATE POLICY "to_self"
  ON public.trade_outcomes FOR SELECT USING (user_id = auth.uid());


-- 4 — trade_quality_scores: composite 0-100 score per trade with
--     four sub-scores so the UI can show component breakdown.
CREATE TABLE IF NOT EXISTS public.trade_quality_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shadow_execution_id   UUID NOT NULL REFERENCES public.shadow_executions(id) ON DELETE CASCADE,
  entry_quality         INT,    -- 0-100
  execution_quality     INT,    -- 0-100
  outcome_quality       INT,    -- 0-100
  process_quality       INT,    -- 0-100
  composite_score       INT,    -- 0-100 (weighted)
  grade                 TEXT,   -- 'A' | 'B' | 'C' | 'D' | 'F'
  scoring_version       TEXT NOT NULL DEFAULT 'forensics_v1',
  scored_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shadow_execution_id)
);
CREATE INDEX IF NOT EXISTS idx_tqs_user_scored
  ON public.trade_quality_scores (user_id, scored_at DESC);
ALTER TABLE public.trade_quality_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tqs_self" ON public.trade_quality_scores;
CREATE POLICY "tqs_self"
  ON public.trade_quality_scores FOR SELECT USING (user_id = auth.uid());

COMMIT;
