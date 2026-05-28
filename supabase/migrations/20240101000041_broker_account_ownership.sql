-- 20240101000041_broker_account_ownership.sql
--
-- Institutional anti-sharing protection: a real-world broker account
-- (identified by a deterministic, NON-secret fingerprint) is permanently
-- bound to exactly ONE AlgoSphere user. The fingerprint is a one-way hash
-- of the broker-specific public identity tuple — for MT5 that's
-- (server, login); for crypto exchanges, the api_key; for OANDA/Tradovate,
-- the account_id. It is NEVER the password / api_secret.
--
-- Additive: existing broker_connections rows get a nullable fingerprint
-- column; they continue to work unchanged. New writes set the fingerprint
-- at connect-time and uniqueness is enforced on the ownership table.

-- ─── Ownership registry (one canonical row per real-world account) ─────
CREATE TABLE IF NOT EXISTS broker_account_ownership (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- sha256(broker || ':' || normalized_identity), hex. Globally unique.
  fingerprint              text NOT NULL UNIQUE,
  broker                   text NOT NULL,
  owner_user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Points at the current broker_connections row, if any. SET NULL on
  -- delete so the ownership survives row recreation (cooldown enforcement).
  current_connection_id    uuid REFERENCES broker_connections(id) ON DELETE SET NULL,

  linked_at                timestamptz NOT NULL DEFAULT now(),
  last_seen_at             timestamptz,
  last_seen_ip             inet,

  ownership_status         text NOT NULL DEFAULT 'active'
                            CHECK (ownership_status IN ('active','cooldown','revoked')),
  -- Set when an unlink starts a cooldown; another user cannot claim until past this.
  unlink_cooldown_until    timestamptz,

  -- Risk surface (filled by a background scorer; never blocks execution).
  risk_score               smallint NOT NULL DEFAULT 0
                            CHECK (risk_score BETWEEN 0 AND 100),
  risk_flags               jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bao_owner
  ON broker_account_ownership(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_bao_status_cooldown
  ON broker_account_ownership(ownership_status, unlink_cooldown_until)
  WHERE ownership_status = 'cooldown';

CREATE INDEX IF NOT EXISTS idx_bao_risk_score
  ON broker_account_ownership(risk_score DESC)
  WHERE risk_score >= 50;

-- ─── Append-only history (audit + risk scoring input) ──────────────────
CREATE TABLE IF NOT EXISTS broker_ownership_history (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ownership_id             uuid REFERENCES broker_account_ownership(id) ON DELETE SET NULL,
  -- Denormalized so history survives even if the ownership row is deleted.
  fingerprint              text NOT NULL,
  broker                   text NOT NULL,
  previous_owner_user_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  new_owner_user_id        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action                   text NOT NULL CHECK (action IN (
                            'linked',
                            'reclaim_blocked',     -- different user attempted to link
                            'unlinked',
                            'transferred',         -- admin-initiated
                            'cooldown_started',
                            'cooldown_lifted',
                            'risk_flag_raised',
                            'suspicious_session'   -- simultaneous-session detection
                          )),
  reason                   text,
  actor_id                 uuid,                   -- user or admin who acted
  ip_address               inet,
  user_agent               text,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boh_ownership   ON broker_ownership_history(ownership_id);
CREATE INDEX IF NOT EXISTS idx_boh_fingerprint ON broker_ownership_history(fingerprint);
CREATE INDEX IF NOT EXISTS idx_boh_created     ON broker_ownership_history(created_at DESC);

-- ─── Denormalize fingerprint onto broker_connections (join-free reads) ─
ALTER TABLE broker_connections
  ADD COLUMN IF NOT EXISTS broker_account_fingerprint text;

CREATE INDEX IF NOT EXISTS idx_bc_fingerprint
  ON broker_connections(broker_account_fingerprint)
  WHERE broker_account_fingerprint IS NOT NULL;

-- ─── updated_at trigger on ownership ───────────────────────────────────
CREATE OR REPLACE FUNCTION _touch_broker_account_ownership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_bao ON broker_account_ownership;
CREATE TRIGGER trg_touch_bao
  BEFORE UPDATE ON broker_account_ownership
  FOR EACH ROW EXECUTE FUNCTION _touch_broker_account_ownership();

-- ─── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE broker_account_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_ownership_history  ENABLE ROW LEVEL SECURITY;

-- Owner can read their own ownership row. All writes go through the
-- service-role server (connect-time enforcement + admin actions). No
-- user-visible UPDATE/DELETE — preventing self-service ownership transfer.
DROP POLICY IF EXISTS "bao_read_own" ON broker_account_ownership;
CREATE POLICY "bao_read_own" ON broker_account_ownership
  FOR SELECT USING (auth.uid() = owner_user_id);

-- History is readable to either side of the action (so a user can see
-- their own past links/unlinks; the other party stays anonymous via RLS).
DROP POLICY IF EXISTS "boh_read_own" ON broker_ownership_history;
CREATE POLICY "boh_read_own" ON broker_ownership_history
  FOR SELECT USING (
    auth.uid() = new_owner_user_id OR auth.uid() = previous_owner_user_id
  );

COMMENT ON TABLE broker_account_ownership IS
  'Anti-sharing registry: one real-world broker account (by fingerprint) belongs to exactly one AlgoSphere user. UNIQUE(fingerprint) is the DB-level guarantee. Server-side connect-time gate provides the friendly UX message before the constraint would fire.';
COMMENT ON TABLE broker_ownership_history IS
  'Append-only audit trail for ownership transitions and risk events.';
COMMENT ON COLUMN broker_connections.broker_account_fingerprint IS
  'Denormalized non-secret fingerprint of the broker account. Joinable to broker_account_ownership.fingerprint. Nullable so pre-migration rows continue to work until they are re-tested.';
