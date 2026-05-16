"""
OKX perpetual-swap execution adapter (demo + live).

Mirrors BinanceAdapter / BybitAdapter at the public API surface.

OKX-specific quirks vs the other two:
  • Three credentials: api_key, api_secret, passphrase (set when the key
    was created — cannot be retrieved later, must be stored alongside).
  • Demo trading uses the same endpoint with header `x-simulated-trading: 1`.
    The python-okx SDK handles this via flag=1 (demo) / flag=0 (live).
  • Position size is in "contracts" (`sz`), not base units. For linear
    USDT swaps one contract == one of the base asset; for the popular
    BTC-USDT-SWAP one contract == 0.01 BTC. Callers convert upstream.
  • Symbols are hyphenated: BTC-USDT-SWAP, ETH-USDT-SWAP.

Default: demo (flag=1) — flip with OKX_DEMO=false once shadow-validated.
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

# python-okx is imported lazily so the engine can boot without it.
_OKX = None


def _load_okx():
    global _OKX
    if _OKX is None:
        from okx import Trade, Account, MarketData  # type: ignore
        _OKX = (Trade, Account, MarketData)
    return _OKX


def _to_okx_symbol(s: str) -> str:
    """`BTCUSDT` → `BTC-USDT-SWAP`. Pass-through if already hyphenated."""
    if '-' in s:
        return s
    if s.endswith('USDT'):
        return f"{s[:-4]}-USDT-SWAP"
    if s.endswith('USD'):
        return f"{s[:-3]}-USD-SWAP"
    return s


class OKXAdapter(ExecutionAdapter):
    """
    Wraps python-okx Trade/Account/MarketData REST clients. One adapter
    instance per user.
    """

    def __init__(
        self,
        api_key:    str,
        api_secret: str,
        passphrase: str,
        demo:       bool = True,
        login:      str = 'okx_paper',
    ):
        self.api_key    = api_key
        self.api_secret = api_secret
        self.passphrase = passphrase
        self.demo       = demo
        self.login      = login
        self._trade   = None
        self._account = None
        self._market  = None
        self._connected = False
        self._last_equity: Optional[float] = None
        self._open_positions_count: int = 0

    # ─── Lifecycle ────────────────────────────────────────────────────

    @property
    def testnet(self) -> bool:
        # Compatibility alias for the rest of the engine which uses
        # `.testnet` for the demo / live flag.
        return self.demo

    async def connect(self) -> None:
        if self._trade is not None:
            return
        Trade, Account, MarketData = _load_okx()
        flag = '1' if self.demo else '0'

        def _build():
            return (
                Trade.TradeAPI(
                    self.api_key, self.api_secret, self.passphrase, False, flag,
                ),
                Account.AccountAPI(
                    self.api_key, self.api_secret, self.passphrase, False, flag,
                ),
                MarketData.MarketAPI(flag=flag),
            )

        self._trade, self._account, self._market = await asyncio.to_thread(_build)

        try:
            # cheapest auth ping
            await asyncio.to_thread(self._account.get_account_balance)
            self._connected = True
            logger.info(f"OKX adapter connected (demo={self.demo})")
        except Exception as e:
            self._connected = False
            logger.error(f"OKX ping failed: {e}")

    async def close(self) -> None:
        self._trade = None
        self._account = None
        self._market = None
        self._connected = False

    # ─── BrokerAdapter (read-only) ────────────────────────────────────

    def get_account_login(self) -> str:               return self.login
    def is_connected(self) -> bool:                   return self._connected
    def get_equity(self) -> Optional[float]:          return self._last_equity
    def get_balance(self) -> Optional[float]:         return self._last_equity
    def get_symbol_spec(self, s: str) -> Optional[SymbolSpec]: return default_spec(s)
    def get_spread_pips(self, s: str) -> Optional[float]:      return 1.0
    def open_position_count(self) -> int:             return self._open_positions_count

    def close_all_positions(self) -> int:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self._close_all_async())
                return 0
            return loop.run_until_complete(self._close_all_async())
        except Exception as e:
            logger.error(f"OKX close_all_positions failed: {e}")
            return 0

    # ─── Async refresh ────────────────────────────────────────────────

    async def refresh_state(self) -> None:
        if not self._account:
            await self.connect()
        if not self._account:
            return
        try:
            bal = await asyncio.to_thread(self._account.get_account_balance)
            data = (bal.get('data') or [{}])[0]
            self._last_equity = float(data.get('totalEq') or 0)

            pos = await asyncio.to_thread(
                self._account.get_positions, instType='SWAP',
            )
            rows = pos.get('data') or []
            self._open_positions_count = sum(
                1 for r in rows if float(r.get('pos', 0) or 0) != 0
            )
        except Exception as e:
            logger.error(f"OKX refresh_state failed: {e}")

    # ─── Execution ────────────────────────────────────────────────────

    async def submit_order(self, req: OrderRequest) -> OrderResult:
        if not self._trade:
            await self.connect()
        if not self._trade:
            raise OrderRejected("OKX client not connected")

        inst_id = _to_okx_symbol(req.symbol)

        # Slippage guard for market orders
        if req.order_type == OrderType.MARKET:
            try:
                book = await asyncio.to_thread(
                    self._market.get_orderbook, instId=inst_id, sz='5',
                )
                lst = (book.get('data') or [{}])[0]
                best_bid = float(lst['bids'][0][0])
                best_ask = float(lst['asks'][0][0])
                spread = best_ask - best_bid
                mid    = (best_bid + best_ask) / 2
                if mid > 0 and spread / mid > req.max_slippage_pct:
                    raise SlippageExceeded(
                        f"Spread {spread/mid:.4%} > max {req.max_slippage_pct:.4%}"
                    )
            except SlippageExceeded:
                raise
            except Exception as e:
                logger.warning(f"OKX slippage check failed (continuing): {e}")

        params: dict = {
            'instId':  inst_id,
            'tdMode':  'cross',
            'side':    'buy' if req.side == OrderSide.BUY else 'sell',
            'ordType': 'market' if req.order_type == OrderType.MARKET else 'limit',
            'sz':      str(req.quantity),
        }
        if req.client_order_id:
            params['clOrdId'] = req.client_order_id.replace('-', '')[:32]
        if req.order_type == OrderType.LIMIT:
            if req.price is None:
                raise OrderRejected("LIMIT order requires price")
            params['px'] = str(req.price)
        if req.reduce_only:
            params['reduceOnly'] = True
        # OKX `attachAlgoOrds` lets us attach TP / SL atomically
        algo = {}
        if req.stop_loss is not None:
            algo['slTriggerPx'] = str(req.stop_loss)
            algo['slOrdPx']     = '-1'   # market on trigger
            algo['slTriggerPxType'] = 'last'
        if req.take_profit is not None:
            algo['tpTriggerPx'] = str(req.take_profit)
            algo['tpOrdPx']     = '-1'
            algo['tpTriggerPxType'] = 'last'
        if algo:
            params['attachAlgoOrds'] = [algo]

        try:
            raw = await asyncio.to_thread(self._trade.place_order, **params)
        except Exception as e:
            raise OrderRejected(f"OKX rejected: {e}") from e

        if raw.get('code') not in ('0', 0):
            raise OrderRejected(
                f"OKX rejected (code={raw.get('code')}): {raw.get('msg') or raw}"
            )

        first = (raw.get('data') or [{}])[0]
        order_id = first.get('ordId', '')

        # Fetch executed details
        avg_price = 0.0
        filled    = 0.0
        status    = 'live'
        try:
            details = await asyncio.to_thread(
                self._trade.get_order, instId=inst_id, ordId=order_id,
            )
            row = (details.get('data') or [{}])[0]
            avg_price = float(row.get('avgPx') or row.get('px') or 0)
            filled    = float(row.get('accFillSz') or 0)
            status    = (row.get('state') or 'live').upper()
        except Exception as e:
            logger.debug(f"OKX order detail fetch deferred: {e}")

        slippage = 0.0
        if req.order_type == OrderType.MARKET and avg_price > 0 and req.price:
            slippage = (avg_price - req.price) / req.price

        return OrderResult(
            order_id        = str(order_id),
            client_order_id = first.get('clOrdId'),
            symbol          = req.symbol,
            side            = req.side.value,
            status          = status,
            requested_qty   = req.quantity,
            filled_qty      = filled,
            avg_fill_price  = avg_price,
            commission      = 0.0,
            slippage_pct    = slippage,
            timestamp_ms    = int(time.time() * 1000),
            raw             = raw,
        )

    async def cancel_order(self, order_id: str, symbol: str) -> bool:
        if not self._trade:
            return False
        try:
            await asyncio.to_thread(
                self._trade.cancel_order,
                instId = _to_okx_symbol(symbol),
                ordId  = order_id,
            )
            return True
        except Exception as e:
            logger.warning(f"OKX cancel failed for {order_id}: {e}")
            return False

    async def get_positions(self) -> list[Position]:
        if not self._account:
            return []
        try:
            data = await asyncio.to_thread(
                self._account.get_positions, instType='SWAP',
            )
            out: list[Position] = []
            for p in (data.get('data') or []):
                size = float(p.get('pos', 0) or 0)
                if size == 0:
                    continue
                side = 'long' if size > 0 else 'short'
                out.append(Position(
                    symbol         = p.get('instId', ''),
                    side           = side,  # type: ignore[arg-type]
                    qty            = abs(size),
                    avg_entry      = float(p.get('avgPx', 0) or 0),
                    current_price  = float(p.get('markPx', 0) or 0),
                    unrealized_pnl = float(p.get('upl', 0) or 0),
                    margin_used    = float(p.get('imr', 0) or 0),
                    broker_pos_id  = f"{p.get('instId')}:{'L' if size > 0 else 'S'}",
                ))
            return out
        except Exception as e:
            logger.error(f"OKX get_positions failed: {e}")
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
                    max_slippage_pct = 0.01,
                ))
                closed += 1
            except Exception as e:
                logger.error(f"OKX emergency close of {pos.symbol} failed: {e}")
        return closed


# ─── Helper: build adapter from env ─────────────────────────────────────

def adapter_from_env(login: str = 'okx_paper') -> Optional[OKXAdapter]:
    key    = os.environ.get('OKX_API_KEY')
    secret = os.environ.get('OKX_API_SECRET')
    pp     = os.environ.get('OKX_PASSPHRASE')
    if not (key and secret and pp):
        return None
    demo = os.environ.get('OKX_DEMO', 'true').lower() != 'false'
    return OKXAdapter(key, secret, pp, demo=demo, login=login)
