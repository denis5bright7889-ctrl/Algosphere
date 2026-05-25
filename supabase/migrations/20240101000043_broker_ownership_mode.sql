-- 20240101000043_broker_ownership_mode.sql
--
-- Explicit ownership-policy layer on the broker registry.
--
-- The brief's conceptual "broker_accounts" table IS the deployed
-- broker_account_ownership (one row per real-world account, keyed by
-- fingerprint). Its `current_owner_user_id` already exists as
-- `owner_user_id`, and `revoked` already exists as an ownership_status.
-- So this migration only adds the two genuinely-missing policy fields —
-- additive, with defaults that preserve current behaviour (every existing
-- account becomes single_owner / not-shared automatically).
--
-- Policy axis (ownership_mode) is distinct from lifecycle (ownership_status):
--   ownership_mode   : single_owner (default) | shared | revoked   ← policy
--   ownership_status : active | cooldown | revoked                 ← lifecycle
-- The connect gate reads ownership_mode; revoke keeps the two in sync.

ALTER TABLE broker_account_ownership
  ADD COLUMN IF NOT EXISTS ownership_mode text NOT NULL DEFAULT 'single_owner'
    CHECK (ownership_mode IN ('single_owner','shared','revoked')),
  ADD COLUMN IF NOT EXISTS shared_enabled boolean NOT NULL DEFAULT false;

-- Keep mode consistent for any rows already revoked (none today, but correct).
UPDATE broker_account_ownership
  SET ownership_mode = 'revoked'
  WHERE ownership_status = 'revoked' AND ownership_mode <> 'revoked';

COMMENT ON COLUMN broker_account_ownership.ownership_mode IS
  'Ownership policy: single_owner (default, strict 1-owner) | shared (multi-user, opt-in) | revoked (owner cleared, reassign via admin only).';
COMMENT ON COLUMN broker_account_ownership.shared_enabled IS
  'Explicit admin opt-in for shared mode. The connect gate only allows a different user when this is true.';
COMMENT ON COLUMN broker_account_ownership.owner_user_id IS
  'Current owner (the brief''s current_owner_user_id). NULL only transiently between revoke and reassignment.';
