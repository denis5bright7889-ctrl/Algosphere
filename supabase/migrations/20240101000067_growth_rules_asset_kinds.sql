-- 20240101000067_growth_rules_asset_kinds.sql
--
-- Extends growth_automation_rules with asset_kinds so a rule can
-- declare what visual assets the worker should produce for every
-- content_item it spawns. Empty array = text-only (legacy behaviour).
--
-- Set via /admin/growth/automation editor or directly:
--   UPDATE growth_automation_rules
--   SET asset_kinds = ARRAY['signal_card','signal_chart_screenshot']
--   WHERE event_type = 'signal.published';

ALTER TABLE public.growth_automation_rules
  ADD COLUMN IF NOT EXISTS asset_kinds TEXT[] NOT NULL DEFAULT '{}';
