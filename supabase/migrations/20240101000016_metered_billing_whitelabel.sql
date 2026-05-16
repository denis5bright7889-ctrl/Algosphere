-- ============================================================
-- AlgoSphere Quant — API-Metered Billing + White-Label Config
-- Migration: 20240101000016_metered_billing_whitelabel.sql
-- ============================================================

-- Per-key monthly usage meter (atomic increment)
CREATE TABLE IF NOT EXISTS public.api_usage_meter (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_month  TEXT NOT NULL,                 -- YYYY-MM
  calls         INTEGER NOT NULL DEFAULT 0,
  included_quota INTEGER NOT NULL DEFAULT 10000,
  overage_calls INTEGER NOT NULL DEFAULT 0,
  overage_rate_usd NUMERIC(10,6) NOT NULL DEFAULT 0.0005,  -- $0.0005/call over quota
  overage_billed_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, period_month)
);

ALTER TABLE public.api_usage_meter ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_self_read"
  ON public.api_usage_meter FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "usage_system_write"
  ON public.api_usage_meter FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_api_usage_user
  ON public.api_usage_meter (user_id, period_month);

-- Atomic metered increment with quota + overage accrual
CREATE OR REPLACE FUNCTION public.bump_api_monthly_usage(
  p_user_id UUID,
  p_quota   INTEGER DEFAULT 10000
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_month TEXT := to_char(now(), 'YYYY-MM');
  v_calls INTEGER;
  v_over  INTEGER;
BEGIN
  INSERT INTO public.api_usage_meter (user_id, period_month, calls, included_quota)
  VALUES (p_user_id, v_month, 1, p_quota)
  ON CONFLICT (user_id, period_month) DO UPDATE
    SET calls = api_usage_meter.calls + 1,
        updated_at = now()
  RETURNING calls INTO v_calls;

  v_over := GREATEST(0, v_calls - p_quota);

  IF v_over > 0 THEN
    UPDATE public.api_usage_meter
    SET overage_calls = v_over,
        overage_billed_usd = ROUND(v_over * overage_rate_usd, 2)
    WHERE user_id = p_user_id AND period_month = v_month;
  END IF;

  RETURN jsonb_build_object(
    'calls', v_calls,
    'quota', p_quota,
    'overage_calls', v_over
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_api_monthly_usage TO authenticated, service_role;

-- White-label tenant config (one per enterprise license)
CREATE TABLE IF NOT EXISTS public.whitelabel_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id      UUID REFERENCES public.enterprise_licenses(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  brand_name      TEXT NOT NULL,
  primary_color   TEXT NOT NULL DEFAULT '#D4A017',
  logo_url        TEXT,
  custom_domain   TEXT UNIQUE,
  support_email   TEXT,
  hide_algosphere_branding BOOLEAN NOT NULL DEFAULT FALSE,
  feature_flags   JSONB DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','suspended')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.whitelabel_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "whitelabel_owner"
  ON public.whitelabel_configs FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "whitelabel_admin"
  ON public.whitelabel_configs FOR ALL USING (auth.role() = 'service_role');
