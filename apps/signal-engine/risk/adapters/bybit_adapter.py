"""
Bybit USDT-Perpetual execution adapter (testnet + live).

Mirrors BinanceAdapter byte-for-byte at the public API surface so the
routing layer (`api/execute.py`) can swap brokers by name without
per-adapter conditionals.

Default: testnet — flip with BYBIT_TESTNET=false in env only after
shadow-mode validation (50+ execs, ≥95% fill, <0.1% slip, <2% drift).

Uses pybit v5 unified API (`pybit.unified_trading`). category='linear'
== USDT perpetuals, which matches Binance Futures USDⓈ-M semantics.
"""
from __future__ import annotations
import asyncio
import os
import time
from typing import Optional
from loguru import logger

from risk.adapters.base import (
    ExecutionAdapter, OrderRequest, OrderResult, OrderType, OrderSide,
    Position, OrderRejected, SlippageExceeded,
)
from risk.broker_adapter import SymbolSpec, default_spec

# pybit ships a synchronous HTTP client. We wrap each call in
# `asyncio.to_thread` so the FastAPI event loop stays unblocked.
_HTTP = None


def _load_http():
    global _HTTP
    if _HTTP is None:
        from pybit.unified_trading import HTTP as _H   # type: ignore
        _HTTP = _H
    return _HTTP


