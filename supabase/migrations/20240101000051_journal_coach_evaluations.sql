-- 20240101000051_journal_coach_evaluations.sql
--
-- Refocus R4b: persistent deterministic coach evaluations.
--
-- Complements the existing LLM-driven journal_entries.ai_review +
-- ai_score (Gemini-generated, may be null when the API is unreachable)
-- with a STRUCTURED, DETERMINISTIC evaluation that always runs.
--
-- One row per (journal_entry, evaluator_version). Re-running the
-- evaluator after a journal entry is edited inserts a fresh row, so
-- the user can see how their evaluation changed when they added
-- context. The dashboard always reads the latest row per entry.
--
-- This table does NOT replace ai_review. Both coexist:
--   ai_review  → free-form LLM commentary (existing system)
--   coach eval → structured fields the Trader Intelligence dashboard
--                surfaces in tiles + ranked feeds.

CREATE TABLE IF NOT EXISTS public.journal_coach_evaluations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id  uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Scoring
  quality_score     integer NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  strategy_grade    text    NOT NULL CHECK (strategy_grade IN ('A','B','C','D','F')),

  -- Behavioral verdict for this single trade
  emotional_flag    boolean NOT NULL DEFAULT false,
  emotional_reason  text,

  -- Structured feedback (small arrays — bounded by the evaluator)
  what_worked       text[]  NOT NULL DEFAULT '{}',
  what_to_fix       text[]  NOT NULL DEFAULT '{}',
  advancement       text,

  -- Versioning so we can compare evaluator generations later
  evaluator_version integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coach_eval_user_recent
  ON public.journal_coach_evaluations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coach_eval_entry_latest
  ON public.journal_coach_evaluations (journal_entry_id, created_at DESC);


-- ─── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.journal_coach_evaluations ENABLE ROW LEVEL SECURITY;

-- Idempotent: drop+create so re-runs are safe.
DROP POLICY IF EXISTS coach_eval_self_select ON public.journal_coach_evaluations;
CREATE POLICY coach_eval_self_select
  ON public.journal_coach_evaluations FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT policy → only service-role can write (the journal POST
-- runs the evaluator with the service client after a successful insert,
-- so users never have direct write access to their own evaluation row).

COMMENT ON TABLE public.journal_coach_evaluations IS
  'Refocus R4b — deterministic per-trade coach scoring. Complements journal_entries.ai_review (LLM). One row per evaluator run; the dashboard reads the latest per journal_entry_id.';
