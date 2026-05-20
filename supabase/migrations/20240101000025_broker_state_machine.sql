-- ============================================================
-- Broker connection state machine
-- Migration: 20240101000025_broker_state_machine.sql
--
-- Extend the broker_connections.status enum + add the columns the
-- engine writes during state-machine transitions:
--
--   status += 'disabled' | 'failed' | 'testing'
--   pending_cycles      → counts consecutive PENDING probe cycles;
--                          probe flips to FAILED after MAX_PENDING_CYCLES
--   state_changed_at    → timestamp of the most recent state transition
--
-- We also map the legacy 'error' status to the new 'failed' so the UI
-- only ever has to handle the canonical set going forward.
-- ============================================================

-- 1. Drop the old CHECK before adding the new states. The constraint
--    name is the postgres default — `broker_connections_status_check`.
ALTER TABLE public.broker_connections
  DROP CONSTRAINT IF EXISTS broker_connections_status_check;

-- 2. Migrate legacy values so the new CHECK can be applied without
--    rejecting existing rows.
UPDATE public.broker_connections
   SET status = 'failed'
 WHERE status IN ('error', 'disconnected');

-- 3. Apply the new CHECK with the full state set.
ALTER TABLE public.broker_connections
  ADD CONSTRAINT broker_connections_status_check
    CHECK (status IN (
      'pending',
      'testing',
      'connected',
      'failed',
      'disabled',
      'revoked'
    ));

-- 4. Counter for the "stuck pending" cap.
ALTER TABLE public.broker_connections
  ADD COLUMN IF NOT EXISTS pending_cycles INTEGER NOT NULL DEFAULT 0;

-- 5. Transition timestamp — separate from last_synced_at, which is
--    bumped every probe regardless of state change.
ALTER TABLE public.broker_connections
  ADD COLUMN IF NOT EXISTS state_changed_at TIMESTAMPTZ;

-- 6. Backfill state_changed_at for existing rows to keep ORDER BY queries
--    deterministic.
UPDATE public.broker_connections
   SET state_changed_at = COALESCE(state_changed_at, last_synced_at, updated_at, created_at)
 WHERE state_changed_at IS NULL;
