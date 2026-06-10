-- 20240101000080_validation_center_data_architecture.sql
--
-- AI Strategy Validation Center — Phase 12: full data architecture.
--
-- Eight tables that back the institutional surface on /shadow:
--   1. shadow_sessions              — logical groupings of shadow execs
--   2. strategy_validation_scores   — rolling per-strategy metrics
--   3. broker_quality_scores        — rolling per-broker scores (Phase 3)
--   4. strategy_rankings            — leaderboard rows (Phase 5)
--   5. validation_milestones        — gamification badges (Phase 10)
--   6. validation_snapshots         — historical points for equity curve
--                                     (Phase 6)
--   7. ai_strategy_reviews          — AI Strategy Coach output (Phase 7)
--   8. strategy_qualification_history — state-transition log
--
-- shadow_executions already exists (migration 20) — we keep that as the
-- ground-truth row-per-trade table; these eight are roll-ups / outputs.
--
-- Every table is RLS-enabled with a self-only SELECT policy. INSERT /
-- UPDATE land via service-role writes from the aggregator + coach
-- pipelines; users never write directly.

BEGIN;

-- 1 — Shadow sessions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shadow_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_name   TEXT,
  broker          TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  trade_count     INT NOT NULL DEFAULT 0,
  win_count       INT NOT NULL DEFAULT 0,
  total_pnl       NUMERIC(20, 8),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'closed', 'archived')),
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shadow_sessions_user_started
  ON public.shadow_sessions (user_id, started_at DESC);
ALTER TABLE public.shadow_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shadow_sessions_self" ON public.shadow_sessions;
CREATE POLICY "shadow_sessions_self"
  ON public.shadow_sessions FOR SELECT USING (user_id = auth.uid());

