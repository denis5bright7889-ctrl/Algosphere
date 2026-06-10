-- 20240101000078_growth_aggregate_rules.sql
--
-- Phases 3 + 4 + 5 of the growth content expansion. Three new
-- automation rules wired to three new content_kinds, each fired by
-- the daily-content cron via a day-of-week guard so aggregates land
-- once per week (not 7x).
--
-- Sample-gated by design — the aggregators return null when below
-- threshold, the dispatch in automation.ts double-checks the
-- payload\'s sample_size, and the rule\'s daily_cap=1 prevents
-- duplicate runs within a calendar day.
--
-- All three are auto-publish (in AUTO_PUBLISH_KINDS) because:
--   • coach.insights.weekly  — anonymised aggregate, no individual user
--   • broker.truth.weekly    — anonymised aggregate, no individual trade
--   • performance.transparency.weekly — AlgoSphere\'s OWN signal
--     performance, not user trades

INSERT INTO public.growth_automation_rules
  (name, description, event_type, predicate, content_kind, channels,
   output_status, daily_cap, asset_kinds)
VALUES
  ('coach.insights.weekly → Coach Insights publish',
   'Weekly aggregate of AlgoSphere V3 coach evaluations — five-axis means, top "what to fix" themes, grade mix. Sample-gated at 10 evaluations; aggregator skips silently below threshold.',
   'coach.insights.weekly',
   '{}'::jsonb,
   'coach_insights',
   ARRAY['discord','telegram','linkedin'],
   'approved',
   1,
   ARRAY['weekly_stats_card']),

  ('broker.truth.weekly → Broker Truth Analytics publish',
   'Weekly aggregate of broker-detected closed trades across all users — win rate, hold duration, P&L, most-traded pairs. Sample-gated at 20 trades; anonymised aggregate only.',
   'broker.truth.weekly',
   '{}'::jsonb,
   'broker_truth',
   ARRAY['discord','telegram','linkedin','facebook'],
   'approved',
   1,
   ARRAY['weekly_stats_card','weekly_infographic']),

  ('performance.transparency.weekly → Signal Performance publish',
   'Weekly aggregate of AlgoSphere''s OWN signal performance — published / settled / win rate / R-multiple. Sample-gated at 30 published signals; outcome metrics suppressed below threshold.',
   'performance.transparency.weekly',
   '{}'::jsonb,
   'performance_transparency',
   ARRAY['discord','telegram','linkedin','facebook'],
   'approved',
   1,
   ARRAY['weekly_stats_card','weekly_infographic','performance_screenshot'])
ON CONFLICT (name) DO NOTHING;
