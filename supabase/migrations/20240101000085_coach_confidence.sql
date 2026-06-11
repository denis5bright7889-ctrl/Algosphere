-- 20240101000085_coach_confidence.sql
--
-- Trust audit: a coach evaluation may now be "Insufficient Data" — quality_score
-- and strategy_grade become NULLABLE, and every row carries a confidence label
-- + data_completeness fraction. Missing data is never scored as positive.
-- Idempotent.

ALTER TABLE public.journal_coach_evaluations ALTER COLUMN quality_score  DROP NOT NULL;
ALTER TABLE public.journal_coach_evaluations ALTER COLUMN strategy_grade DROP NOT NULL;

-- Relax the value CHECKs to permit NULL (Insufficient Data).
ALTER TABLE public.journal_coach_evaluations DROP CONSTRAINT IF EXISTS journal_coach_evaluations_quality_score_check;
ALTER TABLE public.journal_coach_evaluations
  ADD CONSTRAINT journal_coach_evaluations_quality_score_check
  CHECK (quality_score IS NULL OR (quality_score BETWEEN 0 AND 100));

ALTER TABLE public.journal_coach_evaluations DROP CONSTRAINT IF EXISTS journal_coach_evaluations_strategy_grade_check;
ALTER TABLE public.journal_coach_evaluations
  ADD CONSTRAINT journal_coach_evaluations_strategy_grade_check
  CHECK (strategy_grade IS NULL OR strategy_grade IN ('A','B','C','D','F'));

ALTER TABLE public.journal_coach_evaluations
  ADD COLUMN IF NOT EXISTS confidence text
  CHECK (confidence IS NULL OR confidence IN ('high','medium','low','insufficient'));
ALTER TABLE public.journal_coach_evaluations
  ADD COLUMN IF NOT EXISTS data_completeness numeric
  CHECK (data_completeness IS NULL OR (data_completeness BETWEEN 0 AND 1));