-- 2 — Strategy validation scores ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.strategy_validation_scores (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_name        TEXT NOT NULL,
  window_start         TIMESTAMPTZ NOT NULL,
  window_end           TIMESTAMPTZ NOT NULL,
  sample_size          INT NOT NULL,
  win_rate_pct         NUMERIC(5, 2),
  profit_factor        NUMERIC(10, 4),
  sharpe               NUMERIC(10, 4),
  sortino              NUMERIC(10, 4),
  calmar               NUMERIC(10, 4),
  max_drawdown         NUMERIC(20, 8),
  max_drawdown_pct     NUMERIC(10, 4),
  avg_r_multiple       NUMERIC(10, 4),
  expected_value       NUMERIC(20, 8),
  confidence_score     NUMERIC(5, 2),
  readiness_score      INT,
  qualification_status TEXT
                         CHECK (qualification_status IN ('approve', 'watchlist', 'reject', 'pending')),
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_strategy_validation_user_strat_window
  ON public.strategy_validation_scores (user_id, strategy_name, window_end DESC);
ALTER TABLE public.strategy_validation_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svs_self" ON public.strategy_validation_scores;
CREATE POLICY "svs_self"
  ON public.strategy_validation_scores FOR SELECT USING (user_id = auth.uid());

-- 3 — Broker quality scores ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.broker_quality_scores (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  broker                   TEXT NOT NULL,
  window_start             TIMESTAMPTZ NOT NULL,
  window_end               TIMESTAMPTZ NOT NULL,
  sample_size              INT NOT NULL,
  fill_rate_pct            NUMERIC(5, 2),
  avg_slippage_pct         NUMERIC(10, 6),
  avg_drift_pct            NUMERIC(10, 4),
  failed_count             INT NOT NULL DEFAULT 0,
  mirrored_count           INT NOT NULL DEFAULT 0,
  skipped_count            INT NOT NULL DEFAULT 0,
  requote_count            INT NOT NULL DEFAULT 0,
  spread_efficiency_pct    NUMERIC(5, 2),
  execution_latency_ms     NUMERIC(10, 2),
  execution_quality_score  INT,
  grade                    TEXT
                             CHECK (grade IN ('A+', 'A', 'B+', 'B', 'C', 'D')),
  percentile_rank          INT,
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_broker_quality_user_broker_window
  ON public.broker_quality_scores (user_id, broker, window_end DESC);
ALTER TABLE public.broker_quality_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bqs_self" ON public.broker_quality_scores;
CREATE POLICY "bqs_self"
  ON public.broker_quality_scores FOR SELECT USING (user_id = auth.uid());

-- 4 — Strategy rankings ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.strategy_rankings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_name TEXT NOT NULL,
  category      TEXT NOT NULL
                  CHECK (category IN ('top', 'worst', 'consistent', 'risky')),
  rank          INT NOT NULL,
  score         NUMERIC(10, 4),
  window_start  TIMESTAMPTZ NOT NULL,
  window_end    TIMESTAMPTZ NOT NULL,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_strategy_rankings_user_cat_rank
  ON public.strategy_rankings (user_id, category, rank);
ALTER TABLE public.strategy_rankings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rankings_self" ON public.strategy_rankings;
CREATE POLICY "rankings_self"
  ON public.strategy_rankings FOR SELECT USING (user_id = auth.uid());

-- 5 — Validation milestones (gamification) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.validation_milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  milestone_kind  TEXT NOT NULL
                    CHECK (milestone_kind IN (
                      'validated_strategy', 'broker_verified',
                      'execution_elite',    'risk_master',
                      'institutional_trader','top_percentile',
                      'streak_5', 'streak_10', 'streak_25', 'streak_50'
                    )),
  strategy_name   TEXT,
  broker          TEXT,
  achieved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
-- Postgres UNIQUE constraints can't carry expressions; use a unique
-- index instead. COALESCE collapses NULLs so a milestone with no
-- strategy_name + no broker still de-duplicates correctly.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_milestones_user_kind_strat_broker
  ON public.validation_milestones (
    user_id, milestone_kind, COALESCE(strategy_name, ''), COALESCE(broker, '')
  );
CREATE INDEX IF NOT EXISTS idx_milestones_user_achieved
  ON public.validation_milestones (user_id, achieved_at DESC);
ALTER TABLE public.validation_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "milestones_self" ON public.validation_milestones;
CREATE POLICY "milestones_self"
  ON public.validation_milestones FOR SELECT USING (user_id = auth.uid());

-- 6 — Validation snapshots (equity curve points) ─────────────────────
CREATE TABLE IF NOT EXISTS public.validation_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_name         TEXT,
  broker                TEXT,
  snapshot_date         DATE NOT NULL,
  sessions_count        INT NOT NULL DEFAULT 0,
  cumulative_pnl        NUMERIC(20, 8),
  daily_pnl             NUMERIC(20, 8),
  rolling_win_rate_pct  NUMERIC(5, 2),
  rolling_drawdown_pct  NUMERIC(10, 4),
  cumulative_return_pct NUMERIC(10, 4),
  confidence_low        NUMERIC(20, 8),
  confidence_high       NUMERIC(20, 8),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Same reason as the milestones UNIQUE — expression UNIQUE must be
-- a separate index, not an inline table constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_snapshots_user_strat_broker_date
  ON public.validation_snapshots (
    user_id, COALESCE(strategy_name, ''), COALESCE(broker, ''), snapshot_date
  );
CREATE INDEX IF NOT EXISTS idx_snapshots_user_date
  ON public.validation_snapshots (user_id, snapshot_date DESC);
ALTER TABLE public.validation_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "snapshots_self" ON public.validation_snapshots;
CREATE POLICY "snapshots_self"
  ON public.validation_snapshots FOR SELECT USING (user_id = auth.uid());

-- 7 — AI strategy reviews (Phase 7 coach output) ─────────────────────
CREATE TABLE IF NOT EXISTS public.ai_strategy_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_name   TEXT NOT NULL,
  overall_grade   TEXT CHECK (overall_grade IN ('A+', 'A', 'B+', 'B', 'C', 'D')),
  readiness_score INT CHECK (readiness_score BETWEEN 0 AND 100),
  recommendation  TEXT CHECK (recommendation IN ('approve', 'watchlist', 'reject')),
  whats_working   TEXT,
  whats_failing   TEXT,
  whats_to_fix    TEXT,
  risk_assessment TEXT,
  reviewer        TEXT NOT NULL DEFAULT 'algospherequant_coach_v2',
  reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_reviews_user_strat_reviewed
  ON public.ai_strategy_reviews (user_id, strategy_name, reviewed_at DESC);
ALTER TABLE public.ai_strategy_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_reviews_self" ON public.ai_strategy_reviews;
CREATE POLICY "ai_reviews_self"
  ON public.ai_strategy_reviews FOR SELECT USING (user_id = auth.uid());

-- 8 — Strategy qualification history ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.strategy_qualification_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_name   TEXT NOT NULL,
  from_stage      TEXT,
  to_stage        TEXT NOT NULL,
  reason          TEXT,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_qual_history_user_strat
  ON public.strategy_qualification_history (user_id, strategy_name, transitioned_at DESC);
ALTER TABLE public.strategy_qualification_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "qual_history_self" ON public.strategy_qualification_history;
CREATE POLICY "qual_history_self"
  ON public.strategy_qualification_history FOR SELECT USING (user_id = auth.uid());

COMMIT;
