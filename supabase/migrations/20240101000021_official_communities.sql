-- ============================================================
-- AlgoSphere Quant — Official communities (vs. user-published)
-- Migration: 20240101000021_official_communities.sql
-- ============================================================
-- Separate from user-published `premium_communities`: these are the platform's
-- own free + VIP rooms (Telegram, WhatsApp, Discord). One row per channel.

CREATE TABLE IF NOT EXISTS public.official_communities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,        -- 'telegram-free', 'whatsapp-vip', etc.
  name            TEXT NOT NULL,
  platform        TEXT NOT NULL
                    CHECK (platform IN ('telegram','whatsapp','discord','slack')),
  description     TEXT,
  invite_url      TEXT NOT NULL,
  required_tier   TEXT NOT NULL DEFAULT 'free'
                    CHECK (required_tier IN ('free','starter','premium','vip')),
  member_count    INTEGER NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_official_communities_tier
  ON public.official_communities (required_tier, active, display_order);

ALTER TABLE public.official_communities ENABLE ROW LEVEL SECURITY;

-- Anyone can read; only the SECURITY DEFINER RPC below decides what to expose
-- in invite URL form (it strips invite_url for users who can't enter).
CREATE POLICY "official_communities_public_read"
  ON public.official_communities FOR SELECT USING (active = TRUE);

-- Admin writes only
CREATE POLICY "official_communities_service_write"
  ON public.official_communities FOR ALL USING (auth.role() = 'service_role');

-- Tier hierarchy helper: returns numeric rank for ordering
CREATE OR REPLACE FUNCTION public.tier_rank(t TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE t
    WHEN 'free'    THEN 0
    WHEN 'starter' THEN 1
    WHEN 'premium' THEN 2
    WHEN 'vip'     THEN 3
    ELSE 0
  END;
$$;

-- The endpoint users hit. Strips invite_url for under-tier requesters so the
-- secret link never leaks via the RLS-readable table even with API access.
CREATE OR REPLACE FUNCTION public.my_official_communities()
RETURNS TABLE (
  slug          TEXT,
  name          TEXT,
  platform      TEXT,
  description   TEXT,
  required_tier TEXT,
  member_count  INTEGER,
  invite_url    TEXT,
  has_access    BOOLEAN,
  display_order INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_tier TEXT;
BEGIN
  -- Get caller's subscription tier (or 'free' if unauthenticated)
  SELECT COALESCE(subscription_tier, 'free') INTO v_tier
  FROM   public.profiles
  WHERE  id = auth.uid();

  v_tier := COALESCE(v_tier, 'free');

  RETURN QUERY
  SELECT
    oc.slug,
    oc.name,
    oc.platform,
    oc.description,
    oc.required_tier,
    oc.member_count,
    CASE
      WHEN public.tier_rank(v_tier) >= public.tier_rank(oc.required_tier)
        THEN oc.invite_url
      ELSE NULL
    END AS invite_url,
    public.tier_rank(v_tier) >= public.tier_rank(oc.required_tier) AS has_access,
    oc.display_order
  FROM public.official_communities oc
  WHERE oc.active = TRUE
  ORDER BY oc.display_order, oc.required_tier, oc.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_official_communities TO anon, authenticated;

-- Seed defaults — replace invite_url values in production
INSERT INTO public.official_communities
  (slug, name, platform, description, invite_url, required_tier, display_order)
VALUES
  ('telegram-free',     'AlgoSphere Community',   'telegram',
    'Free public community — daily market analysis, signal previews, education.',
    'https://t.me/algosphere',         'free',    1),
  ('telegram-starter',  'Starter Trader Lounge',  'telegram',
    'Starter+ members. Daily breakdowns, Q&A with verified traders, alerts.',
    'https://t.me/+placeholder-starter','starter', 2),
  ('telegram-pro',      'Pro Signal Room',        'telegram',
    'Pro+ members. Priority signals, live trade-along sessions, weekly reviews.',
    'https://t.me/+placeholder-pro',    'premium', 3),
  ('telegram-vip',      'VIP Institutional Desk', 'telegram',
    'VIP only. Smart-money flow, whale alerts, institutional commentary, 1:1 mentorship windows.',
    'https://t.me/+placeholder-vip',    'vip',     4),
  ('whatsapp-vip',      'VIP WhatsApp Channel',   'whatsapp',
    'VIP only. Critical alerts: risk events, kill switches, prop breach warnings.',
    'https://wa.me/+placeholder',       'vip',     5),
  ('discord-pro',       'Pro Discord',            'discord',
    'Pro+ members. Voice rooms, screen-share analysis, dedicated channels per asset class.',
    'https://discord.gg/placeholder',   'premium', 6)
ON CONFLICT (slug) DO NOTHING;
