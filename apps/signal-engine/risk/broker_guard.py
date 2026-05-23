"""
Per-broker execution guard — rate limiting + circuit breaking.

Sits at the execution boundary (inside /api/v1/execute, the single
execution authority) so EVERY order — copy, manual, web — is governed,
not just one source. Two independent protections per broker:

  1. Token-bucket RATE LIMITER — caps order submission rate so we never
     trip a broker's own API limits (which would get the key throttled or
     banned). Per-broker rate + burst, env-overridable.

  2. CIRCUIT BREAKER — after N consecutive INFRASTRUCTURE failures
     (timeouts, connection errors, unexpected exceptions) the breaker
     OPENS and fast-fails further orders for a cooldown, then HALF-OPENs
     to probe with a single order before closing. This stops a dead or
     flapping broker from absorbing the whole queue's retries.

Critically, a circuit breaker trips ONLY on infrastructure failure. An
OrderRejected (broker said no but is responsive) or SlippageExceeded (our
own pre-trade veto) means the broker is HEALTHY — those count as success
for breaker purposes and never open the circuit.

State is in-process (per uvicorn worker). For a multi-worker engine,
back the breaker with Redis so workers share trip state — noted as a
scaling follow-up; the engine is low-QPS and typically single-worker, so
per-worker protection is correct and sufficient today.

Fail-safe: if the guard is disabled (BROKER_GUARD_ENABLED=false) it allows
everything. It never raises into the execution path.
"""
from __future__ import annotations
import os
import time
import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ─── Config (env-overridable) ───────────────────────────────────────────

