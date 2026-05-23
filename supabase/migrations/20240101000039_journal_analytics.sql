-- ============================================================
-- AlgoSphere — Journal performance analytics (Phase 5)
-- Migration: 20240101000039_journal_analytics.sql
--
-- Per-user rolling-window performance scorecard, computed by the coach
-- worker (same trade-load pass that produces coach_state). Read-only
-- against the trading path — pure derived analytics, safe to recompute.
--
--   journal_analytics — win rate, profit factor, expectancy, reward/risk,
--     drawdown, and best/worst breakdowns by session / pair / setup tag /
--     hour-of-day. Powers the analytics dashboard + best-setup surfacing.
--
-- Additive; RLS owner-read, service_role-write. Derived (safe to TRUNCATE).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.journal_analytics (
  user_id        UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_days    INTEGER NOT NULL DEFAULT 30,
  trades         INTEGER NOT NULL DEFAULT 0,
  win_rate       NUMERIC(5,2),
  profit_factor  NUMERIC(10,4),
  expectancy     NUMERIC(14,4),
  gross_profit   NUMERIC(16,2),
  gross_loss     NUMERIC(16,2),
  avg_win        NUMERIC(14,4),
  avg_loss       NUMERIC(14,4),
  reward_risk    NUMERIC(10,4),
  net_pnl        NUMERIC(16,2),
  max_drawdown   NUMERIC(16,2),
  best_pair      TEXT,
  worst_pair     TEXT,
  best_session   TEXT,
  by_session     JSONB NOT NULL DEFAULT '{}',
  by_pair        JSONB NOT NULL DEFAULT '{}',
  by_tag         JSONB NOT NULL DEFAULT '{}',
  by_hour        JSONB NOT NULL DEFAULT '{}',
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.journal_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "journal_analytics_owner"
  ON public.journal_analytics FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "journal_analytics_system"
  ON public.journal_analytics FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- The coach worker upserts this per active user each pass, alongside
-- coach_state. The web analytics page reads it for the performance
-- dashboard (equity/PF/expectancy + by-session/pair/tag/hour heatmaps).
-- ============================================================
