-- 20240101000057_growth_content.sql
--
-- Growth Engine V1 — Phase 1.
--
-- Centralised content lifecycle for the internal marketing system.
-- Each row is a single content artifact (Strategy of the Week, Backtest
-- Breakdown, Market Report, Product Update, Educational, Psychology
-- Insight) moving through Draft → Review → Approved → Scheduled →
-- Published / Archived / Rejected.
--
-- Compliance contract (enforced at the API + UI layer; the DB stores
-- the metadata that lets the contract be checked):
--   • Every content_item has a `provenance` jsonb pointer to the real
--     platform record that backs it (strategy + version + backtest run,
--     scanner snapshot, journal entry). For purely educational content
--     the provenance is { type: 'educational' }.
--   • Every published item has a non-empty `disclaimer` string. The
--     UI refuses to flip status='published' if the disclaimer is empty.
--   • `is_synthetic` is true when the underlying source is sample /
--     hypothetical / backtest (i.e. NOT live user activity). The UI
--     surfaces a visible "Example / Backtest" label whenever this is
--     true so we can never accidentally publish synthetic content as
--     if it were real user activity.
--
-- Writes are admin-only via the service role; RLS denies all direct
-- writes from regular auth users. Reads on PUBLISHED rows are open to
-- everyone (anon + authn) so the public marketing surface can read
-- without auth.

CREATE TABLE IF NOT EXISTS public.growth_content_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Content type drives the template / channel mapping. Open enum so
  -- new types can be added without a migration.
  kind            text NOT NULL
                  CHECK (kind IN (
                    'strategy_of_the_week', 'backtest_breakdown',
                    'market_report', 'product_update',
                    'psychology_insight', 'educational', 'announcement'
                  )),

  -- Lifecycle.
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN (
                    'draft', 'review', 'approved',
                    'scheduled', 'published', 'archived', 'rejected'
                  )),

  -- Body.
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  summary         text CHECK (summary IS NULL OR length(summary) <= 1000),
  body_md         text NOT NULL,             -- markdown source-of-truth
  hero_image_url  text,
  tags            text[] NOT NULL DEFAULT '{}',

  -- Where to publish. Each channel adapter reads this and shapes the
  -- body for its medium (thread, post, carousel, etc.).
  channels        text[] NOT NULL DEFAULT '{}',

  -- Compliance metadata — see header comment.
  provenance      jsonb  NOT NULL DEFAULT '{"type":"manual"}'::jsonb,
  is_synthetic    boolean NOT NULL DEFAULT false,
  disclaimer      text,
  cta_text        text,
  cta_url         text,

  -- Scheduling.
  scheduled_for   timestamptz,
  published_at    timestamptz,

  -- Authorship + audit.
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_reason text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_content_status
  ON public.growth_content_items (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_content_kind
  ON public.growth_content_items (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_content_published
  ON public.growth_content_items (published_at DESC)
  WHERE status = 'published';


-- ── Asset library — images / videos / templates referenced by items.
CREATE TABLE IF NOT EXISTS public.growth_content_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL
                  CHECK (kind IN ('image', 'video', 'template', 'graphic')),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  storage_url     text NOT NULL,           -- Supabase Storage path / public URL
  mime_type       text,
  file_size_bytes bigint,
  tags            text[] NOT NULL DEFAULT '{}',
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_assets_kind
  ON public.growth_content_assets (kind, created_at DESC);


-- ── updated_at trigger
CREATE OR REPLACE FUNCTION public.set_growth_content_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS growth_content_updated_at ON public.growth_content_items;
CREATE TRIGGER growth_content_updated_at
  BEFORE UPDATE ON public.growth_content_items
  FOR EACH ROW EXECUTE FUNCTION public.set_growth_content_updated_at();


-- ── RLS — writes admin-only via service role; reads open on published.
ALTER TABLE public.growth_content_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_content_assets ENABLE ROW LEVEL SECURITY;

-- Drop+create so re-runs stay idempotent.
DROP POLICY IF EXISTS growth_content_public_read  ON public.growth_content_items;
DROP POLICY IF EXISTS growth_assets_public_read   ON public.growth_content_assets;

-- Published items are world-readable (anon + authenticated). All other
-- statuses are invisible to RLS readers; admin reads go through the
-- service role and bypass these policies.
CREATE POLICY growth_content_public_read
  ON public.growth_content_items FOR SELECT
  USING (status = 'published');

CREATE POLICY growth_assets_public_read
  ON public.growth_content_assets FOR SELECT
  USING (true);

-- No INSERT/UPDATE/DELETE policies — only the service-role admin
-- endpoints can write. This is intentional; a regular auth user must
-- never be able to publish marketing content.

COMMENT ON TABLE public.growth_content_items IS
  'Growth Engine V1 Phase 1 — content lifecycle. Writes via service role only; published rows are world-readable. provenance + is_synthetic + disclaimer enforce the compliance contract.';
COMMENT ON TABLE public.growth_content_assets IS
  'Growth Engine V1 Phase 1 — uploaded marketing assets (images / videos / templates).';
