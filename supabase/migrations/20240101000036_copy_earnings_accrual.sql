-- ============================================================
-- AlgoSphere — Creator-earnings accrual for engine-driven closes
-- Migration: 20240101000036_copy_earnings_accrual.sql
--
-- Wires the settlement seam left open by migration 035. When the executor
-- flattens a leader-CLOSE'd copy it sets copy_trades.follower_pnl + status
-- ='closed' but does NOT accrue creator earnings (that math lived only in
-- the TS settlement, keyed by signal). This RPC closes that gap WITHOUT
-- duplicating the PnL math: it splits the ALREADY-COMPUTED follower_pnl, so
-- there is one and only one place the realized P&L is calculated (whoever
-- closed the trade) and one split rule here.
--
--   copy_trades.earnings_settled — idempotency flag. The RPC marks it under
--     a row lock before doing anything, so concurrent or repeated calls
--     accrue exactly once.
--   accrue_copy_earnings(copy_trade_id) — profit-share split (creator% from
--     published_strategies + platform 5%, matching lib/copy-settlement.ts),
--     inserts creator_earnings + a follower notification. Returns creator_usd.
--
-- No double-accrual with the TS path: TS settles only copy_trades in
-- (pending|mirrored|partial); a closed trade is invisible to it, and this
-- RPC runs only after close. The two close triggers (signal TP/SL → TS;
-- leader CLOSE → this) never touch the same trade.
--
-- Strictly additive. RLS unchanged (creator_earnings/social_notifications
-- already service_role-write).
-- ============================================================

ALTER TABLE public.copy_trades
  ADD COLUMN IF NOT EXISTS earnings_settled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.accrue_copy_earnings(p_copy_trade_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ct            public.copy_trades%ROWTYPE;
  v_strategy_id UUID;
  v_creator     UUID;
  v_share       NUMERIC;
  v_leader_usd  NUMERIC;
  v_platform_usd NUMERIC;
  v_platform_pct NUMERIC := 5;     -- matches PLATFORM_SHARE_PCT in copy-settlement.ts
BEGIN
  SELECT * INTO ct FROM public.copy_trades WHERE id = p_copy_trade_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  -- Idempotent: mark settled under the row lock before any insert, so a
  -- repeat/concurrent call (which blocks on FOR UPDATE) sees it and no-ops.
  IF ct.earnings_settled THEN
    RETURN 0;
  END IF;
  UPDATE public.copy_trades SET earnings_settled = TRUE WHERE id = p_copy_trade_id;

  -- Only profitable copies accrue a creator share (same rule as TS).
  IF COALESCE(ct.follower_pnl, 0) <= 0 THEN
    RETURN 0;
  END IF;

  SELECT ss.strategy_id INTO v_strategy_id
    FROM public.strategy_subscriptions ss WHERE ss.id = ct.subscription_id;
  IF v_strategy_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT profit_share_pct, creator_id INTO v_share, v_creator
    FROM public.published_strategies WHERE id = v_strategy_id;
  IF v_creator IS NULL THEN
    RETURN 0;
  END IF;
  v_share        := COALESCE(v_share, 20);
  v_leader_usd   := ct.follower_pnl * v_share / 100;
  v_platform_usd := ct.follower_pnl * v_platform_pct / 100;

  INSERT INTO public.creator_earnings (
    creator_id, strategy_id, subscriber_id, earning_type, gross_usd,
    platform_fee_pct, platform_fee_usd, creator_pct, creator_usd, status
  ) VALUES (
    v_creator, v_strategy_id, ct.follower_id, 'profit_share', ct.follower_pnl,
    v_platform_pct, v_platform_usd, v_share, v_leader_usd, 'accrued'
  );

  INSERT INTO public.social_notifications (
    recipient_id, actor_id, notif_type, entity_type, entity_id, message
  ) VALUES (
    ct.follower_id, ct.leader_id, 'copy_trade_closed', 'signal', ct.signal_id,
    format('Copy trade closed: %s %s$%s', ct.symbol,
           CASE WHEN ct.follower_pnl >= 0 THEN '+' ELSE '' END,
           round(ct.follower_pnl, 2))
  );

  RETURN v_leader_usd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accrue_copy_earnings(UUID) TO service_role;

-- ============================================================
-- The executor close pipeline calls accrue_copy_earnings(copy_trade_id)
-- right after marking a copy_trade closed. Future: the TS settlement could
-- also delegate its accrual to this RPC to fully single-source the split,
-- but it is not required (no overlap today).
-- ============================================================
