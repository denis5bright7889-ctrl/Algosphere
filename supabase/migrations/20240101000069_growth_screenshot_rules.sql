-- 20240101000069_growth_screenshot_rules.sql
--
-- Phase 6C — Visual Content Engine wiring.
--
-- Attaches Playwright screenshot asset_kinds to existing rules
-- (weekly digest, feature release) and seeds new rules for
-- psychology.report.generated, strategy.created, and the daily
-- showcase rotation that daily-content cron fires.
--
-- Idempotent: existing-rule updates use UPDATE (no-op on re-run);
-- new-rule inserts rely on the uq_automation_rules_name unique index
-- already created in migration 61.

-- ─── 1. Attach screenshots to existing weekly + feature rules ──────
UPDATE public.growth_automation_rules
   SET asset_kinds = ARRAY['performance_screenshot']
 WHERE name = 'weekly digest → Market Report auto-publish'
   AND (asset_kinds IS NULL OR cardinality(asset_kinds) = 0);

UPDATE public.growth_automation_rules
   SET asset_kinds = ARRAY['feature_screenshot']
 WHERE name = 'feature → Product Update draft'
   AND (asset_kinds IS NULL OR cardinality(asset_kinds) = 0);

-- ─── 2. New rules: psychology + strategy events ────────────────────
INSERT INTO public.growth_automation_rules
  (name, description, event_type, predicate, content_kind, channels,
   output_status, daily_cap, asset_kinds)
VALUES
  ('psychology.report.generated → Psychology screenshot draft',
   'When a behavioural-intel report is generated, draft a Psychology Insight post with a screenshot of /intelligence/me.',
   'psychology.report.generated',
   '{}'::jsonb,
   'psychology_insight',
   ARRAY['discord','telegram','linkedin'],
   'draft',
   2,
   ARRAY['psychology_screenshot']),

  ('strategy.created → Strategy screenshot draft',
   'When a user creates a new strategy, draft a Strategy of the Week post with a screenshot of /strategies.',
   'strategy.created',
   '{}'::jsonb,
   'strategy_of_the_week',
   ARRAY['discord','telegram'],
   'draft',
   3,
   ARRAY['strategy_builder_screenshot'])
ON CONFLICT (name) DO NOTHING;

-- ─── 3. Daily showcase rotation rules ─────────────────────────────
-- One rule per showcase target. The daily-content cron fires
-- showcase.daily with payload.target = '<kind>' and the predicate
-- matches exactly the one rule. content_kind='educational' so the
-- rule consumes payload.topic/headline/body that the orchestrator
-- generates per target.
INSERT INTO public.growth_automation_rules
  (name, description, event_type, predicate, content_kind, channels,
   output_status, daily_cap, asset_kinds)
VALUES
  ('showcase.daily[dashboard] → dashboard screenshot auto-publish',
   'Daily Dashboard showcase — captures /overview and publishes alongside a short educational caption.',
   'showcase.daily',
   '{"target":"dashboard"}'::jsonb,
   'educational',
   ARRAY['discord','telegram','linkedin'],
   'approved',
   1,
   ARRAY['dashboard_screenshot']),

  ('showcase.daily[psychology] → psychology screenshot auto-publish',
   'Daily Psychology showcase — captures /intelligence/me and publishes alongside a short educational caption.',
   'showcase.daily',
   '{"target":"psychology"}'::jsonb,
   'educational',
   ARRAY['discord','telegram','linkedin'],
   'approved',
   1,
   ARRAY['psychology_screenshot']),

  ('showcase.daily[strategy] → strategy screenshot auto-publish',
   'Daily Strategy Builder showcase — captures /strategies and publishes alongside a short educational caption.',
   'showcase.daily',
   '{"target":"strategy"}'::jsonb,
   'educational',
   ARRAY['discord','telegram','linkedin'],
   'approved',
   1,
   ARRAY['strategy_builder_screenshot']),

  ('showcase.daily[feature] → feature screenshot auto-publish',
   'Daily Feature showcase — captures /intelligence and publishes alongside a short educational caption.',
   'showcase.daily',
   '{"target":"feature"}'::jsonb,
   'educational',
   ARRAY['discord','telegram','linkedin'],
   'approved',
   1,
   ARRAY['feature_screenshot']),

  ('showcase.daily[education] → education screenshot auto-publish',
   'Daily Education hub showcase — captures /learn and publishes alongside a short educational caption.',
   'showcase.daily',
   '{"target":"education"}'::jsonb,
   'educational',
   ARRAY['discord','telegram','linkedin'],
   'approved',
   1,
   ARRAY['education_hub_screenshot'])
ON CONFLICT (name) DO NOTHING;
