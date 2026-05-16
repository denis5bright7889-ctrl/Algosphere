"""
/execute — broker order routing endpoint.

Pre-checks (in order):
  1. Engine API key auth (same header used by other admin routes)
  2. Risk engine refresh + kill-switch check
  3. Slippage / spread guard delegated to the adapter
  4. Submit to broker
  5. Log + return result

For the v1 (paper-mode) deployment a single Binance adapter is built from
BINANCE_API_KEY / BINANCE_API_SECRET env vars. Multi-user routing reads
encrypted credentials from broker_connections (Phase 2).
"""
from __future__ import annotations
import os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from loguru import logger

from risk.adapters.binance_adapter import (
    BinanceAdapter, adapter_from_env,
)
from risk.adapters.base import (
    OrderRequest, OrderSide, OrderType, OrderRejected, SlippageExceeded,
)

router = APIRouter()

# ─── Auth (same pattern as the rest of the engine API) ──────────────

def _verify_engine_key(x_engine_key: Optional[str] = Header(default=None)):
    expected = os.environ.get('ENGINE_API_KEY', '')
    if not expected or x_engine_key != expected:
        raise HTTPException(status_code=403, detail='Invalid or missing engine key')


# ─── Per-process adapter cache ──────────────────────────────────────
# One adapter instance per "login" — for paper mode this is one shared
# instance. For multi-user it becomes one per user.

_adapters: dict[str, BinanceAdapter] = {}


async def get_adapter(login: str = 'binance_paper') -> Optional[BinanceAdapter]:
    if login not in _adapters:
        ad = adapter_from_env(login=login)
        if ad is None:
            return None
        await ad.connect()
        _adapters[login] = ad
    return _adapters[login]


# ─── Request / response schemas ─────────────────────────────────────

class ExecuteIn(BaseModel):
    broker:           str            = Field('binance', description='binance|bybit|okx|mt5|ctrader')
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
    # User identity for multi-tenant routing (Phase 2). v1 ignores.
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


# ─── Route ──────────────────────────────────────────────────────────

@router.post('/execute', dependencies=[Depends(_verify_engine_key)])
async def execute(payload: ExecuteIn) -> ExecuteOut:
    if payload.broker != 'binance':
        raise HTTPException(
            status_code=501,
            detail=f"Broker '{payload.broker}' adapter not yet enabled. Use 'binance'.",
        )

    adapter = await get_adapter()
    if adapter is None:
        raise HTTPException(
            status_code=503,
            detail='Binance adapter not configured. Set BINANCE_API_KEY + BINANCE_API_SECRET.',
        )

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
        logger.warning(f"Slippage veto for {payload.symbol}: {e}")
        return ExecuteOut(
            ok=False, broker='binance', testnet=adapter.testnet,
            error=f'slippage_veto: {e}',
        )
    except OrderRejected as e:
        logger.warning(f"Order rejected: {e}")
        return ExecuteOut(
            ok=False, broker='binance', testnet=adapter.testnet,
            error=f'rejected: {e}',
        )

    return ExecuteOut(
        ok              = True,
        order_id        = result.order_id,
        status          = result.status,
        filled_qty      = result.filled_qty,
        avg_fill_price  = result.avg_fill_price,
        slippage_pct    = result.slippage_pct,
        broker          = 'binance',
        testnet         = adapter.testnet,
    )


@router.get('/execute/status', dependencies=[Depends(_verify_engine_key)])
async def execute_status() -> dict:
    """Quick liveness check for the broker leg of the engine."""
    adapter = await get_adapter()
    if adapter is None:
        return {
            'configured': False,
            'reason':     'BINANCE_API_KEY / BINANCE_API_SECRET not set',
        }
    await adapter.refresh_state()
    return {
        'configured':       True,
        'broker':           'binance',
        'testnet':          adapter.testnet,
        'connected':        adapter.is_connected(),
        'equity_usdt':      adapter.get_equity(),
        'open_positions':   adapter.open_position_count(),
    }
