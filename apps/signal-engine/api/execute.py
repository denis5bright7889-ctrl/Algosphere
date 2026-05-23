"""
/execute — multi-broker order routing endpoint.

Pre-checks (in order):
  1. Engine API key auth (same header used by other admin routes)
  2. Resolve adapter for (user_id, broker) — either per-user from
     broker_connections (Phase 2 multi-tenant) or env-based singleton
     (Phase 1 single-user paper mode)
  3. Risk engine refresh + kill-switch check via adapter.refresh_state()
  4. Slippage / spread guard delegated to the adapter
  5. Submit to broker
  6. Return result

Routing rule for `user_id`:
  • If `user_id` is provided AND a broker_connections row exists for it,
    the per-user adapter wins.
  • Else fall back to the env-based singleton for the requested broker
    (paper-mode deployments).
"""
from __future__ import annotations
import asyncio
import os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from loguru import logger

import notifier

from risk.adapters.base import (
    ExecutionAdapter,
    OrderRequest, OrderSide, OrderType, OrderRejected, SlippageExceeded,
)
from risk.adapters.factory import (
    get_adapter_for_user, BrokerNotConnected, BrokerDecryptError, cache_size,
)
from risk.adapters import binance_adapter, bybit_adapter, okx_adapter, mt5_adapter
from risk.broker_guard import get_guard

router = APIRouter()

SUPPORTED_BROKERS = {'binance', 'bybit', 'okx', 'mt5'}


# ─── Global kill switch (cached) ──────────────────────────────────────
# The centralized risk engine's kill switch halts ALL execution. We read
# global_risk_state.kill_switch but cache it briefly so we don't add a DB
# round-trip to every order on the hot path. Cache TTL is short so a
# kill flips through within seconds. Fail-OPEN on read error (the per-
# account 12-gate + broker_guard remain) — a transient DB blip must not
# wedge execution, and an operator killing the switch will also see it
# propagate once the read recovers.
_kill_cache: dict = {'active': False, 'reason': None, 'checked_at': 0.0}
_KILL_TTL_S = 5.0


async def _kill_switch_active() -> tuple[bool, Optional[str]]:
    import time as _t
    now = _t.monotonic()
    if (now - _kill_cache['checked_at']) < _KILL_TTL_S:
        return _kill_cache['active'], _kill_cache['reason']
    try:
        from config import get_settings
        from supabase import create_client
        s = get_settings()
        if not s.has_supabase:
            return False, None
        db = create_client(s.supabase_url, s.supabase_service_role_key)
        res = await asyncio.to_thread(
            lambda: db.table('global_risk_state')
            .select('kill_switch,reason').eq('id', True).limit(1).execute())
        rows = res.data or []
        active = bool(rows and rows[0].get('kill_switch'))
        reason = rows[0].get('reason') if rows else None
        _kill_cache.update(active=active, reason=reason, checked_at=now)
        return active, reason
    except Exception as e:
        logger.warning(f"kill-switch read failed (fail-open): {e}")
        return False, None


# ─── Order idempotency / duplicate-fill guard (fail-open) ─────────────
# The copy-executor sends a STABLE client_order_id and reuses it on retry,
# so a retry after a lost-but-successful fill could double-submit. begin_order
# claims the coid; a coid already completed returns its cached result (no
# second order); a fresh in_flight coid is a concurrent duplicate. ALL of
# this is best-effort: any RPC error → proceed without dedup (degrades to
# prior behaviour). A stale in_flight self-heals after the lease, so the
# guard can never permanently wedge a coid. No client_order_id → no dedup.
try:
    MAX_SLIPPAGE_CEILING = float(os.environ.get('MAX_SLIPPAGE_CEILING', '0.01'))  # 1% hard cap
except ValueError:
    MAX_SLIPPAGE_CEILING = 0.01


def _engine_db():
    from config import get_settings
    from supabase import create_client
    s = get_settings()
    if not s.has_supabase:
        return None
    return create_client(s.supabase_url, s.supabase_service_role_key)


async def _begin_order(user_id: Optional[str], broker: str, coid: str) -> dict:
    """Returns the begin_order verdict, or {'owner': True, 'degraded': True}
    on any failure so execution proceeds without dedup."""
    try:
        db = _engine_db()
        if db is None:
            return {'owner': True, 'degraded': True}
        res = await asyncio.to_thread(lambda: db.rpc('begin_order', {
            'p_user': user_id or 'env', 'p_broker': broker, 'p_coid': coid,
        }).execute())
        return res.data if isinstance(res.data, dict) else {'owner': True, 'degraded': True}
    except Exception as e:
        logger.warning(f"begin_order failed (fail-open, no dedup): {e}")
        return {'owner': True, 'degraded': True}