class BybitAdapter(ExecutionAdapter):
    """
    Wraps pybit's unified_trading.HTTP client. One adapter instance per
    user (built per-request from broker_connections), or — for paper
    deployments — a single shared instance from env vars.
    """

    def __init__(
        self,
        api_key:    str,
        api_secret: str,
        testnet:    bool = True,
        login:      str = 'bybit_paper',
    ):
        self.api_key    = api_key
        self.api_secret = api_secret
        self.testnet    = testnet
        self.login      = login
        self._client = None
        self._connected = False
        self._last_equity: Optional[float] = None
        self._open_positions_count: int = 0

    # ─── Lifecycle ────────────────────────────────────────────────────

    async def connect(self) -> None:
        if self._client is not None:
            return
        H = _load_http()
        # pybit constructor is sync; bounce off the threadpool for symmetry
        # with how we'll call every other method.
        self._client = await asyncio.to_thread(
            H,
            testnet    = self.testnet,
            api_key    = self.api_key,
            api_secret = self.api_secret,
            recv_window= 5_000,
        )
        try:
            # cheapest sanity ping
            await asyncio.to_thread(self._client.get_server_time)
            self._connected = True
            logger.info(f"Bybit adapter connected (testnet={self.testnet})")
        except Exception as e:
            self._connected = False
            logger.error(f"Bybit ping failed: {e}")

    async def close(self) -> None:
        # pybit's HTTP client manages its own session lifecycle; nothing
        # to explicitly close. Drop our reference so the next connect()
        # re-instantiates cleanly.
        self._client = None
        self._connected = False

    # ─── BrokerAdapter (read-only) ────────────────────────────────────

    def get_account_login(self) -> str:
        return self.login

    def is_connected(self) -> bool:
        return self._connected

    def get_equity(self) -> Optional[float]:
        return self._last_equity

    def get_balance(self) -> Optional[float]:
        return self._last_equity

    def get_symbol_spec(self, symbol: str) -> Optional[SymbolSpec]:
        return default_spec(symbol)

    def get_spread_pips(self, symbol: str) -> Optional[float]:
        # Crypto spreads are sub-pip; conservative default. Real-time
        # spreads come from get_order_book() if a caller needs them.
        return 1.0

    def close_all_positions(self) -> int:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self._close_all_async())
                return 0
            return loop.run_until_complete(self._close_all_async())
        except Exception as e:
            logger.error(f"Bybit close_all_positions failed: {e}")
            return 0

    def open_position_count(self) -> int:
        return self._open_positions_count

    # ─── Async equity / position refresh ──────────────────────────────

    async def refresh_state(self) -> None:
        """Pull live UNIFIED-account wallet + positions snapshot."""
        if not self._client:
            await self.connect()
        if not self._client:
            return
        try:
            wallet = await asyncio.to_thread(
                self._client.get_wallet_balance, accountType='UNIFIED',
            )
            equity = 0.0
            for acct in (wallet.get('result', {}).get('list') or []):
                eq = acct.get('totalEquity') or acct.get('totalWalletBalance') or 0
                try:
                    equity = float(eq)
                except (TypeError, ValueError):
                    pass
                break  # one UNIFIED account per API key
            self._last_equity = equity

            positions = await asyncio.to_thread(
                self._client.get_positions,
                category   = 'linear',
                settleCoin = 'USDT',
            )
            rows = positions.get('result', {}).get('list') or []
            self._open_positions_count = sum(
                1 for r in rows if float(r.get('size', 0) or 0) > 0
            )
        except Exception as e:
            logger.error(f"Bybit refresh_state failed: {e}")

    # ─── Execution ────────────────────────────────────────────────────

    async def submit_order(self, req: OrderRequest) -> OrderResult:
        if not self._client:
            await self.connect()
        if not self._client:
            raise OrderRejected("Bybit client not connected")

        # Pre-fill slippage check for market orders
        if req.order_type == OrderType.MARKET:
            try:
                book = await asyncio.to_thread(
                    self._client.get_orderbook,
                    category = 'linear',
                    symbol   = req.symbol,
                    limit    = 5,
                )
                lst = book.get('result', {})
                best_bid = float(lst['b'][0][0])
                best_ask = float(lst['a'][0][0])
                spread = best_ask - best_bid
                mid    = (best_bid + best_ask) / 2
                if mid > 0 and spread / mid > req.max_slippage_pct:
                    raise SlippageExceeded(
                        f"Spread {spread/mid:.4%} > max {req.max_slippage_pct:.4%}"
                    )
            except SlippageExceeded:
                raise
            except Exception as e:
                logger.warning(f"Bybit slippage check failed (continuing): {e}")

        params: dict = {
            'category':    'linear',
            'symbol':      req.symbol,
            'side':        'Buy' if req.side == OrderSide.BUY else 'Sell',
            'orderType':   'Market' if req.order_type == OrderType.MARKET else 'Limit',
            'qty':         str(req.quantity),
            'timeInForce': 'IOC' if req.order_type == OrderType.MARKET else 'GTC',
        }
        if req.client_order_id:
            params['orderLinkId'] = req.client_order_id[:36]
        if req.order_type == OrderType.LIMIT:
            if req.price is None:
                raise OrderRejected("LIMIT order requires price")
            params['price'] = str(req.price)
        if req.reduce_only:
            params['reduceOnly'] = True
        # Bybit accepts TP/SL inline on place_order — saves the round-trip
        if req.stop_loss is not None:
            params['stopLoss']     = str(req.stop_loss)
            params['slTriggerBy']  = 'LastPrice'
        if req.take_profit is not None:
            params['takeProfit']   = str(req.take_profit)
            params['tpTriggerBy']  = 'LastPrice'

        try:
            raw = await asyncio.to_thread(self._client.place_order, **params)
        except Exception as e:
            raise OrderRejected(f"Bybit rejected: {e}") from e

        # Bybit returns retCode != 0 for soft rejects with a 200 HTTP
        if raw.get('retCode', 0) != 0:
            raise OrderRejected(
                f"Bybit rejected (retCode={raw.get('retCode')}): {raw.get('retMsg')}"
            )

        result = raw.get('result', {}) or {}
        order_id = str(result.get('orderId', ''))

        # Fetch the executed snapshot — place_order returns only orderId
        avg_price = 0.0
        filled    = 0.0
        status    = 'NEW'
        try:
            details = await asyncio.to_thread(
                self._client.get_open_orders,
                category = 'linear',
                symbol   = req.symbol,
                orderId  = order_id,
            )
            row = (details.get('result', {}).get('list') or [{}])[0]
            avg_price = float(row.get('avgPrice') or row.get('price') or 0)
            filled    = float(row.get('cumExecQty') or 0)
            status    = (row.get('orderStatus') or 'NEW').upper()
        except Exception as e:
            logger.debug(f"Bybit order detail fetch deferred: {e}")

        slippage = 0.0
        if req.order_type == OrderType.MARKET and avg_price > 0 and req.price:
            slippage = (avg_price - req.price) / req.price

        return OrderResult(
            order_id        = order_id,
            client_order_id = result.get('orderLinkId'),
            symbol          = req.symbol,
            side            = req.side.value,
            status          = status,
            requested_qty   = req.quantity,
            filled_qty      = filled,
            avg_fill_price  = avg_price,
            commission      = 0.0,  # Bybit returns fees via execution-stream, not place_order
            slippage_pct    = slippage,
            timestamp_ms    = int(time.time() * 1000),
            raw             = raw,
        )

    async def cancel_order(self, order_id: str, symbol: str) -> bool:
        if not self._client:
            return False
        try:
            await asyncio.to_thread(
                self._client.cancel_order,
                category = 'linear',
                symbol   = symbol,
                orderId  = order_id,
            )
            return True
        except Exception as e:
            logger.warning(f"Bybit cancel failed for {order_id}: {e}")
            return False

    async def get_positions(self) -> list[Position]:
        if not self._client:
            return []
        try:
            data = await asyncio.to_thread(
                self._client.get_positions,
                category   = 'linear',
                settleCoin = 'USDT',
            )
            out: list[Position] = []
            for p in (data.get('result', {}).get('list') or []):
                size = float(p.get('size', 0) or 0)
                if size == 0:
                    continue
                side = 'long' if (p.get('side') or '').lower() == 'buy' else 'short'
                out.append(Position(
                    symbol         = p['symbol'],
                    side           = side,  # type: ignore[arg-type]
                    qty            = size,
                    avg_entry      = float(p.get('avgPrice', 0) or 0),
                    current_price  = float(p.get('markPrice', 0) or 0),
                    unrealized_pnl = float(p.get('unrealisedPnl', 0) or 0),
                    margin_used    = float(p.get('positionIM', 0) or 0),
                    broker_pos_id  = f"{p['symbol']}:{'L' if side == 'long' else 'S'}",
                ))
            return out
        except Exception as e:
            logger.error(f"Bybit get_positions failed: {e}")
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
                logger.error(f"Bybit emergency close of {pos.symbol} failed: {e}")
        return closed


# ─── Helper: build adapter from env ─────────────────────────────────────

def adapter_from_env(login: str = 'bybit_paper') -> Optional[BybitAdapter]:
    """
    Convenience factory. Returns None if Bybit keys aren't configured.
    For multi-user setups, build per-user adapters from broker_connections
    rows instead (see `risk.adapters.factory`).
    """
    key    = os.environ.get('BYBIT_API_KEY')
    secret = os.environ.get('BYBIT_API_SECRET')
    if not key or not secret:
        return None
    testnet = os.environ.get('BYBIT_TESTNET', 'true').lower() != 'false'
    return BybitAdapter(key, secret, testnet=testnet, login=login)
