"""
Broker connection state machine — single source of truth.

Every broker_connection row resolves into exactly one of these states.
The whole point of this module is to make "stuck pending" impossible:
either we can connect, we can't, or the broker is structurally
unavailable in this environment (MT5 on Linux). Each state has a clear,
explainable transition rule and a UI label.

States:
  PENDING   — row just created; engine hasn't checked yet. Capped at
              MAX_PENDING_CYCLES probe cycles — after that it flips to
              FAILED with reason "timeout".
  TESTING   — synchronous handshake currently in progress (set by the
              POST /api/v1/brokers/test endpoint while the round-trip
              is in-flight). Always transient.
  CONNECTED — adapter.connect() + refresh_state() succeeded at least
              once. Equity is fresh.
  FAILED    — last attempt errored. error_message names the cause.
              User can retry from the UI to re-attempt.
  DISABLED  — broker is structurally unreachable from this environment.
              Right now this only applies to MT5 on the Linux engine
              (the MetaTrader5 Python package is Windows-only). The UI
              points the user at the MT5-bridge setup docs and does not
              keep retrying.
  REVOKED   — user-deleted the row. Soft-delete state — preserved for
              audit but excluded from health probes.

Transitions (probe-driven):
  PENDING   →  TESTING / CONNECTED / FAILED / DISABLED
  TESTING   →  CONNECTED / FAILED
  CONNECTED →  FAILED         (if probe fails)
  FAILED    →  CONNECTED      (if user-triggered retry succeeds)
              FAILED          (if subsequent probes keep failing)
  DISABLED  →  (no transitions — the underlying environment must change
                first; on next deploy the startup probe re-evaluates)
"""
from __future__ import annotations
from typing import Optional

# After this many consecutive 10-min probe cycles in PENDING, we flip
# to FAILED with reason "handshake timeout". Two cycles ≈ 20 minutes —
# long enough to absorb a Railway cold-start, short enough that no user
# is ever told "still pending" indefinitely.
MAX_PENDING_CYCLES = 2


# ─── State constants ───────────────────────────────────────────────────

class BrokerState:
    PENDING   = 'pending'
    TESTING   = 'testing'
    CONNECTED = 'connected'
    FAILED    = 'failed'
    DISABLED  = 'disabled'
    REVOKED   = 'revoked'

    TERMINAL_OK   = {CONNECTED}
    TERMINAL_BAD  = {FAILED, DISABLED, REVOKED}
    TRANSIENT     = {PENDING, TESTING}


# ─── Environment-level capability probe ────────────────────────────────

# Cached at module import. Re-evaluated only on engine restart — the
# whole point of DISABLED is "this won't change without redeploying."
_MT5_PROBE: Optional[tuple[bool, Optional[str]]] = None


def mt5_available() -> tuple[bool, Optional[str]]:
    """
    Return (available, reason_if_not).

    Probes whether the MetaTrader5 Python package can be imported in
    the current process. On Linux this raises ModuleNotFoundError, on
    Windows without the package installed it also fails — both are
    legitimate DISABLED states.
    """
    global _MT5_PROBE
    if _MT5_PROBE is not None:
        return _MT5_PROBE
    try:
        import MetaTrader5  # noqa: F401  — capability probe only
        _MT5_PROBE = (True, None)
    except Exception as e:   # ModuleNotFoundError on Linux; OSError on broken installs
        _MT5_PROBE = (False, f'MetaTrader5 package not loadable in this environment ({type(e).__name__})')
    return _MT5_PROBE


def reset_mt5_probe() -> None:
    """Test-only: force the next mt5_available() call to re-probe."""
    global _MT5_PROBE
    _MT5_PROBE = None


# ─── Disabled-broker reason helpers ────────────────────────────────────

def disabled_reason_for(broker: str) -> Optional[str]:
    """
    Return a human-readable explanation if `broker` is structurally
    unavailable in this environment, else None.

    For MT5 there are two paths to "available":
      1. Local mode — the MetaTrader5 package imports successfully
         (engine running on Windows alongside the terminal).
      2. Bridge mode — MT5_BRIDGE_URL is configured (engine on
         Linux/Railway delegates to a Windows VPS running
         apps/mt5-bridge).
    DISABLED is returned only when BOTH paths are unavailable.
    """
    if broker == 'mt5':
        import os
        if os.environ.get('MT5_BRIDGE_URL', '').strip():
            return None  # bridge configured — let it handle errors at handshake
        ok, reason = mt5_available()
        if not ok:
            return (
                'MT5 requires either the MetaTrader5 Python package locally '
                '(Windows engine deploy) or a configured MT5 bridge service '
                'on a Windows VPS (set MT5_BRIDGE_URL on the engine). Neither '
                f'is present in this environment. ({reason})'
            )
    if broker == 'ctrader':
        return 'cTrader adapter is not implemented yet.'
    return None