async def _finish_order(broker: str, coid: str, state: str, *,
                        result=None, error: Optional[str] = None) -> None:
    try:
        db = _engine_db()
        if db is None:
            return
        args = {'p_broker': broker, 'p_coid': coid, 'p_state': state,
                'p_error': error}
        if result is not None:
            args.update({
                'p_order_id': result.order_id, 'p_status': result.status,
                'p_filled': result.filled_qty, 'p_price': result.avg_fill_price,
                'p_slip': result.slippage_pct,
            })
        await asyncio.to_thread(lambda: db.rpc('finish_order', args).execute())
    except Exception as e:
        logger.warning(f"finish_order failed (non-fatal): {e}")


# ─── Auth ────────────────────────────────────────────────────────────

def _verify_engine_key(x_engine_key: Optional[str] = Header(default=None)):
    expected = os.environ.get('ENGINE_API_KEY', '')
    if not expected or x_engine_key != expected:
        raise HTTPException(status_code=403, detail='Invalid or missing engine key')


# ─── Singleton (paper-mode) adapter cache ─────────────────────────────

_env_adapters: dict[str, ExecutionAdapter] = {}


async def _get_env_adapter(broker: str) -> Optional[ExecutionAdapter]:
    """Build a single env-based adapter for the requested broker. None
    if its env vars aren't set."""
    if broker in _env_adapters:
        return _env_adapters[broker]

    builder = {
        'binance': binance_adapter.adapter_from_env,
        'bybit':   bybit_adapter.adapter_from_env,
        'okx':     okx_adapter.adapter_from_env,
        'mt5':     mt5_adapter.adapter_from_env,
    }.get(broker)
    if builder is None:
        return None

    ad = builder()
    if ad is None:
        return None
    await ad.connect()
    _env_adapters[broker] = ad
    return ad


async def _resolve_adapter(
    broker: str, user_id: Optional[str],
) -> ExecutionAdapter:
    """Per-user lookup first, then env fallback."""
    if user_id:
        try:
            # Lazy supabase import keeps cold-start light
            from config import get_settings
            from supabase import create_client
            s  = get_settings()
            db = create_client(s.supabase_url, s.supabase_service_role_key)
            return await get_adapter_for_user(db, user_id, broker)
        except BrokerNotConnected:
            logger.debug(f"No broker_connections row for {user_id[:8]}/{broker} — trying env fallback")
        except BrokerDecryptError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Vault decrypt failed: {e}. Rotate CREDENTIAL_ENCRYPTION_KEY?",
            )

    env_ad = await _get_env_adapter(broker)
    if env_ad is None:
        raise HTTPException(
            status_code=503,
            detail=(
                f"No adapter available for broker={broker}. "
                f"Either connect via /brokers UI or set {broker.upper()}_* env vars."
            ),
        )
    return env_ad


# ─── Request / response schemas ───────────────────────────────────────

class ExecuteIn(BaseModel):
    broker:           str            = Field('binance', description='binance|bybit|okx|mt5')
    symbol:           str
    side:             str            = Field(..., pattern='^(buy|sell)$')
    order_type:       str            = Field('market', pattern='^(market|limit)$')
    quantity:         float          = Field(..., gt=0)
    price:            Optional[float] = None
    stop_loss:        Optional[float] = None
    take_profit:      Optional[float] = None
    client_order_id:  Optional[str]   = None
    max_slippage_pct: float           = 0.001
    reduce_only:      bool            = False
    user_id:          Optional[str]   = None


class ExecuteOut(BaseModel):
    ok:              bool
    order_id:        Optional[str] = None
    status:          Optional[str] = None
    filled_qty:      float         = 0.0
    avg_fill_price:  float         = 0.0
    slippage_pct:    float         = 0.0
    error:           Optional[str] = None
    broker:          str
    testnet:         bool          = True


# ─── Route ────────────────────────────────────────────────────────────

