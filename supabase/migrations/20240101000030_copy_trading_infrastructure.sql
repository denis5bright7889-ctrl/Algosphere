-- ============================================================
-- AlgoSphere — Copy-Trading Infrastructure (event-driven core)
-- Migration: 20240101000030_copy_trading_infrastructure.sql
--
-- Lays the load-bearing schema for the production copy-trading
-- platform described in docs/COPY_TRADING_INFRASTRUCTURE.md:
--
--   signal_events       — the BUS. Strategies append here, never execute.
--   copy_jobs           — the durable async QUEUE (SKIP LOCKED claim).
--   copy_reconciliation — the desync ledger (missed/partial/desync).
--   strategy_subscriptions.allocation_model (+ params) — pluggable
--                         equity_ratio | fixed_ratio | risk_pct sizing.
--
-- Design invariants (enforced structurally here):
--   • Strategies/web never execute inline — they INSERT a signal_events
--     row (single row, <5ms) and return. Workers do all broker I/O.
--   • Idempotent fan-out: UNIQUE(signal_event_id, subscription_id) on
--     copy_jobs means re-planning a signal can never double-order.
--   • Risk-before-execution: the executor refuses any job without
--     risk_passed_at — see the copy_gate in the executor worker.
--   • Additive + IF NOT EXISTS throughout. Touches no trading-critical
--     table destructively. RLS on every new table.
--
-- NOTE: existing schema already provides published_strategies,
-- strategy_subscriptions (allocation_pct, risk_multiplier, max_lot_size,
-- hwm_basis), copy_trades, creator_earnings, shadow_executions, and
-- execution_events (+ the journal auto-detection trigger, migration 029).
-- This migration only adds the bus/queue/reconciliation layer on top.
-- ============================================================

-- 1. signal_events — the BUS ------------------------------------------
-- Append-only. Every leader signal lands here exactly once; the
-- orchestrator fans it out into copy_jobs. status tracks fan-out, NOT
-- execution (execution state lives per-follower on copy_jobs).

CREATE TABLE IF NOT EXISTS public.signal_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_id   UUID REFERENCES public.published_strategies(id) ON DELETE SET NULL,
  signal_id     UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN ('OPEN','CLOSE','MODIFY','CANCEL')),
  symbol        TEXT NOT NULL,
  direction     TEXT CHECK (direction IN ('buy','sell')),
  payload       JSONB NOT NULL DEFAULT '{}',     -- entry/sl/tp/lot/rr/regime, etc.
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','planning','fanned_out','failed')),
  jobs_created  INTEGER NOT NULL DEFAULT 0,
  fanout_error  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fanned_out_at TIMESTAMPTZ
);

-- Hot index: orchestrator pulls unplanned events oldest-first.
CREATE INDEX IF NOT EXISTS idx_signal_events_pending
  ON public.signal_events (created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_signal_events_leader
  ON public.signal_events (leader_id, created_at DESC);

ALTER TABLE public.signal_events ENABLE ROW LEVEL SECURITY;
-- Leaders see their own emitted events; workers (service_role) do everything.
CREATE POLICY "signal_events_leader_read"
  ON public.signal_events FOR SELECT USING (leader_id = auth.uid());
CREATE POLICY "signal_events_system_write"
  ON public.signal_events FOR ALL USING (auth.role() = 'service_role');

-- 2. copy_jobs — the durable async QUEUE ------------------------------
-- One row per (signal_event, follower-subscription). The queue's system
-- of record: survives worker crashes, gives the reconciler ground truth,
-- and supports lease-based re-claim. Redis Streams sit in front of this
-- for low-latency dispatch; this table is the durable fallback.

CREATE TABLE IF NOT EXISTS public.copy_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_event_id  UUID NOT NULL REFERENCES public.signal_events(id) ON DELETE CASCADE,
  subscription_id  UUID NOT NULL REFERENCES public.strategy_subscriptions(id) ON DELETE CASCADE,
  follower_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  leader_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  broker           TEXT,
  -- Queue state machine.
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                     'queued','claimed','risk_check','allocating','routing',
                     'submitted','filled','partial','rejected','failed','skipped'
                   )),
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  claimed_by       TEXT,            -- worker id, for SKIP LOCKED lease tracking
  claimed_at       TIMESTAMPTZ,
  -- Risk + allocation audit trail.
  risk_passed_at   TIMESTAMPTZ,     -- router REFUSES jobs without this
  risk_reason      TEXT,
  allocation_model TEXT,
  computed_lot     NUMERIC(20,8),
  -- Execution linkage.
  copy_trade_id    UUID REFERENCES public.copy_trades(id) ON DELETE SET NULL,
  client_order_id  TEXT,            -- 'copy_' || id — broker-side idempotency
  last_error       TEXT,
  available_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- backoff scheduling
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- IDEMPOTENCY: one job per (signal_event, subscription). Re-fanout no-ops.
  UNIQUE (signal_event_id, subscription_id)
);

