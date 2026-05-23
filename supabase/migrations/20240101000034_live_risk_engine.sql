-- ============================================================
-- AlgoSphere — Centralized Live Risk Engine (Phase 3)
-- Migration: 20240101000034_live_risk_engine.sql
--
-- A portfolio-level risk layer ON TOP of the engine's existing per-account
-- 12-gate (which stays the inner, non-bypassable guard). This adds the
-- cross-account / portfolio controls an institutional desk needs:
--
--   global_risk_state   — the GLOBAL KILL SWITCH (singleton). One flag that
--                         halts ALL execution everywhere.
--   risk_limits         — per-user caps: total exposure, symbol
--                         concentration, daily loss, drawdown, open positions.
--   portfolio_exposure  — per-user rolling snapshot the limits are checked
--                         against (recomputed by the reconciler).
--   strategy_risk_state — per-strategy quarantine / auto-disable + loss-streak
--                         tracking, so a misbehaving strategy stops fanning out.
--
-- RPCs (SECURITY DEFINER, service_role): set_global_kill_switch,
-- is_kill_switch_active, recompute_portfolio_exposure, evaluate_portfolio_risk,
-- quarantine_strategy.
--
-- Notes on honesty: drawdown + loss limits are measured on REALIZED PnL from
-- copy_trades (no per-follower equity time-series exists yet), so drawdown is
-- a USD figure off the realized-PnL peak, not an equity %. Correlation
-- exposure, volatility-aware sizing, and liquidity/spread checks need a market
-- feed and are deliberately NOT faked here — they are follow-ups.
--
-- Strictly additive. RLS on every table. portfolio_exposure is derived
-- (safe to TRUNCATE/recompute).
-- ============================================================

