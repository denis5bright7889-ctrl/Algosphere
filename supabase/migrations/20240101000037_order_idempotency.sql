-- ============================================================
-- AlgoSphere — Order idempotency / duplicate-fill detection (Phase 2 #3-4)
-- Migration: 20240101000037_order_idempotency.sql
--
-- Engine-side guard against double-fills. The copy-executor already sends a
-- STABLE client_order_id (copy_<job_id> / close_<copy_trade_id>) and reuses
-- it across retries, so a retry after a successful-but-lost-response fill
-- would otherwise re-submit. This cache lets /execute recognise a coid it
-- has already completed and return the cached result instead of firing a
-- second order — complementing (not replacing) broker-side client-order-id
-- dedup, which not every broker honours.
--
--   order_idempotency — one row per (broker, client_order_id):
--     in_flight → being executed now; completed → cached result; failed →
--     re-claimable.
--   begin_order()  — atomic claim. Returns owner / cached / in_flight. A
--     stale in_flight (older than the lease) is RECLAIMED, so a crashed
--     request can never permanently deadlock a coid.
--   finish_order() — records the terminal result (or releases on abort).
--
-- SAFETY: the engine calls these FAIL-OPEN — any error → proceed without
-- dedup (degrades to today's behaviour). The idempotency layer can never
-- block execution. Strictly additive; service_role-only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.order_idempotency (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT,                       -- 'env' for env-mode singletons
  broker          TEXT NOT NULL,
  client_order_id TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'in_flight'
                    CHECK (state IN ('in_flight', 'completed', 'failed')),
  order_id        TEXT,
  status          TEXT,
  filled_qty      NUMERIC,
  avg_fill_price  NUMERIC,
  slippage_pct    NUMERIC,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (broker, client_order_id)
);

CREATE INDEX IF NOT EXISTS idx_order_idem_inflight
  ON public.order_idempotency (updated_at) WHERE state = 'in_flight';

ALTER TABLE public.order_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_idem_system" ON public.order_idempotency
  FOR ALL USING (auth.role() = 'service_role');

-- begin_order — atomic claim with stale-in_flight reclaim ---------------
-- Returns jsonb: {owner:bool, duplicate:bool, in_flight:bool, cached:{...}}.
--   owner=true        → caller submits, then calls finish_order.
--   duplicate=true    → coid already completed; cached holds the result.
--   in_flight=true    → another request is actively executing this coid;
--                       caller must NOT double-submit.
CREATE OR REPLACE FUNCTION public.begin_order(
  p_user TEXT, p_broker TEXT, p_coid TEXT, p_lease_seconds INTEGER DEFAULT 30
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.order_idempotency%ROWTYPE;
BEGIN
  -- Fast path: claim a brand-new coid.
  INSERT INTO public.order_idempotency (user_id, broker, client_order_id, state)
  VALUES (p_user, p_broker, p_coid, 'in_flight')
  ON CONFLICT (broker, client_order_id) DO NOTHING
  RETURNING * INTO r;
  IF FOUND THEN
    RETURN jsonb_build_object('owner', TRUE);
  END IF;

  -- Existing row — inspect under a lock.
  SELECT * INTO r FROM public.order_idempotency
    WHERE broker = p_broker AND client_order_id = p_coid FOR UPDATE;

  IF r.state = 'completed' THEN
    RETURN jsonb_build_object('owner', FALSE, 'duplicate', TRUE, 'cached',
      jsonb_build_object('order_id', r.order_id, 'status', r.status,
        'filled_qty', r.filled_qty, 'avg_fill_price', r.avg_fill_price,
        'slippage_pct', r.slippage_pct));
  ELSIF r.state = 'failed'
        OR r.updated_at < NOW() - make_interval(secs => p_lease_seconds) THEN
    -- Previously failed, or a stale in_flight from a crashed request →
    -- re-claim ownership so the order can proceed (no permanent deadlock).
    UPDATE public.order_idempotency
      SET state = 'in_flight', updated_at = NOW(), error = NULL
      WHERE id = r.id;
    RETURN jsonb_build_object('owner', TRUE);
  ELSE
    -- Fresh in_flight elsewhere → genuine concurrent duplicate.
    RETURN jsonb_build_object('owner', FALSE, 'in_flight', TRUE);
  END IF;
END;
$$;

-- finish_order — record terminal result (or release on abort) -----------
CREATE OR REPLACE FUNCTION public.finish_order(
  p_broker TEXT, p_coid TEXT, p_state TEXT,
  p_order_id TEXT DEFAULT NULL, p_status TEXT DEFAULT NULL,
  p_filled NUMERIC DEFAULT NULL, p_price NUMERIC DEFAULT NULL,
  p_slip NUMERIC DEFAULT NULL, p_error TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.order_idempotency SET
    state = CASE WHEN p_state IN ('completed','failed') THEN p_state ELSE 'failed' END,
    order_id = COALESCE(p_order_id, order_id),
    status = COALESCE(p_status, status),
    filled_qty = COALESCE(p_filled, filled_qty),
    avg_fill_price = COALESCE(p_price, avg_fill_price),
    slippage_pct = COALESCE(p_slip, slippage_pct),
    error = p_error,
    updated_at = NOW()
  WHERE broker = p_broker AND client_order_id = p_coid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.begin_order(TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_order(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT) TO service_role;

-- ============================================================
-- Engine /execute (fail-open): if client_order_id is present, begin_order()
-- before submit. duplicate → return cached fill (no second order);
-- in_flight → return duplicate_in_flight (caller retries later); owner →
-- submit then finish_order(completed|failed). Any RPC error → proceed
-- without dedup. A stale in_flight self-heals after the lease.
-- ============================================================
