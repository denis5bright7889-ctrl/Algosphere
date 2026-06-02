-- 20240101000059_growth_phase3.sql
--
-- Growth Engine V1 — Phase 3: SEO + Email + Lead Capture foundation.
--
-- Three changes:
--   1. Extend `leads` with attribution columns (source, utm_*, status).
--   2. New `newsletter_subscribers` table — explicit opt-in audience,
--      kept separate from the broader `leads` capture pool.
--   3. Add `slug` to `growth_content_items` so /blog/[slug] can resolve
--      a stable SEO URL.
--
-- All changes idempotent (IF NOT EXISTS) — safe to re-run.

-- ─── 1) Extend leads ───────────────────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source       text,                  -- 'landing', 'blog', 'twitter', etc.
  ADD COLUMN IF NOT EXISTS utm_source   text,
  ADD COLUMN IF NOT EXISTS utm_medium   text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content  text,
  ADD COLUMN IF NOT EXISTS referrer     text,
  ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'new'
                            CHECK (status IN ('new','contacted','converted','unsubscribed')),
  ADD COLUMN IF NOT EXISTS welcome_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_status_created
  ON public.leads (status, created_at DESC);


-- ─── 2) Newsletter subscribers ─────────────────────────────────────
-- Explicit opt-in audience for newsletters / weekly digest / sequences.
-- Separate from `leads` because the consent surface is different — a
-- newsletter subscriber has clicked the "subscribe" toggle on a page
-- (or the email link), not just dropped their email in a CTA.
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  -- 'pending'    : awaiting double-opt-in click
  -- 'subscribed' : confirmed, will receive sends
  -- 'unsubscribed': opted out (kept in row so future opts re-use it)
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','subscribed','unsubscribed')),
  confirmation_token text UNIQUE,
  confirmed_at    timestamptz,
  unsubscribed_at timestamptz,
  source          text,                                     -- 'landing', 'blog', 'in_app'
  user_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_status
  ON public.newsletter_subscribers (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_newsletter_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS newsletter_updated_at ON public.newsletter_subscribers;
CREATE TRIGGER newsletter_updated_at
  BEFORE UPDATE ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.set_newsletter_updated_at();

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
-- No policies — service-role-only writes/reads. The /api/newsletter
-- routes are public for INSERT (signup) but use the service-role
-- client to bypass RLS; SELECT/UPDATE are admin-only.


-- ─── 3) Slug on growth_content_items ───────────────────────────────
-- /blog/[slug] reads content_items where status='published'. Slug is
-- nullable so existing rows don't break — the blog index falls back
-- to id for any item without a slug.
ALTER TABLE public.growth_content_items
  ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_content_slug
  ON public.growth_content_items (slug)
  WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_growth_content_blog_index
  ON public.growth_content_items (published_at DESC)
  WHERE status = 'published' AND slug IS NOT NULL;


COMMENT ON COLUMN public.leads.source IS
  'Acquisition channel (landing | blog | telegram | x | discord | ...) — populated by /api/leads.';
COMMENT ON TABLE public.newsletter_subscribers IS
  'Explicit-opt-in newsletter audience. Separate from `leads`. Service-role only.';
COMMENT ON COLUMN public.growth_content_items.slug IS
  'URL-safe slug for /blog/[slug]. Optional — items without slug are admin-only.';