-- 1. Global kill switch (singleton) -----------------------------------
CREATE TABLE IF NOT EXISTS public.global_risk_state (
  id            BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),  -- single row
  kill_switch   BOOLEAN NOT NULL DEFAULT FALSE,
  reason        TEXT,
  activated_by  TEXT,
  activated_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.global_risk_state (id, kill_switch) VALUES (TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.global_risk_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "global_risk_read"   ON public.global_risk_state FOR SELECT USING (TRUE);
CREATE POLICY "global_risk_system" ON public.global_risk_state FOR ALL USING (auth.role() = 'service_role');

-- 2. Per-user risk limits ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.risk_limits (
  user_id                    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled                    BOOLEAN NOT NULL DEFAULT TRUE,
  max_total_exposure_usd     NUMERIC(20,2) DEFAULT 100000,
  max_symbol_concentration_pct NUMERIC(5,2) DEFAULT 60.0,   -- % of total notional in one symbol
  daily_loss_cap_usd         NUMERIC(20,2) DEFAULT 1000,    -- halt new entries past today's realized loss
  max_drawdown_usd           NUMERIC(20,2) DEFAULT 5000,    -- realized-PnL drawdown from peak
  max_open_positions         INTEGER DEFAULT 50,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.risk_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk_limits_owner"  ON public.risk_limits FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "risk_limits_system" ON public.risk_limits FOR ALL USING (auth.role() = 'service_role');

-- 3. Per-user portfolio exposure snapshot -----------------------------
CREATE TABLE IF NOT EXISTS public.portfolio_exposure (
  user_id                UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_notional         NUMERIC(20,2) NOT NULL DEFAULT 0,
  by_symbol              JSONB NOT NULL DEFAULT '{}',     -- {symbol: notional}
  by_direction           JSONB NOT NULL DEFAULT '{}',     -- {buy: n, sell: n}
  open_positions         INTEGER NOT NULL DEFAULT 0,
  largest_concentration_pct NUMERIC(5,2) DEFAULT 0,
  daily_realized_pnl     NUMERIC(20,2) NOT NULL DEFAULT 0,
  cumulative_realized_pnl NUMERIC(20,2) NOT NULL DEFAULT 0,
  peak_realized_pnl      NUMERIC(20,2) NOT NULL DEFAULT 0,
  drawdown_usd           NUMERIC(20,2) NOT NULL DEFAULT 0,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.portfolio_exposure ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exposure_owner"  ON public.portfolio_exposure FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "exposure_system" ON public.portfolio_exposure FOR ALL USING (auth.role() = 'service_role');

-- 4. Per-strategy risk state ------------------------------------------
CREATE TABLE IF NOT EXISTS public.strategy_risk_state (
  strategy_id        UUID PRIMARY KEY REFERENCES public.published_strategies(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','quarantined','disabled')),
  reason             TEXT,
  consecutive_losses INTEGER NOT NULL DEFAULT 0,
  auto_disabled_at   TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.strategy_risk_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "strategy_risk_read"   ON public.strategy_risk_state FOR SELECT USING (TRUE);
CREATE POLICY "strategy_risk_system" ON public.strategy_risk_state FOR ALL USING (auth.role() = 'service_role');

-- 5. Kill-switch RPCs --------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_global_kill_switch(
  p_active BOOLEAN, p_reason TEXT DEFAULT NULL, p_actor TEXT DEFAULT 'system'
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.global_risk_state SET
    kill_switch  = p_active,
    reason       = CASE WHEN p_active THEN p_reason ELSE NULL END,
    activated_by = CASE WHEN p_active THEN p_actor ELSE NULL END,
    activated_at = CASE WHEN p_active THEN NOW() ELSE NULL END,
    updated_at   = NOW()
  WHERE id = TRUE;
  RETURN p_active;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_kill_switch_active()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT kill_switch FROM public.global_risk_state WHERE id = TRUE), FALSE);
$$;

-- 6. Portfolio exposure recompute (per user or all) -------------------
-- Notional proxy = follower_lot × leader_entry over OPEN copies. Realized
-- PnL aggregated from CLOSED copies (today + cumulative). Peak tracked so
-- drawdown = peak − cumulative.
CREATE OR REPLACE FUNCTION public.recompute_portfolio_exposure(p_user_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH open_pos AS (
    SELECT follower_id,
           symbol,
           direction,
           COALESCE(follower_lot,0) * COALESCE(leader_entry,0) AS notional
      FROM public.copy_trades
     WHERE status IN ('mirrored','partial')
       AND (p_user_id IS NULL OR follower_id = p_user_id)
  ),
  per_user AS (
    SELECT follower_id,
           SUM(notional)                                   AS total_notional,
           COUNT(*)                                        AS open_positions,
           jsonb_object_agg(symbol, sym_notional)          AS by_symbol,
           MAX(sym_notional)                               AS top_symbol_notional
    FROM (
      SELECT follower_id, symbol, SUM(notional) AS sym_notional
        FROM open_pos GROUP BY follower_id, symbol
    ) s GROUP BY follower_id
  ),
  dir AS (
    SELECT follower_id,
           jsonb_build_object(
             'buy',  COALESCE(SUM(notional) FILTER (WHERE direction='buy'),0),
             'sell', COALESCE(SUM(notional) FILTER (WHERE direction='sell'),0)
           ) AS by_direction
      FROM open_pos GROUP BY follower_id
  ),
  pnl AS (
    SELECT follower_id,
           COALESCE(SUM(follower_pnl) FILTER (
             WHERE closed_at >= date_trunc('day', NOW())), 0)  AS daily_realized_pnl,
           COALESCE(SUM(follower_pnl), 0)                       AS cumulative_realized_pnl
      FROM public.copy_trades
     WHERE status = 'closed'
       AND (p_user_id IS NULL OR follower_id = p_user_id)
     GROUP BY follower_id
  ),
  merged AS (
    SELECT
      COALESCE(pu.follower_id, p.follower_id, d.follower_id)        AS user_id,
      COALESCE(pu.total_notional, 0)                               AS total_notional,
      COALESCE(pu.open_positions, 0)                               AS open_positions,
      COALESCE(pu.by_symbol, '{}'::jsonb)                          AS by_symbol,
      COALESCE(d.by_direction, '{}'::jsonb)                        AS by_direction,
      CASE WHEN COALESCE(pu.total_notional,0) > 0
           THEN ROUND(100 * pu.top_symbol_notional / pu.total_notional, 2)
           ELSE 0 END                                              AS largest_concentration_pct,
      COALESCE(p.daily_realized_pnl, 0)                            AS daily_realized_pnl,
      COALESCE(p.cumulative_realized_pnl, 0)                       AS cumulative_realized_pnl
    FROM per_user pu
    FULL JOIN dir d ON d.follower_id = pu.follower_id
    FULL JOIN pnl p ON p.follower_id = COALESCE(pu.follower_id, d.follower_id)
  )
  INSERT INTO public.portfolio_exposure AS pe (
    user_id, total_notional, by_symbol, by_direction, open_positions,
    largest_concentration_pct, daily_realized_pnl, cumulative_realized_pnl,
    peak_realized_pnl, drawdown_usd, updated_at
  )
  SELECT
    m.user_id, m.total_notional, m.by_symbol, m.by_direction, m.open_positions,
    m.largest_concentration_pct, m.daily_realized_pnl, m.cumulative_realized_pnl,
    GREATEST(m.cumulative_realized_pnl, 0)            AS peak_realized_pnl,
    GREATEST(0 - m.cumulative_realized_pnl, 0)        AS drawdown_usd,
    NOW()
  FROM merged m
  WHERE m.user_id IS NOT NULL
  ON CONFLICT (user_id) DO UPDATE SET
    total_notional            = EXCLUDED.total_notional,
    by_symbol                 = EXCLUDED.by_symbol,
    by_direction              = EXCLUDED.by_direction,
    open_positions            = EXCLUDED.open_positions,
    largest_concentration_pct = EXCLUDED.largest_concentration_pct,
    daily_realized_pnl        = EXCLUDED.daily_realized_pnl,
    cumulative_realized_pnl   = EXCLUDED.cumulative_realized_pnl,
    -- Peak ratchets up only; drawdown measured from it.
    peak_realized_pnl         = GREATEST(pe.peak_realized_pnl, EXCLUDED.cumulative_realized_pnl),
    drawdown_usd              = GREATEST(0, GREATEST(pe.peak_realized_pnl, EXCLUDED.cumulative_realized_pnl)
                                            - EXCLUDED.cumulative_realized_pnl),
    updated_at                = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 7. Pre-trade portfolio risk check -----------------------------------
-- Returns {allow, reason}. Checks the global kill switch first, then the
-- user's limits against the latest exposure snapshot + the candidate
-- notional. Fail-CLOSED on kill switch; otherwise default-allow when no
-- limits row exists (opt-in tightening).
CREATE OR REPLACE FUNCTION public.evaluate_portfolio_risk(
  p_user_id UUID, p_symbol TEXT, p_notional_usd NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lim  public.risk_limits%ROWTYPE;
  exp  public.portfolio_exposure%ROWTYPE;
  v_projected_total NUMERIC;
  v_symbol_notional NUMERIC;
  v_projected_symbol NUMERIC;
BEGIN
  IF public.is_kill_switch_active() THEN
    RETURN jsonb_build_object('allow', FALSE, 'reason', 'global_kill_switch');
  END IF;

  SELECT * INTO lim FROM public.risk_limits WHERE user_id = p_user_id;
  IF NOT FOUND OR NOT lim.enabled THEN
    RETURN jsonb_build_object('allow', TRUE, 'reason', 'no_limits');
  END IF;

  SELECT * INTO exp FROM public.portfolio_exposure WHERE user_id = p_user_id;
  -- No snapshot yet → treat exposure as zero (first trade of the window).
  v_projected_total  := COALESCE(exp.total_notional, 0) + GREATEST(p_notional_usd, 0);
  v_symbol_notional  := COALESCE((exp.by_symbol ->> p_symbol)::numeric, 0);
  v_projected_symbol := v_symbol_notional + GREATEST(p_notional_usd, 0);

  IF lim.max_total_exposure_usd IS NOT NULL
     AND v_projected_total > lim.max_total_exposure_usd THEN
    RETURN jsonb_build_object('allow', FALSE, 'reason',
      format('max_total_exposure: %.0f > %.0f', v_projected_total, lim.max_total_exposure_usd));
  END IF;

  IF lim.max_symbol_concentration_pct IS NOT NULL AND v_projected_total > 0
     AND (100 * v_projected_symbol / v_projected_total) > lim.max_symbol_concentration_pct THEN
    RETURN jsonb_build_object('allow', FALSE, 'reason',
      format('symbol_concentration %s: %.1f%% > %.1f%%', p_symbol,
             100 * v_projected_symbol / v_projected_total, lim.max_symbol_concentration_pct));
  END IF;

  IF lim.max_open_positions IS NOT NULL
     AND COALESCE(exp.open_positions, 0) >= lim.max_open_positions THEN
    RETURN jsonb_build_object('allow', FALSE, 'reason',
      format('max_open_positions: %s', lim.max_open_positions));
  END IF;

  IF lim.daily_loss_cap_usd IS NOT NULL
     AND COALESCE(exp.daily_realized_pnl, 0) <= (0 - lim.daily_loss_cap_usd) THEN
    RETURN jsonb_build_object('allow', FALSE, 'reason',
      format('daily_loss_cap: %.0f loss today', exp.daily_realized_pnl));
  END IF;

  IF lim.max_drawdown_usd IS NOT NULL
     AND COALESCE(exp.drawdown_usd, 0) >= lim.max_drawdown_usd THEN
    RETURN jsonb_build_object('allow', FALSE, 'reason',
      format('max_drawdown: %.0f >= %.0f', exp.drawdown_usd, lim.max_drawdown_usd));
  END IF;

  RETURN jsonb_build_object('allow', TRUE, 'reason', 'ok');
END;
$$;

-- 8. Strategy quarantine ----------------------------------------------
CREATE OR REPLACE FUNCTION public.quarantine_strategy(
  p_strategy_id UUID, p_reason TEXT, p_disable BOOLEAN DEFAULT FALSE
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT := CASE WHEN p_disable THEN 'disabled' ELSE 'quarantined' END;
BEGIN
  INSERT INTO public.strategy_risk_state (strategy_id, status, reason, auto_disabled_at, updated_at)
  VALUES (p_strategy_id, v_status, p_reason,
          CASE WHEN p_disable THEN NOW() END, NOW())
  ON CONFLICT (strategy_id) DO UPDATE SET
    status = v_status, reason = p_reason,
    auto_disabled_at = CASE WHEN p_disable THEN NOW() ELSE strategy_risk_state.auto_disabled_at END,
    updated_at = NOW();
  RETURN v_status;
END;
$$;

-- 9. Auto-disable unstable strategies ---------------------------------
-- Aggregates realized PnL per strategy over the window (via the
-- subscription→strategy link) and quarantines any whose loss breaches the
-- threshold and that aren't already non-active. Idempotent; returns the
-- number newly quarantined. The reconciler calls this on a cadence.
CREATE OR REPLACE FUNCTION public.auto_quarantine_breaching_strategies(
  p_window_hours INTEGER DEFAULT 24, p_loss_threshold NUMERIC DEFAULT 2000
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        RECORD;
  v_count  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT ss.strategy_id, SUM(ct.follower_pnl) AS realized
      FROM public.copy_trades ct
      JOIN public.strategy_subscriptions ss ON ss.id = ct.subscription_id
     WHERE ct.status = 'closed'
       AND ct.closed_at > NOW() - make_interval(hours => p_window_hours)
     GROUP BY ss.strategy_id
    HAVING SUM(ct.follower_pnl) <= (0 - p_loss_threshold)
  LOOP
    -- Skip if already quarantined/disabled.
    IF NOT EXISTS (
      SELECT 1 FROM public.strategy_risk_state
      WHERE strategy_id = r.strategy_id AND status <> 'active'
    ) THEN
      PERFORM public.quarantine_strategy(
        r.strategy_id,
        format('auto: realized %.0f over %sh below -%.0f', r.realized, p_window_hours, p_loss_threshold),
        FALSE);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_global_kill_switch(BOOLEAN, TEXT, TEXT)        TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_quarantine_breaching_strategies(INTEGER, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_kill_switch_active()                           TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.recompute_portfolio_exposure(UUID)                TO service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_portfolio_risk(UUID, TEXT, NUMERIC)      TO service_role;
GRANT EXECUTE ON FUNCTION public.quarantine_strategy(UUID, TEXT, BOOLEAN)          TO service_role;

-- ============================================================
-- Enforcement wiring (application side):
--   • engine /execute checks is_kill_switch_active() → 503 when active
--     (governs ALL execution, not just copy).
--   • copy-executor calls evaluate_portfolio_risk() before routing →
--     terminal-rejects jobs that breach a portfolio limit.
--   • orchestrator skips fan-out for strategies in strategy_risk_state
--     status != 'active'.
--   • reconciler calls recompute_portfolio_exposure() each pass and
--     auto-quarantines strategies whose realized drawdown breaches policy.
-- Follow-ups (need a market feed, deliberately not stubbed): correlation
-- exposure, volatility-aware sizing, liquidity + spread-anomaly checks.
-- ============================================================