def _bool_env(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ('1', 'true', 'yes')


def _int_env(name: str, default: int) -> int:
    try:    return int(os.environ.get(name, default))
    except (TypeError, ValueError): return default


# Sensible per-broker defaults (rate tokens/sec : burst). MT5 is lower —
# the bridge re-logs per request (~100-300ms), so a high rate is pointless.
_DEFAULT_RATES: dict[str, tuple[float, int]] = {
    'binance':   (20.0, 40),
    'bybit':     (10.0, 20),
    'okx':       (10.0, 20),
    'mt5':       (5.0,  10),
    'oanda':     (5.0,  10),
    'tradovate': (5.0,  10),
    'paper':     (1000.0, 2000),
}


def _rate_for(broker: str) -> tuple[float, int]:
    """Per-broker override via BROKER_RATE_<BROKER>='rate:burst', else the
    default map, else BROKER_RATE_DEFAULT, else 10:20."""
    env = os.environ.get(f'BROKER_RATE_{broker.upper()}', '').strip()
    if not env:
        if broker in _DEFAULT_RATES:
            return _DEFAULT_RATES[broker]
        env = os.environ.get('BROKER_RATE_DEFAULT', '10:20').strip()
    try:
        rate_s, burst_s = env.split(':')
        return float(rate_s), int(burst_s)
    except (ValueError, AttributeError):
        return 10.0, 20


class CircuitState(str, Enum):
    CLOSED    = 'closed'      # normal — orders flow
    OPEN      = 'open'        # tripped — fast-fail until cooldown elapses
    HALF_OPEN = 'half_open'   # probing — allow one order to test recovery


# ─── Token bucket ────────────────────────────────────────────────────────

@dataclass
class _Bucket:
    rate:     float           # tokens refilled per second
    capacity: int             # max burst
    tokens:   float = field(default=0.0)
    last:     float = field(default_factory=time.monotonic)

    def __post_init__(self):
        self.tokens = float(self.capacity)

    def take(self) -> bool:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True
        return False

    def retry_after(self) -> float:
        """Seconds until the next token is available."""
        if self.tokens >= 1.0 or self.rate <= 0:
            return 0.0
        return (1.0 - self.tokens) / self.rate


# ─── Circuit breaker ──────────────────────────────────────────────────────

@dataclass
class _Breaker:
    threshold:  int
    cooldown_s: int
    state:      CircuitState = CircuitState.CLOSED
    consecutive_failures: int = 0
    opened_at:  float = 0.0
    half_open_inflight: bool = False

    def allow(self) -> bool:
        if self.state is CircuitState.CLOSED:
            return True
        if self.state is CircuitState.OPEN:
            if (time.monotonic() - self.opened_at) >= self.cooldown_s:
                self.state = CircuitState.HALF_OPEN
                self.half_open_inflight = False
            else:
                return False
        if self.state is CircuitState.HALF_OPEN:
            # Allow exactly one probe at a time.
            if self.half_open_inflight:
                return False
            self.half_open_inflight = True
            return True
        return True

    def record_success(self) -> None:
        self.consecutive_failures = 0
        self.half_open_inflight = False
        if self.state is not CircuitState.CLOSED:
            self.state = CircuitState.CLOSED

    def record_failure(self) -> None:
        self.consecutive_failures += 1
        self.half_open_inflight = False
        if self.state is CircuitState.HALF_OPEN:
            # Probe failed → straight back to OPEN, reset cooldown.
            self.state = CircuitState.OPEN
            self.opened_at = time.monotonic()
        elif self.consecutive_failures >= self.threshold:
            self.state = CircuitState.OPEN
            self.opened_at = time.monotonic()

    def cooldown_remaining(self) -> float:
        if self.state is not CircuitState.OPEN:
            return 0.0
        return max(0.0, self.cooldown_s - (time.monotonic() - self.opened_at))


# ─── Decision ──────────────────────────────────────────────────────────────

@dataclass
class GuardDecision:
    allowed:       bool
    reason:        str = 'ok'        # 'ok' | 'circuit_open' | 'rate_limited'
    retry_after_s: float = 0.0


# ─── The guard ───────────────────────────────────────────────────────────

class BrokerGuard:
    def __init__(self):
        self._enabled   = _bool_env('BROKER_GUARD_ENABLED', True)
        self._threshold = _int_env('BROKER_BREAKER_THRESHOLD', 5)
        self._cooldown  = _int_env('BROKER_BREAKER_COOLDOWN_S', 30)
        self._buckets:  dict[str, _Bucket]  = {}
        self._breakers: dict[str, _Breaker] = {}
        self._lock = asyncio.Lock()

    def _bucket(self, broker: str) -> _Bucket:
        b = self._buckets.get(broker)
        if b is None:
            rate, burst = _rate_for(broker)
            b = _Bucket(rate=rate, capacity=burst)
            self._buckets[broker] = b
        return b

    def _breaker(self, broker: str) -> _Breaker:
        b = self._breakers.get(broker)
        if b is None:
            b = _Breaker(threshold=self._threshold, cooldown_s=self._cooldown)
            self._breakers[broker] = b
        return b

    async def check(self, broker: str) -> GuardDecision:
        """Call BEFORE submitting. Circuit is checked first (cheaper, and a
        tripped broker shouldn't consume rate tokens), then the rate limit."""
        if not self._enabled:
            return GuardDecision(True)
        async with self._lock:
            breaker = self._breaker(broker)
            if not breaker.allow():
                return GuardDecision(False, 'circuit_open', breaker.cooldown_remaining())
            bucket = self._bucket(broker)
            if not bucket.take():
                return GuardDecision(False, 'rate_limited', bucket.retry_after())
            return GuardDecision(True)

    async def record(self, broker: str, *, infra_failure: bool) -> None:
        """Call AFTER the attempt. infra_failure=True ONLY for connectivity/
        timeout/unexpected errors — never for OrderRejected/SlippageExceeded
        (those mean the broker is responsive)."""
        if not self._enabled:
            return
        async with self._lock:
            breaker = self._breaker(broker)
            if infra_failure:
                breaker.record_failure()
            else:
                breaker.record_success()

    async def snapshot(self) -> dict:
        """Operational view for /execute/status + ops tooling."""
        async with self._lock:
            return {
                'enabled': self._enabled,
                'brokers': {
                    name: {
                        'circuit':              br.state.value,
                        'consecutive_failures': br.consecutive_failures,
                        'cooldown_remaining_s': round(br.cooldown_remaining(), 1),
                        'rate_tokens':          round(self._buckets[name].tokens, 1)
                                                if name in self._buckets else None,
                    }
                    for name, br in self._breakers.items()
                },
            }


# Module-level singleton — shared across all requests in this worker.
_guard: Optional[BrokerGuard] = None


def get_guard() -> BrokerGuard:
    global _guard
    if _guard is None:
        _guard = BrokerGuard()
    return _guard
