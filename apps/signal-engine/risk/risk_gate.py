"""
AlgoSphere Quant — Risk Gate
12-gate institutional pre-trade validator.

This is the SINGLE point of authority for trade approval.
NO trade may bypass this gate.

Fail-safe principle: any exception inside the gate returns approved=False.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from loguru import logger

from .config import RiskConfig
from .risk_engine import RiskEngine
from .sizing import price_to_pips


# ─── 12 named gates (audit-friendly constants) ───────────────────────────────

GATE_KILL_SWITCH          = '01_kill_switch'
GATE_DAILY_HALT           = '02_daily_halt'
GATE_COOLDOWN             = '03_cooldown'
GATE_CONSECUTIVE_LOSSES   = '04_consecutive_losses'
GATE_DAILY_DD             = '05_daily_dd'
GATE_WEEKLY_DD            = '06_weekly_dd'
GATE_TOTAL_DD             = '07_total_dd'
GATE_PORTFOLIO_EXPOSURE   = '08_portfolio_exposure'
GATE_SYMBOL_SPEC          = '09_symbol_spec'
GATE_SL_DISTANCE          = '10_sl_distance'
GATE_SPREAD               = '11_spread'
GATE_RISK_PER_TRADE       = '12_risk_per_trade'

ALL_GATES = [
    GATE_KILL_SWITCH, GATE_DAILY_HALT, GATE_COOLDOWN, GATE_CONSECUTIVE_LOSSES,
    GATE_DAILY_DD, GATE_WEEKLY_DD, GATE_TOTAL_DD, GATE_PORTFOLIO_EXPOSURE,
    GATE_SYMBOL_SPEC, GATE_SL_DISTANCE, GATE_SPREAD, GATE_RISK_PER_TRADE,
]


@dataclass
class GateDecision:
    approved:      bool                 = False
    reasons:       list[str]            = field(default_factory=list)
    gates_passed:  list[str]            = field(default_factory=list)
    gates_failed:  list[str]            = field(default_factory=list)
    lot_size:      float                = 0.0
    risk_amount:   float                = 0.0
    metadata:      dict                 = field(default_factory=dict)


class RiskGate:
    """
    The 12-gate institutional pre-trade validator.

    Usage:
        decision = risk_gate.approve_trade(
            symbol='XAUUSD',
            direction='buy',
            entry_price=2050.5,
            stop_loss_price=2048.0,
            spread_pips=2.5,
        )
        if not decision.approved:
            # SKIP TRADE — log decision.reasons
            return

        # decision.lot_size is the authorised lot
    """

    def __init__(self, engine: RiskEngine, config: RiskConfig):
        self.engine = engine
        self.config = config

    # ───────────────────────────────────────────────────────────────────────
    # Public — fail-safe wrapper
    # ───────────────────────────────────────────────────────────────────────

    def approve_trade(
        self,
        symbol: str,
        direction: str,
        entry_price: float,
        stop_loss_price: float,
        spread_pips: Optional[float] = None,
    ) -> GateDecision:
        decision = GateDecision()

        # Master switch — if risk subsystem is disabled, reject loudly.
        if not self.config.enabled:
            decision.approved = False
            decision.reasons.append("Risk subsystem disabled in config — refusing to approve")
            logger.critical("RiskGate called while disabled — rejecting trade")
            return decision

        try:
            self._evaluate_all_gates(
                decision, symbol, direction, entry_price, stop_loss_price, spread_pips
            )
        except Exception as e:
            # Fail-safe: ANY internal error → REJECT
            logger.critical(f"RiskGate internal error: {e!r} — defaulting to REJECT")
            decision.approved = False
            decision.reasons.append(f"Internal error: {e}")

        # Audit log is also fail-safe — must never raise out of approve_trade
        try:
            self._audit_log(decision, symbol, direction, entry_price, stop_loss_price)
        except Exception as e:
            logger.error(f"RiskGate audit log failed: {e!r}")
        return decision

    # ───────────────────────────────────────────────────────────────────────
    # Internal — runs gates 1-12 in order
    # ───────────────────────────────────────────────────────────────────────

    def _evaluate_all_gates(
        self,
        decision: GateDecision,
        symbol: str,
        direction: str,
        entry_price: float,
        stop_loss_price: float,
        spread_pips: Optional[float],
    ) -> None:
        engine = self.engine
        state  = engine.state

        # ── GATE 1: Kill switch / locked state ────────────────────────────
        if engine.is_locked():
            self._reject(decision, GATE_KILL_SWITCH, f"Engine locked: {state.locked_reason}")
            return
        decision.gates_passed.append(GATE_KILL_SWITCH)

        # ── GATE 2: Daily halt (cooldown timer set by DD breach) ──────────
        if engine.is_cooldown_active() and self._cooldown_came_from_daily_halt():
            self._reject(decision, GATE_DAILY_HALT,
                         f"Daily halt active until {state.cooldown_until_iso}")
            return
        decision.gates_passed.append(GATE_DAILY_HALT)

        # ── GATE 3: Cooldown (consecutive-loss emotional circuit breaker) ─
        if engine.is_cooldown_active():
            self._reject(decision, GATE_COOLDOWN,
                         f"Cooldown active until {state.cooldown_until_iso}")
            return
        decision.gates_passed.append(GATE_COOLDOWN)

        # ── GATE 4: Consecutive-loss hard breaker ─────────────────────────
        if state.consecutive_losses >= self.config.max_consecutive_losses:
            self._reject(decision, GATE_CONSECUTIVE_LOSSES,
                         f"{state.consecutive_losses} consecutive losses "
                         f">= max {self.config.max_consecutive_losses}")
            return
        decision.gates_passed.append(GATE_CONSECUTIVE_LOSSES)

        # ── GATE 5: Daily DD ──────────────────────────────────────────────
        daily_dd = engine.daily_drawdown_pct()
        if daily_dd >= self.config.daily_loss_limit_pct:
            self._reject(decision, GATE_DAILY_DD,
                         f"Daily DD {daily_dd:.2%} >= limit {self.config.daily_loss_limit_pct:.2%}")
            return
        decision.gates_passed.append(GATE_DAILY_DD)

        # ── GATE 6: Weekly DD ─────────────────────────────────────────────
        weekly_dd = engine.weekly_drawdown_pct()
        if weekly_dd >= self.config.weekly_loss_limit_pct:
            self._reject(decision, GATE_WEEKLY_DD,
                         f"Weekly DD {weekly_dd:.2%} >= limit {self.config.weekly_loss_limit_pct:.2%}")
            return
        decision.gates_passed.append(GATE_WEEKLY_DD)

        # ── GATE 7: Total DD ──────────────────────────────────────────────
        total_dd = engine.total_drawdown_pct()
        if total_dd >= self.config.max_total_drawdown_pct:
            self._reject(decision, GATE_TOTAL_DD,
                         f"Total DD {total_dd:.2%} >= limit {self.config.max_total_drawdown_pct:.2%}")
            return
        decision.gates_passed.append(GATE_TOTAL_DD)

        # ── GATE 8: Portfolio exposure ────────────────────────────────────
        if state.open_positions >= self.config.max_open_positions:
            self._reject(decision, GATE_PORTFOLIO_EXPOSURE,
                         f"Open positions {state.open_positions} >= max {self.config.max_open_positions}")
            return
        decision.gates_passed.append(GATE_PORTFOLIO_EXPOSURE)

        # ── GATE 9: Broker symbol spec ────────────────────────────────────
        spec = engine.broker.get_symbol_spec(symbol)
        if not spec:
            self._reject(decision, GATE_SYMBOL_SPEC, f"No broker spec for {symbol}")
            return
        decision.gates_passed.append(GATE_SYMBOL_SPEC)

        # ── GATE 10: SL distance ──────────────────────────────────────────
        sl_distance = abs(entry_price - stop_loss_price)
        sl_pips     = price_to_pips(symbol, sl_distance)
        if sl_pips < self.config.min_sl_distance_pips:
            self._reject(decision, GATE_SL_DISTANCE,
                         f"SL distance {sl_pips:.1f} pips < min {self.config.min_sl_distance_pips}")
            return
        decision.gates_passed.append(GATE_SL_DISTANCE)
        decision.metadata['sl_pips'] = round(sl_pips, 2)

        # ── GATE 11: Live spread ──────────────────────────────────────────
        if spread_pips is None:
            spread_pips = engine.broker.get_spread_pips(symbol)
        if spread_pips is None:
            self._reject(decision, GATE_SPREAD, "No spread available — refusing to size blindly")
            return
        if spread_pips > self.config.max_spread_pips:
            self._reject(decision, GATE_SPREAD,
                         f"Spread {spread_pips:.1f} pips > max {self.config.max_spread_pips}")
            return
        decision.gates_passed.append(GATE_SPREAD)
        decision.metadata['spread_pips'] = round(spread_pips, 2)

        # ── GATE 12: Risk-per-trade (sizing) ──────────────────────────────
        lot, sizing_meta = engine.calculate_lot(symbol, sl_distance)
        decision.metadata.update(sizing_meta)
        if lot <= 0:
            self._reject(decision, GATE_RISK_PER_TRADE,
                         f"Sizing rejected: {sizing_meta.get('reason', 'unknown')}")
            return
        decision.gates_passed.append(GATE_RISK_PER_TRADE)

        decision.lot_size    = lot
        decision.risk_amount = sizing_meta.get('risk_amount') or 0.0
        decision.approved    = True
        decision.reasons.append("All 12 gates passed")

    # ───────────────────────────────────────────────────────────────────────
    # Helpers
    # ───────────────────────────────────────────────────────────────────────

    def _reject(self, decision: GateDecision, gate: str, reason: str) -> None:
        decision.approved = False
        decision.gates_failed.append(gate)
        decision.reasons.append(f"{gate}: {reason}")

    def _cooldown_came_from_daily_halt(self) -> bool:
        """
        Distinguish a 'daily halt' cooldown (set by DD breach) from a normal
        consecutive-loss cooldown. We treat any cooldown extending past
        midnight UTC of the current day as a daily-halt-style halt.
        """
        if not self.engine.state.cooldown_until_iso:
            return False
        try:
            from datetime import datetime as _dt
            end = _dt.fromisoformat(self.engine.state.cooldown_until_iso)
            return (end - _dt.fromisoformat(self.engine.state.last_refreshed_iso)).total_seconds() > 60 * 60 * 6
        except Exception:
            return False

    def _audit_log(
        self,
        decision: GateDecision,
        symbol: str,
        direction: str,
        entry_price: float,
        stop_loss_price: float,
    ) -> None:
        tele = self.engine.telemetry()
        logger.info(
            "RISK GATE | "
            f"symbol={symbol} direction={direction} approved={decision.approved} "
            f"entry={entry_price} sl={stop_loss_price} lot={decision.lot_size:.4f} "
            f"risk=${decision.risk_amount:.2f} "
            f"equity=${tele['current_equity']} dd_t={tele['total_drawdown_pct']}% "
            f"dd_d={tele['daily_drawdown_pct']}% dd_w={tele['weekly_drawdown_pct']}% "
            f"open={tele['open_positions']} "
            f"streak_l={tele['consecutive_losses']} streak_w={tele['consecutive_wins']} "
            f"micro={decision.metadata.get('micro_account_mode', False)} "
            f"spread={decision.metadata.get('spread_pips', '?')} "
            f"gates={len(decision.gates_passed)}/12 "
            f"failed=[{','.join(decision.gates_failed)}] "
            f"reasons=[{' | '.join(decision.reasons)}]"
        )
