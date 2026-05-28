-- 20240101000042_broker_contention.sql
--
-- Institutional "Resolve / Dismiss Contender" system for the broker-ownership
-- registry. Contention was previously DERIVED at read-time from
-- reclaim_blocked history — there was no way to clear a reviewed attempt
-- from active contention without losing the audit trail.
--
-- This adds an explicit, filterable per-contender STATE table
-- (broker_contention) that lives alongside the immutable
-- broker_ownership_history (audit). Resolving/dismissing flips the state
-- row's status; the reclaim_blocked history rows + IPs + timestamps are
-- never touched. No hard deletes anywhere.
--
-- Status model across the two tables:
--   broker_account_ownership.ownership_status : active (= active_owner) | cooldown | revoked
--   broker_contention.status                  : active_contention | resolved_contention | dismissed_contention

CREATE TABLE IF NOT EXISTS broker_contention (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint        text NOT NULL,            -- denormalized (no FK: survives ownership delete)
  contender_user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'active_contention'
                       CHECK (status IN ('active_contention','resolved_contention','dismissed_contention')),
  attempt_count      int  NOT NULL DEFAULT 1,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_attempt_at    timestamptz NOT NULL DEFAULT now(),
  last_ip            inet,
  last_user_agent    text,
  resolved_at        timestamptz,
  resolved_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resolution_note    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fingerprint, contender_user_id)
);

CREATE INDEX IF NOT EXISTS idx_bcont_fp     ON broker_contention(fingerprint);
CREATE INDEX IF NOT EXISTS idx_bcont_active ON broker_contention(fingerprint)
  WHERE status = 'active_contention';

-- updated_at trigger
CREATE OR REPLACE FUNCTION _touch_broker_contention()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_touch_bcont ON broker_contention;
CREATE TRIGGER trg_touch_bcont
  BEFORE UPDATE ON broker_contention
  FOR EACH ROW EXECUTE FUNCTION _touch_broker_contention();

-- RLS: a contender can read their own contention rows; all writes go
-- through the service role (connect-time gate + admin resolve actions).
ALTER TABLE broker_contention ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bcont_read_own" ON broker_contention;
CREATE POLICY "bcont_read_own" ON broker_contention
  FOR SELECT USING (auth.uid() = contender_user_id);

-- Extend the history action vocabulary with the resolve/dismiss audit events.
ALTER TABLE broker_ownership_history DROP CONSTRAINT IF EXISTS broker_ownership_history_action_check;
ALTER TABLE broker_ownership_history ADD CONSTRAINT broker_ownership_history_action_check
  CHECK (action IN (
    'linked', 'reclaim_blocked', 'unlinked', 'transferred',
    'cooldown_started', 'cooldown_lifted', 'risk_flag_raised', 'suspicious_session',
    'contender_dismissed', 'contender_resolved'
  ));

-- Backfill: project existing reclaim_blocked history into active contention
-- rows (one per fingerprint × contender, excluding the legitimate owner).
-- Aggregates attempt_count + first/last timestamps + latest IP/UA.
INSERT INTO broker_contention (
  fingerprint, contender_user_id, status, attempt_count,
  first_seen_at, last_attempt_at, last_ip, last_user_agent
)
SELECT
  h.fingerprint,
  h.new_owner_user_id,
  'active_contention',
  count(*)::int,
  min(h.created_at),
  max(h.created_at),
  (array_agg(h.ip_address ORDER BY h.created_at DESC))[1],
  (array_agg(h.user_agent ORDER BY h.created_at DESC))[1]
FROM broker_ownership_history h
JOIN broker_account_ownership o ON o.fingerprint = h.fingerprint
WHERE h.action = 'reclaim_blocked'
  AND h.new_owner_user_id IS NOT NULL
  AND h.new_owner_user_id <> o.owner_user_id
GROUP BY h.fingerprint, h.new_owner_user_id
ON CONFLICT (fingerprint, contender_user_id) DO NOTHING;

COMMENT ON TABLE broker_contention IS
  'Current per-contender state for the broker-ownership registry. Active vs resolved/dismissed drives banners + risk noise; the reclaim_blocked audit trail in broker_ownership_history is never mutated by resolution.';
