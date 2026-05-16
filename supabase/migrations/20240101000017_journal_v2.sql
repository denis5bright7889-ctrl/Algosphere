-- ============================================================
-- AlgoSphere Quant — Journal v2: psychology, mistakes, sessions
-- Migration: 20240101000017_journal_v2.sql
-- ============================================================

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS emotion_pre   TEXT,  -- calm|anxious|confident|fomo|fearful|euphoric|angry
  ADD COLUMN IF NOT EXISTS emotion_post  TEXT,  -- calm|proud|frustrated|regret|content
  ADD COLUMN IF NOT EXISTS session       TEXT,  -- london|new_york|asia|overlap|off_hours
  ADD COLUMN IF NOT EXISTS timeframe     TEXT,  -- M5|M15|M30|H1|H4|D1
  ADD COLUMN IF NOT EXISTS market_context TEXT, -- trending|ranging|news|volatile
  ADD COLUMN IF NOT EXISTS mistakes      TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS what_went_well TEXT,
  ADD COLUMN IF NOT EXISTS improvements   TEXT,
  ADD COLUMN IF NOT EXISTS risk_pct       NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS rule_violation BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_review      TEXT,
  ADD COLUMN IF NOT EXISTS ai_score       INTEGER CHECK (ai_score BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS idx_journal_emotion
  ON public.journal_entries (user_id, emotion_pre);
CREATE INDEX IF NOT EXISTS idx_journal_session
  ON public.journal_entries (user_id, session);

-- Daily mood log (separate from per-trade emotion)
CREATE TABLE IF NOT EXISTS public.daily_mood_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  log_date         DATE NOT NULL,
  pre_session_mood TEXT NOT NULL,
  feeling          TEXT,
  goals            TEXT,
  max_loss_usd     NUMERIC(20,2),
  reflection       TEXT,             -- end-of-day
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, log_date)
);

ALTER TABLE public.daily_mood_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mood_logs_self"
  ON public.daily_mood_logs FOR ALL USING (user_id = auth.uid());

-- Aggregated mistake patterns view
CREATE OR REPLACE VIEW public.user_mistake_patterns AS
SELECT
  user_id,
  unnest(mistakes) AS mistake_type,
  COUNT(*)         AS frequency,
  SUM(COALESCE(pnl, 0))           AS total_pnl_impact,
  AVG(COALESCE(pnl, 0))           AS avg_pnl_impact,
  MAX(created_at)                 AS last_occurred
FROM public.journal_entries
WHERE mistakes IS NOT NULL AND array_length(mistakes, 1) > 0
GROUP BY user_id, unnest(mistakes);

GRANT SELECT ON public.user_mistake_patterns TO authenticated;

-- Achievement / gamification system
CREATE TABLE IF NOT EXISTS public.achievements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement  TEXT NOT NULL,
  -- first_trade | 10_trade_streak | risk_master | consistent_month | etc
  unlocked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB DEFAULT '{}',
  UNIQUE (user_id, achievement)
);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "achievements_self"
  ON public.achievements FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "achievements_system_write"
  ON public.achievements FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- News alerts cache (RSS-fed)
CREATE TABLE IF NOT EXISTS public.news_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  category    TEXT,                   -- crypto|forex|macro|equities
  impact      TEXT DEFAULT 'low',     -- high|medium|low
  published_at TIMESTAMPTZ NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_published
  ON public.news_items (published_at DESC);

ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "news_public_read" ON public.news_items FOR SELECT USING (TRUE);

-- Trading competition seasons
CREATE TABLE IF NOT EXISTS public.competitions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  description  TEXT,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  prize_pool_usd NUMERIC(12,2),
  metric       TEXT NOT NULL DEFAULT 'net_pnl_pct',
  -- net_pnl_pct | sharpe | win_rate | trade_count
  min_trades   INTEGER DEFAULT 10,
  status       TEXT NOT NULL DEFAULT 'upcoming'
                 CHECK (status IN ('upcoming','live','ended')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "competitions_public_read"
  ON public.competitions FOR SELECT USING (TRUE);

-- Performance fee billing (standalone, separate from copy profit-share)
CREATE TABLE IF NOT EXISTS public.performance_fees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  manager_id      UUID REFERENCES public.profiles(id),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  gross_profit    NUMERIC(20,2) NOT NULL,
  hwm_basis       NUMERIC(20,2) NOT NULL DEFAULT 0,
  fee_pct         NUMERIC(5,2) NOT NULL DEFAULT 20.0,
  fee_amount      NUMERIC(20,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'accrued'
                    CHECK (status IN ('accrued','invoiced','paid','disputed','voided')),
  invoiced_at     TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.performance_fees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perf_fees_self_read"
  ON public.performance_fees FOR SELECT
  USING (user_id = auth.uid() OR manager_id = auth.uid());
CREATE POLICY "perf_fees_system_write"
  ON public.performance_fees FOR ALL USING (auth.role() = 'service_role');