-- The claim hot-path: workers grab the oldest available queued jobs.
CREATE INDEX IF NOT EXISTS idx_copy_jobs_claimable
  ON public.copy_jobs (available_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_copy_jobs_follower
  ON public.copy_jobs (follower_id, created_at DESC);
-- Stuck-claim recovery scan (lease expiry).
CREATE INDEX IF NOT EXISTS idx_copy_jobs_claimed
  ON public.copy_jobs (claimed_at)
  WHERE status = 'claimed';

ALTER TABLE public.copy_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "copy_jobs_users_read"
  ON public.copy_jobs FOR SELECT
  USING (follower_id = auth.uid() OR leader_id = auth.uid());
CREATE POLICY "copy_jobs_system_write"
  ON public.copy_jobs FOR ALL USING (auth.role() = 'service_role');

-- 3. copy_reconciliation — the desync ledger --------------------------
-- The Sync + PnL Tracker writes one row per detected discrepancy between
-- what we intended (copy_jobs/copy_trades) and broker truth (positions).

CREATE TABLE IF NOT EXISTS public.copy_reconciliation (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  copy_job_id   UUID REFERENCES public.copy_jobs(id) ON DELETE SET NULL,
  copy_trade_id UUID REFERENCES public.copy_trades(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'missed_trade','partial_fill','desync_qty','desync_missing',
                  'orphan_position','price_drift')),
  severity      TEXT NOT NULL DEFAULT 'warn'
                  CHECK (severity IN ('info','warn','critical')),
  expected      JSONB,            -- {symbol, side, lot, entry, sl, tp}
  observed      JSONB,            -- broker truth at detection time
  resolution    TEXT CHECK (resolution IN
                  ('auto_corrected','manual_required','accepted','expired')),
  resolved_at   TIMESTAMPTZ,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recon_open
  ON public.copy_reconciliation (follower_id, detected_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.copy_reconciliation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recon_users_read"
  ON public.copy_reconciliation FOR SELECT USING (follower_id = auth.uid());
CREATE POLICY "recon_system_write"
  ON public.copy_reconciliation FOR ALL USING (auth.role() = 'service_role');

-- 4. Allocation model on strategy_subscriptions -----------------------
-- The follower picks how their lot is sized relative to the leader.
-- allocation_pct / risk_multiplier / max_lot_size / hwm_basis already
-- exist (migration 012); we add the model selector + its two new params.

ALTER TABLE public.strategy_subscriptions
  ADD COLUMN IF NOT EXISTS allocation_model TEXT NOT NULL DEFAULT 'risk_pct'
    CHECK (allocation_model IN ('equity_ratio','fixed_ratio','risk_pct')),
  ADD COLUMN IF NOT EXISTS fixed_scale NUMERIC(10,4) DEFAULT 1.0,   -- fixed_ratio
  ADD COLUMN IF NOT EXISTS risk_pct    NUMERIC(5,2)  DEFAULT 1.0;   -- risk_pct

-- 5. NOTIFY triggers — wake workers instantly (no busy-polling) -------
-- The orchestrator LISTENs on 'signal_events_channel'; executors LISTEN
-- on 'copy_jobs_channel'. Both also poll as a durable fallback so a
-- missed NOTIFY (e.g. worker reconnect) never strands work.

CREATE OR REPLACE FUNCTION public.notify_signal_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM pg_notify('signal_events_channel', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_signal_event ON public.signal_events;
CREATE TRIGGER trg_notify_signal_event
  AFTER INSERT ON public.signal_events
  FOR EACH ROW EXECUTE FUNCTION public.notify_signal_event();

CREATE OR REPLACE FUNCTION public.notify_copy_job()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'queued' THEN
    PERFORM pg_notify('copy_jobs_channel', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_copy_job ON public.copy_jobs;
CREATE TRIGGER trg_notify_copy_job
  AFTER INSERT ON public.copy_jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_copy_job();

-- 6. keep updated_at honest on copy_jobs ------------------------------
CREATE OR REPLACE FUNCTION public.touch_copy_jobs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_copy_jobs ON public.copy_jobs;
CREATE TRIGGER trg_touch_copy_jobs
  BEFORE UPDATE ON public.copy_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_copy_jobs_updated_at();

-- ============================================================
-- After this migration the control plane is ready. Build order
-- (see docs/COPY_TRADING_INFRASTRUCTURE.md §9):
--   1. copy-orchestrator worker  — signal_events → copy_jobs fan-out
--   2. copy-executor pool        — claim → risk_gate → allocation → route
--   3. reconciler worker         — position diff → copy_reconciliation
-- The web app's inline relayLeaderSignal() fan-out is retired in favour
-- of a single INSERT into signal_events.
-- ============================================================
