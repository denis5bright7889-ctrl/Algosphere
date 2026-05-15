"""
AlgoSphere Signal Gate + Risk Engine
Validates signals through quality gates and circuit breakers before publishing.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from engine.signal_engine import SignalProposal
from engine.confidence_engine import ConfidenceResult
from engine.regime_engine import RegimeResult, regime_suppresses_trading


@dataclass
class GateDecision:
    approved: bool
    reason: str
    tier_required: str


@dataclass
class CircuitBreakerState:
    is_open: bool
    reason: str
    consecutive_losses: int
    daily_losses: int


# ─── Signal Gate ────────────────────────────────────────────────────────────

MIN_RR = 1.5
MIN_CONFIDENCE = 50


def gate_signal(
    proposal: SignalProposal,
    confidence: ConfidenceResult,
    regime: RegimeResult,
    breaker: CircuitBreakerState,
    active_signal_count: int,
    max_active: int = 1,
) -> GateDecision:
    """
    Multi-factor gate. All conditions must pass for signal to be published.
    """
    # 1. Circuit breaker
    if breaker.is_open:
        return GateDecision(False, f"Circuit breaker OPEN: {breaker.reason}", 'premium')

    # 2. Regime suppresses trading
    if regime_suppresses_trading(regime.regime):
        return GateDecision(False, "Market regime: exhaustion — no signals", 'premium')

    # 3. Confidence floor
    if not confidence.should_publish:
        return GateDecision(False, confidence.block_reason or "Confidence too low", 'premium')

    # 4. Minimum R:R
    if proposal.risk_reward < MIN_RR:
        return GateDecision(False, f"R:R {proposal.risk_reward} < minimum {MIN_RR}", 'premium')

    # 5. Active signal limit per symbol
    if active_signal_count >= max_active:
        return GateDecision(False, f"Already {active_signal_count} active signal(s) for {proposal.symbol}", 'starter')

    # 6. Determine tier based on confidence
    from engine.confidence_engine import tier_to_subscription
    tier = tier_to_subscription(confidence.tier)

    return GateDecision(True, f"Gate passed — {confidence.tier} tier ({confidence.score}/100)", tier)


# ─── Circuit Breaker ─────────────────────────────────────────────────────────

MAX_CONSECUTIVE_LOSSES = 3
DAILY_LOSS_CAP = 5
ROLLING_WIN_RATE_FLOOR = 0.30    # < 30% win rate over last 10 signals → open breaker
BREAKER_COOLDOWN_MINUTES = 60


class RiskEngine:
    """
    In-process circuit breaker state.
    For production: persist state in Supabase `engine_circuit_breaker` table.
    """

    def __init__(self, max_consecutive_losses: int = MAX_CONSECUTIVE_LOSSES,
                 daily_loss_cap: int = DAILY_LOSS_CAP):
        self._states: dict[str, CircuitBreakerState] = {}
        self._max_consecutive = max_consecutive_losses
        self._daily_cap = daily_loss_cap
        self._recent_outcomes: dict[str, list[bool]] = {}  # symbol → [True=win, False=loss]

    def get_state(self, symbol: str) -> CircuitBreakerState:
        return self._states.get(symbol, CircuitBreakerState(False, '', 0, 0))

    def record_outcome(self, symbol: str, was_win: bool) -> None:
        state = self._states.get(symbol, CircuitBreakerState(False, '', 0, 0))
        history = self._recent_outcomes.get(symbol, [])
        history.append(was_win)
        self._recent_outcomes[symbol] = history[-20:]  # keep last 20

        if not was_win:
            new_cl = state.consecutive_losses + 1
            new_dl = state.daily_losses + 1
        else:
            new_cl = 0
            new_dl = state.daily_losses

        breaker_open = False
        reason = ''

        if new_cl >= self._max_consecutive:
            breaker_open = True
            reason = f"{new_cl} consecutive losses"

        if new_dl >= self._daily_cap:
            breaker_open = True
            reason = f"Daily loss cap ({new_dl}) reached"

        if len(history) >= 10:
            win_rate = sum(history[-10:]) / 10
            if win_rate < ROLLING_WIN_RATE_FLOOR:
                breaker_open = True
                reason = f"Rolling win rate {win_rate:.0%} below floor {ROLLING_WIN_RATE_FLOOR:.0%}"

        self._states[symbol] = CircuitBreakerState(
            is_open=breaker_open,
            reason=reason,
            consecutive_losses=new_cl,
            daily_losses=new_dl,
        )

    def reset_daily(self, symbol: str) -> None:
        if symbol in self._states:
            s = self._states[symbol]
            self._states[symbol] = CircuitBreakerState(
                is_open=s.consecutive_losses >= self._max_consecutive,
                reason=s.reason,
                consecutive_losses=s.consecutive_losses,
                daily_losses=0,
            )

    def reset_symbol(self, symbol: str) -> None:
        self._states.pop(symbol, None)
        self._recent_outcomes.pop(symbol, None)
