-- 20240101000050_telegram_communities.sql
--
-- Refocus R3: Premium Telegram Community Hub.
--
-- One row per admin-curated Telegram destination (group / channel /
-- bot). Users browse the catalogue on /communities and click out to
-- Telegram. AlgoSphere does NOT host posts itself — this table is a
-- directory, not a forum.
--
-- Writes happen only via the service-role admin endpoints
-- (/api/admin/communities/*). RLS lets every authenticated user READ
-- non-archived rows; the visibility-tier gate is applied in the
-- public read API so admins can still see locked / archived rows in
-- the admin UI without RLS gymnastics.

CREATE TABLE IF NOT EXISTS public.telegram_communities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text,

  -- Destination
  telegram_url    text NOT NULL,
  kind            text NOT NULL DEFAULT 'group'
                  CHECK (kind IN ('group','channel','bot')),

  -- Categorization (drives the filter chips on /communities)
  category        text NOT NULL DEFAULT 'discussion'
                  CHECK (category IN ('vip','signals','education',
                                      'discussion','news','tools','other')),

  -- Tier gate. The read API enforces visibility <= caller.tier.
  visibility      text NOT NULL DEFAULT 'free'
                  CHECK (visibility IN ('free','starter','premium','vip')),

  -- Curation
  is_featured     boolean NOT NULL DEFAULT false,
  is_pinned       boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 100,

  -- Optional media (URL only — Supabase Storage integration is a
  -- follow-up; admin UI accepts arbitrary HTTPS URLs for now).
  icon_url        text,
  banner_url      text,

  -- Optional manually-maintained metadata
  member_count    integer,

  -- Lifecycle
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for the public read path: pinned first, then sort_order,
-- then recency. Filtered index keeps it tight by skipping archived rows.
CREATE INDEX IF NOT EXISTS idx_telegram_communities_visible
  ON public.telegram_communities (is_pinned DESC, sort_order, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_telegram_communities_category
  ON public.telegram_communities (category)
  WHERE archived_at IS NULL;

-- updated_at trigger so PATCH endpoints don't need to set it manually
CREATE OR REPLACE FUNCTION public.set_telegram_communities_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS telegram_communities_updated_at ON public.telegram_communities;
CREATE TRIGGER telegram_communities_updated_at
  BEFORE UPDATE ON public.telegram_communities
  FOR EACH ROW EXECUTE FUNCTION public.set_telegram_communities_updated_at();


-- ─── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.telegram_communities ENABLE ROW LEVEL SECURITY;

-- Idempotent: drop+create so re-running the file does not collide.
DROP POLICY IF EXISTS telegram_communities_authn_read ON public.telegram_communities;
CREATE POLICY telegram_communities_authn_read
  ON public.telegram_communities FOR SELECT TO authenticated
  USING (archived_at IS NULL);

-- No INSERT/UPDATE/DELETE policy — service-role admin endpoints are
-- the only writers, bypassing RLS by design.

COMMENT ON TABLE public.telegram_communities IS
  'Admin-curated catalogue of external Telegram destinations. Read by /communities, written by /api/admin/communities/*. Refocus R3.';
