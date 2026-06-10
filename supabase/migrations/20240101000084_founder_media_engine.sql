-- 20240101000080_founder_media_engine.sql
--
-- Founder Media Engine: real AlgoSphere events → founder-diary stories →
-- Instagram REELS (reels-first; image cards are the fallback, not the default).
--
-- Adds:
--   growth_source_events      — normalized ingestion layer (logs/commits/
--                               trading events/alerts/manual notes)
--   growth_content_items.*     — content_format + hook + source_event_id +
--                               story (so a queued item carries its narrative)
--   growth_content_performance — per-post IG metrics for the feedback loop
-- Idempotent. Apply with: supabase db push

-- ── 1. Event ingestion ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_source_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts          timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL,            -- git | trading | backend_log | alert | manual
  event_type  text NOT NULL,            -- commit | signal_win | signal_loss | latency | error | cron_fail | broker_issue | note
  raw_data    jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity    text NOT NULL DEFAULT 'info'   -- info | notable | high | critical
              CHECK (severity IN ('info','notable','high','critical')),
  dedup_key   text UNIQUE,             -- skip re-ingesting the same source fact
  processed   boolean NOT NULL DEFAULT false,
  story       jsonb,                    -- extracted founder story (see story.py)
  content_item_id uuid REFERENCES public.growth_content_items(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gse_unprocessed ON public.growth_source_events (processed, severity, ts DESC);
CREATE INDEX IF NOT EXISTS idx_gse_source      ON public.growth_source_events (source, ts DESC);

-- ── 2. Content items: narrative + format columns ─────────────────────────────
ALTER TABLE public.growth_content_items ADD COLUMN IF NOT EXISTS content_format  text;   -- reel | carousel | caption
ALTER TABLE public.growth_content_items ADD COLUMN IF NOT EXISTS hook            text;
ALTER TABLE public.growth_content_items ADD COLUMN IF NOT EXISTS source_event_id uuid REFERENCES public.growth_source_events(id) ON DELETE SET NULL;
ALTER TABLE public.growth_content_items ADD COLUMN IF NOT EXISTS story           jsonb;

-- ── 3. Performance feedback loop ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_content_performance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid REFERENCES public.growth_content_items(id) ON DELETE CASCADE,
  channel         text NOT NULL DEFAULT 'instagram',
  ig_media_id     text,
  likes           integer NOT NULL DEFAULT 0,
  comments        integer NOT NULL DEFAULT 0,
  saves           integer NOT NULL DEFAULT 0,
  shares          integer NOT NULL DEFAULT 0,
  reach           integer NOT NULL DEFAULT 0,
  impressions     integer NOT NULL DEFAULT 0,
  watch_time_s    numeric,
  engagement_rate numeric,              -- (likes+comments+saves+shares)/reach
  hook            text,                 -- denormalized so we can rank hooks fast
  emotion_type    text,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_item_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_gcp_eng ON public.growth_content_performance (engagement_rate DESC NULLS LAST);

-- ── RLS — service-write, admin-read (matches growth_* convention) ────────────
ALTER TABLE public.growth_source_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_content_performance ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['growth_source_events','growth_content_performance']
  LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS "%1$s_admin_read" ON public.%1$s;
      CREATE POLICY "%1$s_admin_read" ON public.%1$s FOR SELECT
        USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.account_type = 'admin'));
      DROP POLICY IF EXISTS "%1$s_service_write" ON public.%1$s;
      CREATE POLICY "%1$s_service_write" ON public.%1$s FOR ALL
        USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
    $f$, t);
  END LOOP;
END $$;
