-- ============================================================
-- AlgoSphere Quant — Enterprise & White-Label Licensing
-- Migration: 20240101000014_enterprise_licensing.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.enterprise_licenses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name           TEXT NOT NULL,
  org_domain         TEXT,
  contact_email      TEXT NOT NULL,
  contact_name       TEXT,
  plan               TEXT NOT NULL DEFAULT 'enterprise'
                       CHECK (plan IN ('team','business','white_label','broker_partnership')),
  seat_count         INTEGER NOT NULL DEFAULT 10,
  seat_used          INTEGER NOT NULL DEFAULT 0,
  price_per_seat     NUMERIC(10,2),
  flat_monthly_fee   NUMERIC(12,2),
  billing_interval   TEXT NOT NULL DEFAULT 'annual'
                       CHECK (billing_interval IN ('monthly','annual')),
  status             TEXT NOT NULL DEFAULT 'lead'
                       CHECK (status IN ('lead','negotiating','active','suspended','churned')),
  features_override  JSONB DEFAULT '{}',
  white_label_config JSONB DEFAULT '{}',
  api_rate_limit     INTEGER DEFAULT 10000,
  custom_domain      TEXT,
  sso_provider       TEXT,
  sso_config         JSONB DEFAULT '{}',
  contract_start     DATE,
  contract_end       DATE,
  auto_renew         BOOLEAN NOT NULL DEFAULT TRUE,
  account_manager    TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.enterprise_seats (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id   UUID NOT NULL REFERENCES public.enterprise_licenses(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member'
                 CHECK (role IN ('owner','admin','member','viewer')),
  status       TEXT NOT NULL DEFAULT 'invited'
                 CHECK (status IN ('invited','active','suspended','removed')),
  invited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at  TIMESTAMPTZ,
  UNIQUE (license_id, email)
);

-- Enterprise enquiries are public-writable (lead form), admin-readable.
ALTER TABLE public.enterprise_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_seats    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "enterprise_lead_insert"
  ON public.enterprise_licenses FOR INSERT
  WITH CHECK (status = 'lead');

CREATE POLICY "enterprise_admin_all"
  ON public.enterprise_licenses FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "seats_member_read"
  ON public.enterprise_seats FOR SELECT
  USING (user_id = auth.uid() OR auth.role() = 'service_role');

CREATE POLICY "seats_admin_all"
  ON public.enterprise_seats FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_ent_licenses_status
  ON public.enterprise_licenses (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ent_seats_license
  ON public.enterprise_seats (license_id, status);
