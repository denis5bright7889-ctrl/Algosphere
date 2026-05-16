-- ============================================================
-- AlgoSphere Quant — Telegram Premium Communities + Token Launchpad
-- Migration: 20240101000015_premium_communities_launchpad.sql
-- ============================================================

-- ─── TELEGRAM PREMIUM COMMUNITIES ───────────────────────────

CREATE TABLE IF NOT EXISTS public.premium_communities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT CHECK (char_length(description) <= 2000),
  telegram_invite_link TEXT,
  telegram_chat_id BIGINT,
  price_monthly   NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_annual    NUMERIC(10,2),
  is_free         BOOLEAN NOT NULL DEFAULT FALSE,
  member_count    INTEGER NOT NULL DEFAULT 0,
  perks           TEXT[] DEFAULT '{}',
  creator_pct     NUMERIC(5,2) NOT NULL DEFAULT 80.0,
  platform_pct    NUMERIC(5,2) NOT NULL DEFAULT 20.0,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('draft','active','suspended','archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.community_memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    UUID NOT NULL REFERENCES public.premium_communities(id) ON DELETE CASCADE,
  member_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan            TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (plan IN ('free','monthly','annual')),
  amount_paid_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','expired','cancelled')),
  telegram_user_id BIGINT,
  access_granted  BOOLEAN NOT NULL DEFAULT FALSE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  UNIQUE (community_id, member_id)
);

ALTER TABLE public.premium_communities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "communities_public_read"
  ON public.premium_communities FOR SELECT
  USING (status = 'active' OR owner_id = auth.uid());
CREATE POLICY "communities_owner_manage"
  ON public.premium_communities FOR ALL USING (owner_id = auth.uid());

CREATE POLICY "memberships_self"
  ON public.community_memberships FOR ALL USING (member_id = auth.uid());
CREATE POLICY "memberships_owner_read"
  ON public.community_memberships FOR SELECT
  USING (community_id IN (
    SELECT id FROM public.premium_communities WHERE owner_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_communities_active
  ON public.premium_communities (status, member_count DESC);
CREATE INDEX IF NOT EXISTS idx_memberships_member
  ON public.community_memberships (member_id, status);

-- ─── TOKEN LAUNCHPAD ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.token_launches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_name    TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  ticker          TEXT NOT NULL,
  chain           TEXT NOT NULL DEFAULT 'ethereum'
                    CHECK (chain IN ('ethereum','bsc','polygon','arbitrum','base','solana')),
  description     TEXT CHECK (char_length(description) <= 5000),
  logo_url        TEXT,
  website         TEXT,
  -- Tokenomics
  total_supply    NUMERIC(40,0),
  decimals        INTEGER DEFAULT 18,
  tokenomics      JSONB DEFAULT '{}',     -- {team:15, public:40, liquidity:25, ...}
  -- Launch config
  presale_price   NUMERIC(30,12),
  listing_price   NUMERIC(30,12),
  soft_cap_usd    NUMERIC(20,2),
  hard_cap_usd    NUMERIC(20,2),
  raised_usd      NUMERIC(20,2) DEFAULT 0,
  liquidity_lock_days INTEGER DEFAULT 180,
  vesting_config  JSONB DEFAULT '{}',
  -- Contract (managed-deploy — populated by ops once deployed)
  contract_address TEXT,
  deploy_tx        TEXT,
  liquidity_locked BOOLEAN NOT NULL DEFAULT FALSE,
  -- Service tier
  service_tier    TEXT NOT NULL DEFAULT 'standard'
                    CHECK (service_tier IN ('standard','premium','full_managed')),
  service_fee_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Lifecycle
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','review','approved','presale','live','listed','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.launch_investors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id     UUID NOT NULL REFERENCES public.token_launches(id) ON DELETE CASCADE,
  investor_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  wallet_address TEXT,
  amount_usd    NUMERIC(20,2) NOT NULL,
  token_alloc   NUMERIC(40,8),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','refunded')),
  txid          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.token_launches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_investors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "launches_public_read"
  ON public.token_launches FOR SELECT
  USING (status IN ('presale','live','listed') OR founder_id = auth.uid());
CREATE POLICY "launches_founder_manage"
  ON public.token_launches FOR ALL USING (founder_id = auth.uid());

CREATE POLICY "investors_self"
  ON public.launch_investors FOR ALL USING (investor_id = auth.uid());
CREATE POLICY "investors_founder_read"
  ON public.launch_investors FOR SELECT
  USING (launch_id IN (
    SELECT id FROM public.token_launches WHERE founder_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_launches_status
  ON public.token_launches (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_launch_investors
  ON public.launch_investors (launch_id, status);
