-- 20240101000058_growth_phase2.sql
--
-- Growth Engine V1 — Phase 2: Brand Settings + Social Distribution
-- scheduler.
--
-- Three tables:
--
--   growth_brand_settings  Singleton row (constraint id = 1) that
--                          holds brand voice, default CTAs, social
--                          handles, default disclaimers.
--
--   growth_scheduled_posts One row per (content_item × channel ×
--                          send_at). Lifecycle queued → posting →
--                          posted (or failed). The worker reads rows
--                          where status='queued' AND send_at <= now()
--                          and tries to post; an attempt row is
--                          appended on every try.
--
--   growth_post_attempts   Append-only audit log of every post
--                          attempt — channel response payload, error,
--                          duration.
--
-- All writes are admin-only via service role; RLS denies direct
-- writes from auth users. Brand settings + scheduled posts are
-- admin-visible only (no public read policy) — the public surface
-- never needs them.

-- ── brand_settings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_brand_settings (
  id              integer PRIMARY KEY DEFAULT 1
                  CHECK (id = 1),                            -- singleton
  brand_voice     text NOT NULL DEFAULT 'Direct, expert, no hype. Lead with verifiable numbers.',
  signature       text NOT NULL DEFAULT '— Team AlgoSphere',
  default_cta     text NOT NULL DEFAULT 'Try AlgoSphere',
  default_cta_url text NOT NULL DEFAULT 'https://algospherequant.com',
  legal_footer    text NOT NULL DEFAULT 'Trading involves risk of loss. Past performance is not indicative of future results.',
  social          jsonb NOT NULL DEFAULT '{}'::jsonb,        -- { x: '@algosphere', telegram: '...', discord: '...', linkedin: '...', instagram: '...' }
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed the singleton if it isn't there yet.
INSERT INTO public.growth_brand_settings (id)
  VALUES (1)
  ON CONFLICT (id) DO NOTHING;


-- ── scheduled_posts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_scheduled_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id      uuid NOT NULL REFERENCES public.growth_content_items(id) ON DELETE CASCADE,

  channel         text NOT NULL
                  CHECK (channel IN (
                    'x', 'telegram', 'discord', 'linkedin',
                    'instagram', 'facebook', 'youtube',
                    'whatsapp_channel', 'instagram_reels', 'youtube_shorts'
                  )),

  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'posting', 'posted', 'failed', 'cancelled')),

  -- When to fire. Worker picks rows where status='queued' AND send_at <= now().
  send_at         timestamptz NOT NULL DEFAULT now(),

  -- Optional channel-specific override (e.g. an X thread that uses
  -- a different headline than the base content_item). null = use the
  -- content_item body.
  body_override   text,
  hero_image_url  text,

  -- Filled by the worker when status transitions to posted.
  posted_at       timestamptz,
  /** Channel-side ID (e.g. tweet ID, Telegram message ID). */
  external_id     text,
  /** Channel-side permalink (deep link). */
  external_url    text,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  last_attempt_at timestamptz,

  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_queue
  ON public.growth_scheduled_posts (send_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_content
  ON public.growth_scheduled_posts (content_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_channel_status
  ON public.growth_scheduled_posts (channel, status, send_at DESC);


-- ── post_attempts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_post_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_id    uuid NOT NULL REFERENCES public.growth_scheduled_posts(id) ON DELETE CASCADE,
  channel         text NOT NULL,
  attempt_number  integer NOT NULL,
  succeeded       boolean NOT NULL,
  duration_ms     integer,
  response        jsonb,                   -- raw provider response (truncated app-side)
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_attempts_scheduled
  ON public.growth_post_attempts (scheduled_id, attempt_number DESC);


-- ── RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.growth_brand_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_scheduled_posts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_post_attempts    ENABLE ROW LEVEL SECURITY;

-- No SELECT policies anywhere — every read goes through the service-
-- role admin endpoints. Same write story: no INSERT/UPDATE/DELETE
-- policies, so RLS blocks all non-service-role writes.

COMMENT ON TABLE public.growth_brand_settings IS
  'Growth Engine V1 Phase 2 — brand voice + default CTAs + social handles. Singleton row (id=1). Service-role only.';
COMMENT ON TABLE public.growth_scheduled_posts IS
  'Growth Engine V1 Phase 2 — schedule queue. Worker polls status=queued AND send_at<=now().';
COMMENT ON TABLE public.growth_post_attempts IS
  'Growth Engine V1 Phase 2 — append-only audit log per post attempt.';
