-- ============================================================
-- Trader Type Classification
-- Migration: 20240101000027_trader_type.sql
--
-- 8 archetypes captured at onboarding (4-question wizard). Drives:
--   1. Risk-profile defaults (SL %, position-size suggestions)
--   2. Strategy recommendations (matched via strategy tags)
--   3. Dashboard customization (panel order, default timeframe)
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trader_type TEXT
    CHECK (trader_type IN (
      'scalper',
      'day_trader',
      'swing_trader',
      'position_trader',
      'algorithmic_trader',
      'copy_trader',
      'prop_firm_trader',
      'arbitrage_trader'
    ));

-- Raw onboarding answers (timeframe, hold_duration, automation, capital_source).
-- JSONB so we can extend the wizard without another migration.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS classification_meta JSONB
    DEFAULT '{}'::jsonb NOT NULL;

-- Timestamp the classification — useful for "when did the user
-- self-identify" analytics + re-prompt UX (e.g. "your type was set
-- 6 months ago, want to update?").
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trader_type_set_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_trader_type
  ON public.profiles (trader_type)
  WHERE trader_type IS NOT NULL;
