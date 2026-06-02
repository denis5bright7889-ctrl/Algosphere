"""
AlgoSphere Signal Engine — central observability event emitter.

Writes to two Supabase tables that the rest of the platform reads to
answer the questions "is the engine running?", "did the last cycle
produce signals?", "why did this trade fail?", "what does the broker
think happened?":

  • engine_heartbeats   — one row per component (signal_worker /
                          mt5_bridge / data_provider / execution).
                          Upserted on every cycle. The diagnostics
                          endpoint reads this for liveness.

  • system_event_log    — append-only audit of every meaningful
                          decision the engine makes (signal_skipped,
                          signal_rejected, trade_sent, trade_failed,
                          regime_classification, ...). Sanitised
                          payload_summary — never carries broker
                          credentials, API keys, or PII.

Hard contract: every helper here is non-raising. A failure to record
observability MUST NEVER block trading or signal generation. We log a
DEBUG line if the write fails and move on.

Founder rule (V3 spec Phase 7 / [[market_intel_v3_spec]]): never
silently drop. Every decision MUST be traceable. This module is the
one place the engine talks to that audit trail.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from loguru import logger
from supabase import create_client, Client

from config import get_settings


# Lazy singleton — same pattern as paper_adapter._db.
_db: Optional[Client] = None


def _client() -> Optional[Client]:
    """Service-role client. Returns None if Supabase isn't configured —
    the engine can run keyless locally; observability degrades silently
    rather than blocking."""
    global _db
    if _db is not None:
        return _db
    try:
        s = get_settings()
        if not s.has_supabase:
            return None
        _db = create_client(s.supabase_url, s.supabase_service_role_key)
        return _db
    except Exception as e:
        logger.debug(f"system_events: supabase client init failed: {e}")
        return None


# ─── Heartbeat ────────────────────────────────────────────────────────

def heartbeat(
    component: str,
    *,
    status: str = 'live',
    context: Optional[dict[str, Any]] = None,
) -> None:
    """Upsert a heartbeat row for `component`. status ∈ {live,degraded,down}.

    Components in use:
      'signal_worker' — main scan loop
      'mt5_bridge'    — live broker connectivity
      'data_provider' — market-data fetcher
      'execution'     — order routing
    """
    db = _client()
    if db is None:
        return
    try:
        db.table('engine_heartbeats').upsert({
            'component': component,
            'last_at':   datetime.now(timezone.utc).isoformat(),
            'status':    status,
            'context':   context or {},
        }, on_conflict='component').execute()
    except Exception as e:
        logger.debug(f"system_events: heartbeat({component}) failed: {e}")


# ─── Generic event writer ─────────────────────────────────────────────

def emit(
    surface: str,
    *,
    channel: str = 'internal',
    payload: Optional[dict[str, Any]] = None,
    reference_id: Optional[str] = None,
    status: str = 'sent',
    status_code: Optional[int] = None,
    error_class: Optional[str] = None,
) -> None:
    """Append a row to system_event_log. Sanitised — caller is responsible
    for never including raw API keys, broker passwords, or PII in `payload`.

    `surface` must be one of the values allowed by the CHECK constraint
    on system_event_log.surface (see migration 20240101000060). Unknown
    values are silently dropped to avoid breaking the engine on schema
    drift; the schema is authoritative.

    `channel='internal'` marks events that are observability-only (not
    routed to a Discord/WhatsApp publisher). The Discord publisher will
    later filter by channel='discord_*' to fan out broadcast events.
    """
    db = _client()
    if db is None:
        return
    try:
        db.table('system_event_log').insert({
            'surface':         surface,
            'channel':         channel,
            'payload_summary': payload or {},
            'reference_id':    reference_id,
            'status':          status,
            'status_code':     status_code,
            'error_class':     error_class,
        }).execute()
    except Exception as e:
        # Most common failure here is the surface failing the CHECK —
        # that's a schema-engine drift, log it loudly so the operator
        # sees it on the next deploy.
        logger.warning(f"system_events: emit({surface}) failed: {e}")


# ─── Convenience wrappers — one per common surface ───────────────────

def signal_skipped(symbol: str, reason: str, **extra: Any) -> None:
    """Pre-ensemble skip (insufficient bars, invalid features, breaker open,
    active-cap reached). Reason is a short stable token, not a sentence."""
    emit('signal_skipped', payload={'symbol': symbol, 'reason': reason, **extra})


def signal_rejected(symbol: str, reason: str, **extra: Any) -> None:
    """Post-ensemble rejection (confidence below threshold, strategy gate,
    institutional risk gate, dry-run swallow)."""
    emit('signal_rejected', payload={'symbol': symbol, 'reason': reason, **extra})


def signal_generated(symbol: str, signal_id: str, **extra: Any) -> None:
    """Signal landed in the signals table successfully."""
    emit('signal_generated',
         payload={'symbol': symbol, 'signal_id': signal_id, **extra},
         reference_id=signal_id)


def signal_drought(hours: float, last_at: Optional[str] = None) -> None:
    """No signals produced in the last `hours` window. Alarm-level event."""
    emit('signal_drought',
         payload={'hours': hours, 'last_at': last_at},
         status='failed',
         error_class='no_signals')


def regime_classification(symbol: str, regime: str, **extra: Any) -> None:
    """Diagnostic snapshot of regime per symbol per scan. High-volume —
    only persists when the regime CHANGES from the prior scan (caller
    enforces that to avoid swamping the table)."""
    emit('regime_classification', payload={'symbol': symbol, 'regime': regime, **extra})


def trade_sent(symbol: str, order_id: str, broker: str, **extra: Any) -> None:
    emit('trade_sent',
         payload={'symbol': symbol, 'broker': broker, **extra},
         reference_id=None)
    # order_id is a broker-side string, not a UUID — keep it in payload
    # and use reference_id only for our own row UUIDs (signal_id etc).


def trade_filled(symbol: str, order_id: str, broker: str,
                 avg_price: float, qty: float, **extra: Any) -> None:
    emit('trade_open',
         payload={'symbol': symbol, 'broker': broker, 'order_id': order_id,
                  'avg_price': avg_price, 'qty': qty, **extra})


def trade_failed(symbol: str, broker: str, reason: str,
                 *, status_code: Optional[int] = None,
                 error_class: Optional[str] = None, **extra: Any) -> None:
    emit('trade_failed',
         payload={'symbol': symbol, 'broker': broker, 'reason': reason, **extra},
         status='failed',
         status_code=status_code,
         error_class=error_class)


def risk_block(symbol: str, gates_failed: list[str], reasons: list[str]) -> None:
    """Per-trade institutional risk-gate rejection."""
    emit('risk_block',
         payload={'symbol': symbol, 'gates_failed': gates_failed, 'reasons': reasons},
         status='failed',
         error_class='risk_gate')


def health_alert(component: str, reason: str, **extra: Any) -> None:
    emit('health_alert',
         payload={'component': component, 'reason': reason, **extra},
         status='failed',
         error_class='health')


def mt5_status(state: str, **extra: Any) -> None:
    """state ∈ {'connected','disconnected','degraded'}."""
    emit('mt5_status', payload={'state': state, **extra},
         status='sent' if state == 'connected' else 'failed',
         error_class=None if state == 'connected' else 'mt5_unavailable')
