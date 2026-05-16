-- ============================================================
-- AlgoSphere Quant — Live-execution readiness gate
-- Migration: 20240101000022_execution_readiness.sql
--
-- A broker connection may not be flipped testnet → live until its
-- shadow-execution history proves parity with the leader:
--   • >= 50 settled shadow executions
--   • >= 95% fill rate (mirrored|testnet ÷ all attempts)
--   • mean |slippage|  < 0.10%
--   • mean |pnl_drift| <  2.00%
--
-- SECURITY DEFINER so the web app can call it with the user's JWT —
-- the function itself scopes every read to the passed user_id and is
-- only granted to authenticated + service_role.
-- ============================================================

CREATE OR REPLACE FUNCTION public.broker_execution_readiness(
  p_user_id UUID,
  p_broker  TEXT
)
RETURNS TABLE (
  attempts          BIGINT,
  filled            BIGINT,
  fill_rate_pct     NUMERIC,
  avg_abs_slip_pct  NUMERIC,
  closed_count      BIGINT,
  avg_abs_drift_pct NUMERIC,
  passes            BOOLEAN,
  reasons           TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts   BIGINT;
  v_filled     BIGINT;
  v_fill_rate  NUMERIC;
  v_slip       NUMERIC;
  v_closed     BIGINT;
  v_drift      NUMERIC;
  v_reasons    TEXT[] := ARRAY[]::TEXT[];
  v_pass       BOOLEAN := TRUE;
BEGIN
  -- Attempts = any shadow row the relay actually tried to mirror.
  SELECT
    COUNT(*) FILTER (WHERE actual_status IN ('mirrored','testnet','failed')),
    COUNT(*) FILTER (WHERE actual_status IN ('mirrored','testnet'))
  INTO v_attempts, v_filled
  FROM public.shadow_executions
  WHERE user_id = p_user_id AND broker = p_broker;

  v_fill_rate := CASE WHEN v_attempts > 0
                      THEN ROUND(100.0 * v_filled / v_attempts, 2)
                      ELSE 0 END;

  SELECT ROUND(AVG(ABS(slippage_pct)) * 100, 4)
  INTO v_slip
  FROM public.shadow_executions
  WHERE user_id = p_user_id AND broker = p_broker
    AND actual_status IN ('mirrored','testnet')
    AND slippage_pct IS NOT NULL;

  SELECT COUNT(*), ROUND(AVG(ABS(pnl_drift_pct)), 4)
  INTO v_closed, v_drift
  FROM public.shadow_executions
  WHERE user_id = p_user_id AND broker = p_broker
    AND closed_at IS NOT NULL
    AND pnl_drift_pct IS NOT NULL;

  -- Gate checks
  IF v_attempts < 50 THEN
    v_pass := FALSE;
    v_reasons := array_append(v_reasons,
      format('need 50+ executions (have %s)', v_attempts));
  END IF;

  IF v_fill_rate < 95 THEN
    v_pass := FALSE;
    v_reasons := array_append(v_reasons,
      format('fill rate %s%% < 95%%', v_fill_rate));
  END IF;

  IF COALESCE(v_slip, 0) >= 0.10 THEN
    v_pass := FALSE;
    v_reasons := array_append(v_reasons,
      format('avg slippage %s%% >= 0.10%%', v_slip));
  END IF;

  IF v_closed < 20 THEN
    v_pass := FALSE;
    v_reasons := array_append(v_reasons,
      format('need 20+ *closed* executions for drift (have %s)', v_closed));
  ELSIF COALESCE(v_drift, 0) >= 2.00 THEN
    v_pass := FALSE;
    v_reasons := array_append(v_reasons,
      format('avg PnL drift %s%% >= 2.00%%', v_drift));
  END IF;

  RETURN QUERY SELECT
    v_attempts, v_filled, v_fill_rate,
    COALESCE(v_slip, 0), v_closed, COALESCE(v_drift, 0),
    v_pass, v_reasons;
END;
$$;

REVOKE ALL ON FUNCTION public.broker_execution_readiness(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.broker_execution_readiness(UUID, TEXT)
  TO authenticated, service_role;