@router.post('/execute', dependencies=[Depends(_verify_engine_key)])
async def execute(payload: ExecuteIn) -> ExecuteOut:
    if payload.broker not in SUPPORTED_BROKERS:
        raise HTTPException(
            status_code=400,
            detail=f"Broker '{payload.broker}' not supported. Choose: {sorted(SUPPORTED_BROKERS)}",
        )

    # ── Global kill switch: halts NEW exposure ───────────────────────
    # The centralized risk engine's master cutoff. Blocks opening orders
    # when the desk has pulled the plug, but PERMITS reduce_only orders so
    # positions can still be flattened during a halt (risk-reducing). The
    # copy-executor retries blocked opens (the switch is operator-cleared).
    killed, kill_reason = await _kill_switch_active()
    if killed and not payload.reduce_only:
        logger.error(f"execution blocked — global kill switch active: {kill_reason}")
        return ExecuteOut(
            ok=False, broker=payload.broker, testnet=True,
            error=f'kill_switch_active: {kill_reason or "halted"}',
        )

    # ── Order idempotency: suppress duplicate fills (fail-open) ──────
    coid = payload.client_order_id
    owned = False
    if coid:
        claim = await _begin_order(payload.user_id, payload.broker, coid)
        if claim.get('duplicate'):
            c = claim.get('cached') or {}
            logger.info(f"duplicate suppressed [{payload.broker} {coid}] — returning cached fill")
            return ExecuteOut(
                ok=True, order_id=c.get('order_id'), status=c.get('status'),
                filled_qty=float(c.get('filled_qty') or 0),
                avg_fill_price=float(c.get('avg_fill_price') or 0),
                slippage_pct=float(c.get('slippage_pct') or 0),
                broker=payload.broker, testnet=True,
            )
        if claim.get('in_flight'):
            logger.warning(f"duplicate in-flight [{payload.broker} {coid}] — not double-submitting")
            return ExecuteOut(
                ok=False, broker=payload.broker, testnet=True,
                error='duplicate_in_flight: original order still executing',
            )
        owned = bool(claim.get('owner'))

    # Slippage ceiling: clamp the caller's tolerance to a hard cap so a
    # mis-set request can't accept an arbitrarily bad fill.
    slip = min(max(payload.max_slippage_pct, 0.0), MAX_SLIPPAGE_CEILING)

    finalized = False
    try:
        # ── Broker guard: per-broker rate limit + circuit breaker ────
        # Checked BEFORE resolving the adapter so a tripped/throttled broker
        # fast-fails cheaply. The copy-executor treats these as transient.
        guard = get_guard()
        decision = await guard.check(payload.broker)
        if not decision.allowed:
            logger.warning(
                f"broker_guard veto [{payload.broker}]: {decision.reason} "
                f"(retry_after={decision.retry_after_s:.1f}s)")
            return ExecuteOut(
                ok=False, broker=payload.broker, testnet=True,
                error=f'{decision.reason}: retry_after={decision.retry_after_s:.1f}s',
            )

        adapter = await _resolve_adapter(payload.broker, payload.user_id)
        await adapter.refresh_state()

        req = OrderRequest(
            symbol           = payload.symbol,
            side             = OrderSide(payload.side),
            order_type       = OrderType(payload.order_type),
            quantity         = payload.quantity,
            price            = payload.price,
            stop_loss        = payload.stop_loss,
            take_profit      = payload.take_profit,
            client_order_id  = payload.client_order_id,
            max_slippage_pct = slip,
            reduce_only      = payload.reduce_only,
        )

        try:
            result = await adapter.submit_order(req)
        except SlippageExceeded as e:
            # Our own pre-trade veto — broker responsive → success for the breaker.
            await guard.record(payload.broker, infra_failure=False)
            logger.warning(f"Slippage veto [{payload.broker} {payload.symbol}]: {e}")
            return ExecuteOut(ok=False, broker=payload.broker, testnet=adapter.testnet,
                              error=f'slippage_veto: {e}')
        except OrderRejected as e:
            await guard.record(payload.broker, infra_failure=False)
            logger.warning(f"Order rejected [{payload.broker}]: {e}")
            return ExecuteOut(ok=False, broker=payload.broker, testnet=adapter.testnet,
                              error=f'rejected: {e}')
        except Exception as e:
            # Connectivity / timeout / unexpected → INFRA failure for the breaker.
            await guard.record(payload.broker, infra_failure=True)
            logger.error(f"Broker submit error [{payload.broker} {payload.symbol}]: {e}")
            return ExecuteOut(ok=False, broker=payload.broker, testnet=adapter.testnet,
                              error=f'broker_error: {e}')

        # Successful submit — broker is healthy; cache the fill for dedup.
        await guard.record(payload.broker, infra_failure=False)
        if coid:
            await _finish_order(payload.broker, coid, 'completed', result=result)
            finalized = True
    finally:
        # Release the idempotency claim on any non-completed exit so the coid
        # is re-claimable. Stale in_flight self-heals after the lease even if
        # this is somehow missed — the guard can never permanently wedge a coid.
        if owned and not finalized and coid:
            await _finish_order(payload.broker, coid, 'failed', error='aborted before completion')

    # Fire-and-forget Telegram "trade opened" notification. Wrapping in
    # create_task means the HTTP response returns immediately; the
    # notifier itself never raises, so a Telegram outage can't taint
    # this code path. Silent no-op if the user hasn't linked Telegram.
    asyncio.create_task(notifier.dispatch_trade_opened(
        user_id      = payload.user_id,
        broker       = payload.broker,
        symbol       = payload.symbol,
        side         = payload.side,
        qty          = result.filled_qty,
        fill_price   = result.avg_fill_price,
        sl           = payload.stop_loss,
        tp           = payload.take_profit,
        slippage_pct = result.slippage_pct,
        testnet      = adapter.testnet,
    ))

    return ExecuteOut(
        ok              = True,
        order_id        = result.order_id,
        status          = result.status,
        filled_qty      = result.filled_qty,
        avg_fill_price  = result.avg_fill_price,
        slippage_pct    = result.slippage_pct,
        broker          = payload.broker,
        testnet         = adapter.testnet,
    )


