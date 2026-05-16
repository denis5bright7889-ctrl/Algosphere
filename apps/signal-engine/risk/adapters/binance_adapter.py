"""
Binance USDⓈ-M Futures execution adapter (testnet + live).

Default: testnet — flip with BINANCE_TESTNET=false in env once paper-traded
for 14+ days against leader signals.

Read-only methods satisfy the BrokerAdapter contract (used by the risk
engine for equity/spread checks). Execution methods are async and use
the official `python-binance` AsyncClient.
"""
from __future__ import annotations
import os
import time
from typing import Optional
from loguru import logger

from risk.adapters.base import (
    ExecutionAdapter, OrderRequest, OrderResult, OrderType, OrderSide,
    Position, OrderRejected, SlippageExceeded,
)
from risk.broker_adapter import SymbolSpec, default_spec

# python-binance is imported lazily so the engine can boot without it
# installed during paper-only deployments.
_AsyncClient = None


def _load_client():
    global _AsyncClient
    if _AsyncClient is None:
        from binance import AsyncClient as _AC   # type: ignore
        _AsyncClient = _AC
    return _AsyncClient


class BinanceAdapter(ExecutionAdapter):
    """
    Wraps python-binance's AsyncClient. One adapter instance per user
    (constructed per request from their stored API keys, OR for paper-mode
    single-user deployments, from BINANCE_API_KEY/_SECRET env vars).
    """

    def __init__(
        self,
        api_key:    str,
        api_secret: str,
        testnet:    bool = True,
        login:      str = 'binance_paper',
    ):
        self.api_key    = api_key
        self.api_secret = api_secret
        self.testnet    = testnet
        self.login      = login
        self._client = None
        self._connected = False
        self._last_equity: Optional[float] = None

    # ─── Lifecycle ────────────────────────────────────────────────────

    async def connect(self) -> None:
        if self._client is not None:
            return
        AC = _load_client()
        self._client = await AC.create(
            self.api_key, self.api_secret, testnet=self.testnet,
        )
        # One-shot connection probe
        try:
            await self._client.futures_ping()
            self._connected = True
            logger.info(f"Binance adapter connected (testnet={self.testnet})")
        except Exception as e:
            self._connected = False
            logger.error(f"Binance ping failed: {e}")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close_connection()
            self._client = None
            self._connected = False

    # ─── BrokerAdapter (read-only) ─────────────────────────────────────

    def get_account_login(self) -> str:
        return self.login

    def is_connected(self) -> bool:
        return self._connected

    def get_equity(self) -> Optional[float]:
        # Synchronous interface required by BrokerAdapter — the risk engine
        # calls this from non-async code. We return the cached value pulled
        # during the last async refresh() call.
        return self._last_equity

    def get_balance(self) -> Optional[float]:
        return self._last_equity

    def get_symbol_spec(self, symbol: str) -> Optional[SymbolSpec]:
        return default_spec(symbol)

    def get_spread_pips(self, symbol: str) -> Optional[float]:
        # Crypto spreads are tiny in pip-equivalent — return a conservative
        # default. For real-time book reading use get_order_book_async().
        return 1.0

    def close_all_positions(self) -> int:
        # Sync wrapper for the risk-engine emergency-flatten path
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Schedule async close — fire-and-forget; emergency_flatten
                # is best-effort
                asyncio.create_task(self._close_all_async())
                return 0
            return loop.run_until_complete(self._close_all_async())
        except Exception as e:
            logger.error(f"Binance close_all_positions failed: {e}")
            return 0

    def open_position_count(self) -> int:
        # Cached snapshot — refreshed in refresh_state()
        return getattr(self, '_open_positions_count', 0)

    # ─── Async equity / position refresh ──────────────────────────────

    async def refresh_state(self) -> None:
        """Pull live account state. Call before any risk-engine cycle."""
        if not self._client:
            await self.connect()
        if not self._client:
            return
        try:
            acct = await self._client.futures_account()
            self._last_equity = float(acct.get('totalWalletBalance', 0))
            positions = [p for p in acct.get('positions', [])
                         if float(p.get('positionAmt', 0)) != 0]
            self._open_positions_count = len(positions)
        except Exception as e:
            logger.error(f"Binance refresh_state failed: {e}")

    # ─── Execution ────────────────────────────────────────────────────

    async def submit_order(self, req: OrderRequest) -> OrderResult:
        if not self._client:
            await self.connect()
        if not self._client:
            raise OrderRejected("Binance client not connected")

        # Pre-fill slippage check for market orders
        if req.order_type == OrderType.MARKET:
            try:
                book = await self._client.futures_order_book(
                    symbol=req.symbol, limit=5,
                )
                best_bid = float(book['bids'][0][0])
                best_ask = float(book['asks'][0][0])
                spread = best_ask - best_bid
                mid    = (best_bid + best_ask) / 2
                if mid > 0 and spread / mid > req.max_slippage_pct:
                    raise SlippageExceeded(
                        f"Spread {spread/mid:.4%} > max {req.max_slippage_pct:.4%}"
                    )
            except SlippageExceeded:
                raise
            except Exception as e:
                logger.warning(f"Slippage check failed (continuing): {e}")

        params: dict = {
            'symbol':           req.symbol,
            'side':             req.side.value.upper(),
            'type':             'MARKET' if req.order_type == OrderType.MARKET else 'LIMIT',
            'quantity':         req.quantity,
            'newOrderRespType': 'RESULT',
        }
        if req.client_order_id:
            params['newClientOrderId'] = req.client_order_id[:36]
        if req.order_type == OrderType.LIMIT:
            if req.price is None:
                raise OrderRejected("LIMIT order requires price")
            params['price']        = req.price
            params['timeInForce']  = 'GTC'
        if req.reduce_only:
            params['reduceOnly'] = 'true'

        try:
            raw = await self._client.futures_create_order(**params)
        except Exception as e:
            raise OrderRejected(f"Binance rejected: {e}") from e

        avg_price = float(raw.get('avgPrice') or raw.get('price') or 0)
        filled    = float(raw.get('executedQty', 0))
        slippage  = 0.0
        if req.order_type == OrderType.MARKET and avg_price > 0 and req.price:
            slippage = (avg_price - req.price) / req.price

        # Attach SL / TP as reduce-only stop-market orders (best-effort)
        if filled > 0:
            await self._attach_protective_orders(req, filled)

        return OrderResult(
            order_id        = str(raw.get('orderId', '')),
            client_order_id = raw.get('clientOrderId'),
            symbol          = req.symbol,
            side            = req.side.value,
            status          = raw.get('status', 'NEW'),
            requested_qty   = req.quantity,
            filled_qty      = filled,
            avg_fill_price  = avg_price,
            commission      = 0.0,  # Binance returns commission in trade stream, not order resp
            slippage_pct    = slippage,
            timestamp_ms    = int(raw.get('updateTime', time.time() * 1000)),
            raw             = raw,
        )

    async def _attach_protective_orders(
        self, req: OrderRequest, filled_qty: float,
    ) -> None:
        if not self._client:
            return
        opposite = 'SELL' if req.side == OrderSide.BUY else 'BUY'

        if req.stop_loss is not None:
            try:
                await self._client.futures_create_order(
                    symbol      = req.symbol,
                    side        = opposite,
                    type        = 'STOP_MARKET',
                    stopPrice   = req.stop_loss,
                    quantity    = filled_qty,
                    reduceOnly  = 'true',
                    timeInForce = 'GTC',
                )
            except Exception as e:
                logger.warning(f"SL attach failed for {req.symbol}: {e}")

        if req.take_profit is not None:
            try:
                await self._client.futures_create_order(
                    symbol      = req.symbol,
                    side        = opposite,
                    type        = 'TAKE_PROFIT_MARKET',
                    stopPrice   = req.take_profit,
                    quantity    = filled_qty,
                    reduceOnly  = 'true',
                    timeInForce = 'GTC',
                )
            except Exception as e:
                logger.warning(f"TP attach failed for {req.symbol}: {e}")

    async def cancel_order(self, order_id: str, symbol: str) -> bool:
        if not self._client:
            return False
        try:
            await self._client.futures_cancel_order(symbol=symbol, orderId=int(order_id))
            return True
        except Exception as e:
            logger.warning(f"Binance cancel failed for {order_id}: {e}")
            return False

    async def get_positions(self) -> list[Position]:
        if not self._client:
            return []
        try:
            data = await self._client.futures_position_information()
            out: list[Position] = []
            for p in data:
                amt = float(p.get('positionAmt', 0))
                if amt == 0:
                    continue
                entry = float(p.get('entryPrice', 0))
                mark  = float(p.get('markPrice', 0))
                out.append(Position(
                    symbol         = p['symbol'],
                    side           = 'long' if amt > 0 else 'short',
                    qty            = abs(amt),
                    avg_entry      = entry,
                    current_price  = mark,
                    unrealized_pnl = float(p.get('unRealizedProfit', 0)),
                    margin_used    = float(p.get('isolatedMargin', 0)),
                    broker_pos_id  = f"{p['symbol']}:{'L' if amt > 0 else 'S'}",
                ))
            return out
        except Exception as e:
            logger.error(f"Binance get_positions failed: {e}")
            return []

    async def _close_all_async(self) -> int:
        positions = await self.get_positions()
        closed = 0
        for pos in positions:
            try:
                side = OrderSide.SELL if pos.side == 'long' else OrderSide.BUY
                await self.submit_order(OrderRequest(
                    symbol           = pos.symbol,
                    side             = side,
                    order_type       = OrderType.MARKET,
                    quantity         = pos.qty,
                    reduce_only      = True,
                    max_slippage_pct = 0.01,   # 1% allowed during emergency flatten
                ))
                closed += 1
            except Exception as e:
                logger.error(f"Emergency close of {pos.symbol} failed: {e}")
        return closed


# ─── Helper: build adapter from env ─────────────────────────────────────

def adapter_from_env(login: str = 'binance_paper') -> Optional[BinanceAdapter]:
    """
    Convenience factory. Returns None if Binance keys aren't configured.
    For multi-user setups, build per-user adapters from broker_connections
    rows instead.
    """
    key    = os.environ.get('BINANCE_API_KEY')
    secret = os.environ.get('BINANCE_API_SECRET')
    if not key or not secret:
        return None
    testnet = os.environ.get('BINANCE_TESTNET', 'true').lower() != 'false'
    return BinanceAdapter(key, secret, testnet=testnet, login=login)
