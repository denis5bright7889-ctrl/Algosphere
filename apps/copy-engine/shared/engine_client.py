"""
copy-engine — signal-engine HTTP client.

The executor never imports broker SDKs. It routes orders through the
engine's /api/v1/execute, which owns the per-user adapter factory and the
non-bypassable 12-gate institutional risk stack. The reconciler reads
/api/v1/positions the same way. This keeps the workers dependency-light
(supabase + httpx) and means the engine stays the single execution
authority — there is exactly one place that talks to brokers.

Every call is bounded by a timeout and never raises into the worker loop:
failures come back as a typed result the caller turns into a job status.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional

import httpx
from loguru import logger

from shared.config import Settings


@dataclass
class ExecResult:
    ok:             bool
    order_id:       Optional[str]
    status:         Optional[str]
    filled_qty:     float
    avg_fill_price: float
    slippage_pct:   float
    broker:         str
    testnet:        bool
    error:          Optional[str] = None


class EngineClient:
    def __init__(self, settings: Settings, timeout_s: float = 20.0):
        self._s = settings
        self._timeout = timeout_s

    @property
    def _ready(self) -> bool:
        return bool(self._s.engine_base and self._s.engine_api_key)

    async def execute(self, *, broker: str, symbol: str, side: str,
                      quantity: float, user_id: str, client_order_id: str,
                      price: Optional[float] = None,
                      stop_loss: Optional[float] = None,
                      take_profit: Optional[float] = None,
                      max_slippage_pct: float = 0.002,
                      reduce_only: bool = False) -> ExecResult:
        if not self._ready:
            return ExecResult(False, None, None, 0, 0, 0, broker, True,
                              'SIGNAL_ENGINE_URL / ENGINE_API_KEY not configured')
        url = f'{self._s.engine_base}/api/v1/execute'
        body = {
            'broker': broker, 'symbol': symbol, 'side': side,
            'order_type': 'market', 'quantity': quantity,
            # price is a HINT for adapters without a price feed (PaperBroker
            # needs it; real brokers ignore it on MARKET orders).
            'price': price,
            'stop_loss': stop_loss, 'take_profit': take_profit,
            'client_order_id': client_order_id, 'reduce_only': reduce_only,
            'max_slippage_pct': max_slippage_pct, 'user_id': user_id,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                r = await client.post(url, json=body,
                                      headers={'X-Engine-Key': self._s.engine_api_key})
            if r.status_code != 200:
                return ExecResult(False, None, None, 0, 0, 0, broker, True,
                                  f'engine {r.status_code}: {r.text[:200]}')
            d = r.json()
            return ExecResult(
                ok=bool(d.get('ok')), order_id=d.get('order_id'), status=d.get('status'),
                filled_qty=float(d.get('filled_qty', 0)),
                avg_fill_price=float(d.get('avg_fill_price', 0)),
                slippage_pct=float(d.get('slippage_pct', 0)),
                broker=d.get('broker', broker), testnet=bool(d.get('testnet', True)),
                error=d.get('error'),
            )
        except Exception as e:
            logger.warning(f'engine execute call failed [{broker} {symbol}]: {e}')
            return ExecResult(False, None, None, 0, 0, 0, broker, True, str(e))

    async def positions(self, *, user_id: str, broker: str) -> Optional[dict]:
        """Returns {'equity', 'positions': [...]} or None on failure.
        Used by the reconciler to diff broker truth against copy_trades and
        by the executor to source live follower equity for sizing."""
        if not self._ready:
            return None
        url = f'{self._s.engine_base}/api/v1/positions'
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                r = await client.get(url, params={'user_id': user_id, 'broker': broker},
                                     headers={'X-Engine-Key': self._s.engine_api_key})
            if r.status_code != 200:
                logger.debug(f'positions {r.status_code} for {user_id[:8]}/{broker}')
                return None
            return r.json()
        except Exception as e:
            logger.warning(f'engine positions call failed [{broker}]: {e}')
            return None
