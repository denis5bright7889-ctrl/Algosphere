-- ============================================================
-- AlgoSphere — Copy CLOSE jobs (leader-initiated flatten)
-- Migration: 20240101000035_copy_close_jobs.sql
--
-- Closes the loop: a leader CLOSE signal_event now fans out reduce-only
-- CLOSE jobs through the SAME durable queue, so follower positions
-- actually flatten (today a CLOSE was marked 'fanned_out' with 0 jobs and
-- nothing happened).
--
--   copy_jobs.kind ('open' | 'close') — the executor branches on it. An
--     'open' job opens a new copy (existing path); a 'close' job flattens
--     the follower's open copies for the event's symbol with reduce-only
--     orders and marks the copy_trades closed.
--
-- One close job per (signal_event, subscription) — respects the existing
-- UNIQUE(signal_event_id, subscription_id) so re-fan-out is still
-- idempotent; the executor flattens ALL of that follower's open copies on
-- the symbol within the one job (normally one).
--
-- Strictly additive: a column with a safe default + two partial indexes.
-- ============================================================

ALTER TABLE public.copy_jobs
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'open'
    CHECK (kind IN ('open', 'close'));

-- Orchestrator: find which subscriptions have an open copy on (leader, symbol).
CREATE INDEX IF NOT EXISTS idx_copy_trades_leader_symbol_open
  ON public.copy_trades (leader_id, symbol)
  WHERE status IN ('mirrored', 'partial');

-- Executor: flatten lookup by (follower, symbol).
CREATE INDEX IF NOT EXISTS idx_copy_trades_follower_symbol_open
  ON public.copy_trades (follower_id, symbol)
  WHERE status IN ('mirrored', 'partial');

-- ============================================================
-- Settlement seam (documented, NOT wired here): marking a copy_trade
-- 'closed' with follower_pnl is done by the executor's close pipeline.
-- Creator-earnings accrual remains single-sourced in the TS settlement
-- (lib/copy-settlement.ts, keyed by signal). Wiring engine-driven closes
-- to earnings accrual (a shared settle RPC or a web settlement endpoint)
-- is the next slice — deliberately deferred to avoid divergent money math.
-- ============================================================
