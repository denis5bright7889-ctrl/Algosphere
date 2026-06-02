-- 20240101000063_growth_llm_polish.sql
--
-- Growth Engine — opt-in LLM polish per automation rule.
--
-- Adds llm_polish (boolean) to growth_automation_rules. When true,
-- the deterministic generator's output is passed through Gemini for
-- voice/tone polishing BEFORE the row is persisted. The TS-side
-- polisher enforces fact-preservation: every number / percentage /
-- dollar figure / disclaimer in the original body must survive the
-- rewrite — failures fall back to the unpolished body so we never
-- ship LLM-fabricated claims.

ALTER TABLE public.growth_automation_rules
  ADD COLUMN IF NOT EXISTS llm_polish boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.growth_automation_rules.llm_polish IS
  'Opt-in: send the generator output through Gemini for voice polish before persisting. Fact-preservation guard in lib/growth/llm-polish.ts.';
