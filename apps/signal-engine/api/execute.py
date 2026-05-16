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
import os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from loguru import logger

from risk.adapters.base import (
    ExecutionAdapter,
    OrderRequest, OrderSide, OrderType, OrderRejected, SlippageExceeded,
)
from risk.adapters.factory import (
    get_adapter_for_user, BrokerNotConnected, BrokerDecryptError, cache_size,
)
from risk.adapters import binance_adapter, bybit_adapter, okx_adapter, mt5_adapter

router = APIRouter()

SUPPORTED_BROKERS = {'binance', 'bybit', 'okx', 'mt5'}

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

    adapter = await _resolve_adapter(payload.broker, payload.user_id)

    # Refresh equity / positions snapshot for any downstream risk gates
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
        max_slippage_pct = payload.max_slippage_pct,
        reduce_only      = payload.reduce_only,
    )

    try:
        result = await adapter.submit_order(req)
    except SlippageExceeded as e:
        logger.warning(f"Slippage veto [{payload.broker} {payload.symbol}]: {e}")
        return ExecuteOut(
            ok=False, broker=payload.broker, testnet=adapter.testnet,
            error=f'slippage_veto: {e}',
        )
    except OrderRejected as e:
        logger.warning(f"Order rejected [{payload.broker}]: {e}")
        return ExecuteOut(
            ok=False, broker=payload.broker, testnet=adapter.testnet,
            error=f'rejected: {e}',
        )

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
    }


@router.post('/execute/invalidate', dependencies=[Depends(_verify_engine_key)])
async def invalidate_cache(user_id: str, broker: str) -> dict:
    """Web app calls this after a user rotates a broker key in /brokers."""
    if broker not in SUPPORTED_BROKERS:
        raise HTTPException(status_code=400, detail=f"unsupported broker {broker}")
    from risk.adapters.factory import drop_cache
    await drop_cache(user_id, broker)
    return {'ok': True}
