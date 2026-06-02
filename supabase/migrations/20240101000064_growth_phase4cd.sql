-- 20240101000064_growth_phase4cd.sql
--
-- Growth Engine V1 — Phase 4C (Discovery Queue) + 4D (Attribution).
--
-- Three new tables:
--
--   growth_discovery_items    Public posts surfaced from Reddit (and
--                             future RSS / X feeds) that the admin can
--                             review + reply to. AI-drafted replies
--                             are stored on the row; the admin posts
--                             manually from the brand account (no
--                             impersonation, no auto-publish to
--                             external platforms).
--
--   growth_visitors           One row per anonymous visitor (cookie
--                             id). Persists first-touch attribution
--                             through signup.
--
--   growth_attribution_events Funnel chain: pageview → signup →
--                             broker_connected → trade_synced →
--                             journal_created → strategy_created →
--                             premium_upgrade. Joined to growth_visitors
--                             and (after signup) to profiles.
--
-- All service-role only; RLS denies direct auth-user reads/writes.

-- ─── 1) Discovery items ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_discovery_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source: 'reddit' (MVP), 'rss', 'x' (future)
  source          text NOT NULL,
  -- Source-side id (Reddit post t3_xxx, RSS guid, etc.) — used for dedup.
  external_id     text NOT NULL,

  url             text NOT NULL,
  title           text NOT NULL,
  snippet         text,
  author          text,
  posted_at       timestamptz,

  topic_tags      text[] NOT NULL DEFAULT '{}',

  -- Lifecycle: queued (just scraped) → drafting (admin opened) →
  -- replied (admin marked as engaged) → dismissed (irrelevant /
  -- spam / off-topic).
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','drafting','replied','dismissed')),

  -- AI-drafted reply, populated by /api/admin/growth/discovery/draft-reply.
  -- NULL until the admin asks for one.
  ai_reply_draft  text,
  ai_reply_at     timestamptz,

  -- Score 0-100 from the topic-match heuristic — used to rank the
  -- queue so high-signal posts surface first.
  relevance       integer,

  -- Audit
  reviewed_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  notes           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_discovery_queue
  ON public.growth_discovery_items (status, relevance DESC, created_at DESC)
  WHERE status IN ('queued','drafting');

CREATE OR REPLACE FUNCTION public.set_discovery_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS discovery_updated_at ON public.growth_discovery_items;
CREATE TRIGGER discovery_updated_at
  BEFORE UPDATE ON public.growth_discovery_items
  FOR EACH ROW EXECUTE FUNCTION public.set_discovery_updated_at();


-- ─── 2) Visitors ─────────────────────────────────────────────────────
-- One row per __as_vid cookie. Created the first time middleware sees
-- a new visitor. Linked to a profile after signup via user_id.
CREATE TABLE IF NOT EXISTS public.growth_visitors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id      text NOT NULL UNIQUE,        -- the cookie value (uuid-shaped)

  -- First-touch attribution — captured on the first pageview.
  first_source    text,                        -- 'organic', 'referral', 'campaign'
  first_referrer  text,
  first_utm_source   text,
  first_utm_medium   text,
  first_utm_campaign text,
  first_utm_content  text,
  first_landing_path text,
  first_user_agent   text,
  first_country      text,

  -- Last-touch (refreshed every pageview).
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_landing_path text,

  -- Linked profile, populated by /api/track/event when 'signup' fires.
  user_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitors_user
  ON public.growth_visitors (user_id)
  WHERE user_id IS NOT NULL;


-- ─── 3) Attribution events — append-only funnel log ──────────────────
CREATE TABLE IF NOT EXISTS public.growth_attribution_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which funnel stage. Open enum to keep new events landing without
  -- migrations; the funnel dashboard reads canonical names below.
  --   pageview, signup, broker_connected, trade_synced,
  --   journal_created, strategy_created, premium_upgrade, churn
  event           text NOT NULL,

  visitor_id      text REFERENCES public.growth_visitors(visitor_id) ON DELETE SET NULL,
  user_id         uuid REFERENCES public.profiles(id)                ON DELETE SET NULL,

  -- Attribution source — what brought them here on this hop.
  source_kind     text,   -- 'organic','direct','referral','email','social','community','paid'
  source_id       text,   -- content_item id / utm_campaign / referrer host
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  referrer        text,
  path            text,

  -- Any extra payload (e.g. broker name on broker_connected).
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,

  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attribution_event_recent
  ON public.growth_attribution_events (event, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_attribution_visitor
  ON public.growth_attribution_events (visitor_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_attribution_user
  ON public.growth_attribution_events (user_id, occurred_at)
  WHERE user_id IS NOT NULL;


-- ─── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.growth_discovery_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_visitors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_attribution_events ENABLE ROW LEVEL SECURITY;
-- No SELECT / INSERT / UPDATE / DELETE policies — service-role only.


COMMENT ON TABLE public.growth_discovery_items IS
  'Phase 4C — public posts surfaced from Reddit (+ future RSS/X). Admin reviews + posts manually from brand account.';
COMMENT ON TABLE public.growth_visitors IS
  'Phase 4D — one row per __as_vid cookie. First-touch attribution preserved through signup.';
COMMENT ON TABLE public.growth_attribution_events IS
  'Phase 4D — append-only funnel log. Visitor → signup → broker → trade → journal → strategy → premium.';
