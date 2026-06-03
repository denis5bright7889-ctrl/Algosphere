-- 20240101000065_growth_copilot.sql
--
-- Growth Engine V1 — Phase 5: AI Growth Copilot.
--
-- One row per generated brief. Persisted so admin can see history,
-- compare day-over-day, and avoid re-generating in the same window.
-- The Gemini call is cached implicitly in lib/ai.ts; the row here is
-- the structured + deterministic output the UI renders.

CREATE TABLE IF NOT EXISTS public.growth_copilot_briefs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Window covered by the brief. Default: prior 7 days.
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,

  -- Deterministic data aggregated server-side BEFORE the LLM call.
  -- The LLM body must never claim a number that doesn't appear here.
  signals       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Gemini-generated narrative + recommendations. Markdown.
  summary_md    text NOT NULL,

  -- Ranked actions extracted from the brief (model returns JSON, we
  -- validate against a schema). Each: { title, why, impact: 'high'
  -- |'medium'|'low' }.
  actions       jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Provenance — which model + how many tokens it cost.
  model         text,

  generated_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  generated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_copilot_briefs_recent
  ON public.growth_copilot_briefs (generated_at DESC);

ALTER TABLE public.growth_copilot_briefs ENABLE ROW LEVEL SECURITY;
-- No policies — service-role only.

COMMENT ON TABLE public.growth_copilot_briefs IS
  'Phase 5 — daily AI Growth Copilot briefs. signals jsonb holds the deterministic numbers; summary_md is the Gemini narrative; actions are ranked recommendations.';
