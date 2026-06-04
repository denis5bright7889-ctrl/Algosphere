-- 20240101000070_growth_blog_video_rules.sql
--
-- Phase 6D — Daily blog + daily video slots for the daily-content
-- orchestrator.
--
-- Adds two rules:
--   1. educational.blog  → content_kind 'educational', asset_kinds
--      ['educational_blog']. The blog producer writes a NEW
--      growth_content_items row with status='published' that the
--      /blog page serves automatically.
--   2. video.daily       → content_kind 'educational', asset_kinds
--      ['educational_video']. The video producer runs Remotion +
--      edge-tts to render MP4 + JPG thumbnail.
--
-- output_status='approved' (auto-publish, no admin review) — both
-- pieces are deterministic educational content; the auto-publish
-- whitelist in lib/growth/automation.ts already permits
-- 'educational' content_kind.
--
-- Idempotent via uq_automation_rules_name unique index.

INSERT INTO public.growth_automation_rules
  (name, description, event_type, predicate, content_kind, channels,
   output_status, daily_cap, asset_kinds)
VALUES
  ('educational.blog → daily blog auto-publish',
   'Daily blog article — composed from a rotating educational topic table. The blog producer inserts a NEW content_items row that /blog serves automatically.',
   'educational.blog',
   '{}'::jsonb,
   'educational',
   ARRAY['discord','telegram','linkedin'],
   'approved',
   1,
   ARRAY['educational_blog']),

  ('video.daily → daily educational video auto-publish',
   'Daily short-form educational video — composed from a rotating topic, narrated via edge-tts, rendered through Remotion''s event_video composition. Produces MP4 + JPG thumbnail.',
   'video.daily',
   '{}'::jsonb,
   'educational',
   ARRAY['discord','telegram'],
   'approved',
   1,
   ARRAY['educational_video'])
ON CONFLICT (name) DO NOTHING;