@router.get('/execute/status', dependencies=[Depends(_verify_engine_key)])
async def execute_status(broker: str = 'binance') -> dict:
    """Quick liveness check for one broker leg. user_id-less so it only
    probes env-based singletons — for per-user health, query the
    broker_connections.status column from the web app."""
    if broker not in SUPPORTED_BROKERS:
        return {'configured': False, 'reason': f"unsupported broker {broker}"}

    adapter = await _get_env_adapter(broker)
    if adapter is None:
        return {
            'configured': False,
            'reason':     f"{broker.upper()}_* env vars not set",
            'broker':     broker,
        }

    await adapter.refresh_state()
    return {
        'configured':     True,
        'broker':         broker,
        'testnet':        adapter.testnet,
        'connected':      adapter.is_connected(),
        'equity':         adapter.get_equity(),
        'open_positions': adapter.open_position_count(),
        'session_cache':  cache_size(),
        'guard':          await get_guard().snapshot(),
    }


@router.get('/execute/guard', dependencies=[Depends(_verify_engine_key)])
async def guard_status() -> dict:
    """Per-broker rate-limiter + circuit-breaker state. Surfaced for ops
    dashboards / alerting — shows which brokers are OPEN (fast-failing) and
    how much cooldown remains."""
    return await get_guard().snapshot()


@router.post('/execute/invalidate', dependencies=[Depends(_verify_engine_key)])
async def invalidate_cache(user_id: str, broker: str) -> dict:
    """Web app calls this after a user rotates a broker key in /brokers."""
    if broker not in SUPPORTED_BROKERS:
        raise HTTPException(status_code=400, detail=f"unsupported broker {broker}")
    from risk.adapters.factory import drop_cache
    await drop_cache(user_id, broker)
    return {'ok': True}


@router.get('/positions', dependencies=[Depends(_verify_engine_key)])
async def positions(user_id: str, broker: str = 'binance') -> dict:
    """Live open positions for one (user, broker) — the reconciler diffs
    these against open copy_trades to detect missed/partial/desync/orphan
    states. Read-only: refreshes state then reads get_positions(). Never
    submits or mutates anything, so it can't disturb execution.

    Returns equity alongside positions so the reconciler can also feed the
    allocation engine's equity_ratio / risk_pct models with a live number."""
    adapter = await _resolve_adapter(broker, user_id)
    await adapter.refresh_state()
    try:
        pos = await adapter.get_positions()
    except Exception as e:
        logger.warning(f"get_positions failed [{broker} {user_id[:8] if user_id else '-'}]: {e}")
        raise HTTPException(status_code=502, detail=f'broker positions read failed: {e}')

    return {
        'ok':        True,
        'broker':    broker,
        'testnet':   adapter.testnet,
        'equity':    adapter.get_equity(),
        'positions': [
            {
                'symbol':         p.symbol,
                'side':           p.side,
                'qty':            p.qty,
                'avg_entry':      p.avg_entry,
                'current_price':  p.current_price,
                'unrealized_pnl': p.unrealized_pnl,
                'broker_pos_id':  p.broker_pos_id,
            }
            for p in pos
        ],
    }
