-- ─────────────────────────────────────────────────────────────────────
-- Journal v3 — Behavioral Trading Intelligence System
-- ─────────────────────────────────────────────────────────────────────
--
-- The Trade Journal is no longer a logging form. Each trade is now a
-- structured intelligence event that captures Market + Strategy +
-- Psychology + Execution + Outcome — so the downstream engines
-- (AI Coach, Psychology, Risk Intelligence, Performance, Strategy
-- Optimization) read process data, not just price/PnL.
--
-- This migration adds the new column families to journal_entries and
-- the 5 process-grade columns to journal_coach_evaluations. Existing
-- v2 columns (emotion_pre/post, session, market_context, risk_pct,
-- rule_violation, etc.) stay as-is and feed the same engines.
--
-- All columns nullable + idempotent (IF NOT EXISTS) so the migration
-- is safe to re-apply and so rows logged before the upgrade keep
-- rendering. The API + form enforce required-on-create for the
-- behavioral fields; pre-existing rows can be edited to fill in.

-- ── 1. Strategy context ──────────────────────────────────────────────
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS strategy_used     TEXT
    CHECK (strategy_used IS NULL OR strategy_used IN (
      'trend_following', 'breakout', 'scalping', 'swing', 'smc',
      'mean_reversion', 'news', 'custom'
    )),
  ADD COLUMN IF NOT EXISTS setup_validity    TEXT
    CHECK (setup_validity IS NULL OR setup_validity IN ('yes', 'partial', 'no')),
  ADD COLUMN IF NOT EXISTS market_regime     TEXT
    CHECK (market_regime IS NULL OR market_regime IN (
      'trending', 'ranging', 'volatile', 'reversal', 'low_liquidity'
    ));

-- ── 2. Psychology context ────────────────────────────────────────────
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS reason_for_entry  TEXT
    CHECK (reason_for_entry IS NULL OR reason_for_entry IN (
      'strategy_signal', 'confirmation_setup', 'news', 'impulse', 'fomo'
    )),
  ADD COLUMN IF NOT EXISTS revenge_trade     BOOLEAN,
  ADD COLUMN IF NOT EXISTS rule_compliance   TEXT
    CHECK (rule_compliance IS NULL OR rule_compliance IN ('full', 'partial', 'none')),
  ADD COLUMN IF NOT EXISTS confidence_level  SMALLINT
    CHECK (confidence_level IS NULL OR (confidence_level BETWEEN 1 AND 10));

-- ── 3. Execution quality ─────────────────────────────────────────────
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS entry_quality       TEXT
    CHECK (entry_quality IS NULL OR entry_quality IN ('excellent', 'good', 'average', 'poor')),
  ADD COLUMN IF NOT EXISTS exit_quality        TEXT
    CHECK (exit_quality IS NULL OR exit_quality IN ('excellent', 'good', 'average', 'poor')),
  ADD COLUMN IF NOT EXISTS management_quality  TEXT
    CHECK (management_quality IS NULL OR management_quality IN ('excellent', 'good', 'average', 'poor'));

-- ── 4. Thesis & reflection (structured prompts) ──────────────────────
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS thesis              TEXT,
  ADD COLUMN IF NOT EXISTS entry_confirmation  TEXT,
  ADD COLUMN IF NOT EXISTS invalidations       TEXT,
  ADD COLUMN IF NOT EXISTS reflection          TEXT;

-- ── 5. Visual evidence (two screenshots) ─────────────────────────────
-- The existing screenshot_url column becomes the pre-entry shot; we
-- add a second one for the post-exit shot. Old rows keep their data;
-- the form is wired to write to both fields explicitly going forward.
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS post_exit_screenshot_url TEXT;

-- ── 6. Indexes for structured filtering ──────────────────────────────
-- Partial indexes (non-null) — most queries filter "where field IS NOT
-- NULL AND ..." so partial keeps the index lean for pre-v3 rows.
CREATE INDEX IF NOT EXISTS idx_journal_strategy_used
  ON public.journal_entries (user_id, strategy_used)
  WHERE strategy_used IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_market_regime
  ON public.journal_entries (user_id, market_regime)
  WHERE market_regime IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_revenge_trade
  ON public.journal_entries (user_id, trade_date DESC)
  WHERE revenge_trade IS TRUE;

-- ── 7. Five process grades on coach evaluations ──────────────────────
-- Coach output already carries `quality_score` (0-100, our overall) and
-- `strategy_grade` (letter). The V3 spec asks for 5 sub-grades on each
-- axis: Execution / Psychology / Risk / Discipline / Timing. We extend
-- the existing eval row rather than fork a parallel table — same write
-- path, same RLS, same versioning.
ALTER TABLE public.journal_coach_evaluations
  ADD COLUMN IF NOT EXISTS execution_grade   SMALLINT
    CHECK (execution_grade   IS NULL OR (execution_grade   BETWEEN 0 AND 100)),
  ADD COLUMN IF NOT EXISTS psychology_grade  SMALLINT
    CHECK (psychology_grade  IS NULL OR (psychology_grade  BETWEEN 0 AND 100)),
  ADD COLUMN IF NOT EXISTS risk_grade        SMALLINT
    CHECK (risk_grade        IS NULL OR (risk_grade        BETWEEN 0 AND 100)),
  ADD COLUMN IF NOT EXISTS discipline_grade  SMALLINT
    CHECK (discipline_grade  IS NULL OR (discipline_grade  BETWEEN 0 AND 100)),
  ADD COLUMN IF NOT EXISTS timing_grade      SMALLINT
    CHECK (timing_grade      IS NULL OR (timing_grade      BETWEEN 0 AND 100)),
  -- ai_insights is the ranked 3+ string array the spec requires per
  -- trade ("you tend to overtrade after losses", etc). Stored as a
  -- TEXT[] so PostgREST exposes it as a plain JSON array.
  ADD COLUMN IF NOT EXISTS ai_insights       TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.journal_coach_evaluations.execution_grade IS
  'Process-based execution quality 0-100. Driven by entry_quality + exit_quality + management_quality, NOT by PnL outcome.';
COMMENT ON COLUMN public.journal_coach_evaluations.psychology_grade IS
  'Process-based psychology 0-100. Driven by emotion_pre + reason_for_entry + revenge_trade + confidence_level.';
COMMENT ON COLUMN public.journal_coach_evaluations.risk_grade IS
  'Process-based risk discipline 0-100. Driven by risk_pct band + sizing relative to setup_validity.';
COMMENT ON COLUMN public.journal_coach_evaluations.discipline_grade IS
  'Process-based discipline 0-100. Driven by rule_compliance + mistakes + revenge_trade flag.';
COMMENT ON COLUMN public.journal_coach_evaluations.timing_grade IS
  'Process-based timing 0-100. Driven by session-vs-edge alignment + setup_validity + market_regime fit.';
