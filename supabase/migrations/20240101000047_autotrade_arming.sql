-- 20240101000047_autotrade_arming.sql
--
-- AlgoSphereQuant Spec — Sections 2, 10, 11, 14.
--
-- Adds the arming surface required before the autonomous execution path
-- may emit any order on a user's broker:
--
--   profiles.full_autotrade_enabled   master arming flag. The engine
--                                     /execute path refuses orders when
--                                     this is FALSE for the calling user.
--   profiles.trading_mode             Conservative | Balanced | Aggressive
--                                     | Manual. Drives confidence threshold
--                                     and sizing multipliers downstream.
--   profiles.autotrade_armed_at       UTC timestamp of the most recent arm
--                                     event. Cleared on disarm. Audit-only.
--   profiles.autotrade_disarmed_at    UTC timestamp of the most recent
--                                     disarm event. Audit-only.
--   profiles.autotrade_consent_version  Highest consent doc version the
--                                       user has accepted. Refused if the
--                                       deployed version is newer.
--
--   user_consents                     Immutable acceptance log. Every arm
--                                     event MUST append a row referencing
--                                     the consent doc version, IP, UA.
--                                     RLS: self-read only; service-role
--                                     inserts.
--
--   panic_close_events                Audit log of /panic-close clicks.
--                                     Service-role write; self-read.
--
-- Backwards compatibility
-- ----------------------
-- Defaults intentionally fail-CLOSED: every existing profile starts with
-- full_autotrade_enabled = FALSE and trading_mode = 'manual'. No existing
-- live user is auto-promoted into autonomous execution by this migration.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_autotrade_enabled    boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trading_mode              text      NOT NULL DEFAULT 'manual'
    CHECK (trading_mode IN ('conservative','balanced','aggressive','manual')),
  ADD COLUMN IF NOT EXISTS autotrade_armed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS autotrade_disarmed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS autotrade_consent_version integer   NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.full_autotrade_enabled IS
  'AlgoSphereQuant FULL_AUTOTRADE arming flag (spec section 2). The engine /execute path MUST refuse orders when this is false.';
COMMENT ON COLUMN public.profiles.trading_mode IS
  'Autonomous execution profile: conservative | balanced | aggressive | manual. Drives confidence-threshold and sizing-multiplier overrides.';
COMMENT ON COLUMN public.profiles.autotrade_consent_version IS
  'Highest consent doc version the user has accepted. Engine refuses execution when deployed CONSENT_DOC_VERSION > this.';

-- ─── user_consents ─────────────────────────────────────────────────────
-- One row per acceptance event. Insert-only from /api/trading/arm.
-- Carries the doc version, IP, UA, and arming mode for legal/audit.
CREATE TABLE IF NOT EXISTS public.user_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  consent_kind    text NOT NULL CHECK (consent_kind IN ('autotrade_arming','autotrade_disarming','panic_close')),
  consent_version integer NOT NULL,
  trading_mode    text,
  ip_address      text,
  user_agent      text,
  accepted_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_consents_user_idx
  ON public.user_consents (user_id, accepted_at DESC);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

-- Self-read: a user can pull their own consent history.
DROP POLICY IF EXISTS "user_consents self read" ON public.user_consents;
CREATE POLICY "user_consents self read"
  ON public.user_consents FOR SELECT
  USING (auth.uid() = user_id);

-- Writes only via service role (the /api/trading/arm route uses the
-- service client). No client-facing INSERT policy on purpose.

COMMENT ON TABLE public.user_consents IS
  'Immutable audit log of arming / disarming / panic-close acceptance (spec section 14).';


-- ─── panic_close_events ────────────────────────────────────────────────
-- Audit of every panic-close invocation. Lets ops trace the reason a
-- user's positions were flattened.
CREATE TABLE IF NOT EXISTS public.panic_close_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  brokers       text[] NOT NULL DEFAULT '{}',
  positions_closed integer NOT NULL DEFAULT 0,
  reason        text,
  ip_address    text,
  user_agent    text,
  engine_response jsonb
);

CREATE INDEX IF NOT EXISTS panic_close_events_user_idx
  ON public.panic_close_events (user_id, triggered_at DESC);

ALTER TABLE public.panic_close_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "panic_close_events self read" ON public.panic_close_events;
CREATE POLICY "panic_close_events self read"
  ON public.panic_close_events FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.panic_close_events IS
  'Audit trail of /api/trading/panic-close invocations (spec section 10).';
