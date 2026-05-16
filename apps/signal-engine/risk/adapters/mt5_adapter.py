"""
MetaTrader 5 execution adapter (live broker accounts via MT5 terminal).

This is the workhorse adapter for retail forex / CFD / index brokers
(Pepperstone, IC Markets, FTMO, MyForexFunds, etc.) — anywhere the
broker exposes only MT4/MT5 (not REST). It drives an MT5 terminal on
the same host through the official `MetaTrader5` Python package.

Topology (this is the one un-skippable infrastructure choice):
  ┌────────────────────────────────────────────────────────────────┐
  │  Windows host (Oracle Free Tier VM or any VPS)                 │
  │    ├── MetaTrader 5 terminal (logged into broker account)      │
  │    └── This adapter (signal-engine process)                    │
  └────────────────────────────────────────────────────────────────┘

Wine on Linux works but introduces flake — we recommend a Windows VPS
once paper testing graduates to real money.

Key differences vs the crypto adapters:
  • `MetaTrader5` is synchronous and *singleton* — there is exactly one
    `mt5.initialize()` per process. We serialize all calls behind an
    asyncio.Lock and run them in a threadpool.
  • One adapter instance == one broker login on that terminal. For
    multi-account setups, the terminal must be switched per call
    (`mt5.login(login, password, server)`).
  • Volume is in *lots*, not base units. Symbol filling modes and digit
    counts come from `symbol_info()` not a static spec.

`testnet` here means *demo account* (broker-side). The adapter doesn't
care which it is — the broker login determines that.
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

# Module-level lock so simultaneous tasks don't race on the singleton
# `mt5` module. Adapter-level locks aren't enough — different adapters
# (different accounts on the same terminal) still share the module.
_MT5_LOCK = asyncio.Lock()
_mt5_module = None


def _load_mt5():
    global _mt5_module
    if _mt5_module is None:
        import MetaTrader5 as mt5   # type: ignore
        _mt5_module = mt5
    return _mt5_module


class MT5Adapter(ExecutionAdapter):
    """
    Drives an MT5 terminal on the host machine.

    Construction does not connect. `connect()` initializes the terminal
    and logs in. On multi-account hosts, each `connect()` re-logs the
    terminal — the most recent login wins. Serialize via _MT5_LOCK.
    """

    def __init__(
        self,
        login:        int,
        password:     str,
        server:       str,
        path:         Optional[str] = None,    # MT5 terminal exe path
        testnet:      bool = True,             # cosmetic — broker decides
        timeout_ms:   int  = 10_000,
    ):
        self._login_id = int(login)
        self.password  = password
        self.server    = server
        self.path      = path
        self.testnet   = testnet
        self.timeout_ms = timeout_ms
        self.login     = f"mt5_{login}"
        self._connected = False
        self._last_equity: Optional[float] = None
        self._open_positions_count: int = 0

    # ─── Lifecycle ────────────────────────────────────────────────────

    async def connect(self) -> None:
        mt5 = _load_mt5()

        async with _MT5_LOCK:
            def _init():
                if self.path:
                    ok = mt5.initialize(
                        path=self.path, timeout=self.timeout_ms,
                    )
                else:
                    ok = mt5.initialize(timeout=self.timeout_ms)
                if not ok:
                    return False, mt5.last_error()
                ok2 = mt5.login(
                    self._login_id, password=self.password, server=self.server,
                )
                if not ok2:
                    err = mt5.last_error()
                    mt5.shutdown()
                    return False, err
                return True, None

            ok, err = await asyncio.to_thread(_init)
            self._connected = ok
            if ok:
                logger.info(
                    f"MT5 adapter connected (login={self._login_id}, server={self.server})"
                )
            else:
                logger.error(f"MT5 connect failed: {err}")

    async def close(self) -> None:
        if not self._connected:
            return
        mt5 = _load_mt5()
        async with _MT5_LOCK:
            await asyncio.to_thread(mt5.shutdown)
        self._connected = False

    # ─── BrokerAdapter (read-only) ────────────────────────────────────

    def get_account_login(self) -> str:           return self.login
    def is_connected(self) -> bool:               return self._connected
    def get_equity(self) -> Optional[float]:      return self._last_equity
    def get_balance(self) -> Optional[float]:     return self._last_equity
    def open_position_count(self) -> int:         return self._open_positions_count

    def get_symbol_spec(self, symbol: str) -> Optional[SymbolSpec]:
        # Try to pull live spec from MT5; fall back to defaults.
        if not self._connected:
            return default_spec(symbol)
        mt5 = _load_mt5()
        try:
            info = mt5.symbol_info(symbol)
            if not info:
                return default_spec(symbol)
            return SymbolSpec(
                symbol        = info.name,
                tick_size     = float(info.point),
                tick_value    = float(info.trade_tick_value or 1.0),
                min_lot       = float(info.volume_min),
                max_lot       = float(info.volume_max),
                lot_step      = float(info.volume_step),
                contract_size = float(info.trade_contract_size or 100_000),
                digits        = int(info.digits),
            )
        except Exception:
            return default_spec(symbol)

    def get_spread_pips(self, symbol: str) -> Optional[float]:
        if not self._connected:
            return None
        mt5 = _load_mt5()
        try:
            info = mt5.symbol_info(symbol)
            if not info:
                return None
            # spread in points / pip_size_in_points → pips
            pip_pts = 10 if info.digits in (3, 5) else 1
            return float(info.spread) / pip_pts
        except Exception:
            return None

    def close_all_positions(self) -> int:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self._close_all_async())
                return 0
            return loop.run_until_complete(self._close_all_async())
        except Exception as e:
            logger.error(f"MT5 close_all_positions failed: {e}")
            return 0

    # ─── Async refresh ────────────────────────────────────────────────

    async def refresh_state(self) -> None:
        if not self._connected:
            await self.connect()
        if not self._connected:
            return
        mt5 = _load_mt5()
        async with _MT5_LOCK:
            try:
                info = await asyncio.to_thread(mt5.account_info)
                if info is not None:
                    self._last_equity = float(info.equity)
                positions = await asyncio.to_thread(mt5.positions_get)
                self._open_positions_count = len(positions or [])
            except Exception as e:
                logger.error(f"MT5 refresh_state failed: {e}")

    # ─── Execution ────────────────────────────────────────────────────

    async def submit_order(self, req: OrderRequest) -> OrderResult:
        if not self._connected:
            await self.connect()
        if not self._connected:
            raise OrderRejected("MT5 not connected")

        mt5 = _load_mt5()

        async with _MT5_LOCK:
            tick = await asyncio.to_thread(mt5.symbol_info_tick, req.symbol)
            if tick is None:
                raise OrderRejected(f"MT5: unknown symbol {req.symbol}")

            if req.order_type == OrderType.MARKET:
                # Use ask for buys, bid for sells; check slippage vs mid
                fill_price = tick.ask if req.side == OrderSide.BUY else tick.bid
                mid = (tick.ask + tick.bid) / 2 if (tick.ask and tick.bid) else fill_price
                if mid > 0:
                    spread = abs(tick.ask - tick.bid)
                    if spread / mid > req.max_slippage_pct:
                        raise SlippageExceeded(
                            f"Spread {spread/mid:.4%} > max {req.max_slippage_pct:.4%}"
                        )
            else:
                if req.price is None:
                    raise OrderRejected("LIMIT order requires price")
                fill_price = req.price

            order_type = (
                mt5.ORDER_TYPE_BUY  if req.order_type == OrderType.MARKET and req.side == OrderSide.BUY  else
                mt5.ORDER_TYPE_SELL if req.order_type == OrderType.MARKET and req.side == OrderSide.SELL else
                mt5.ORDER_TYPE_BUY_LIMIT  if req.side == OrderSide.BUY  else
                mt5.ORDER_TYPE_SELL_LIMIT
            )
            action = (
                mt5.TRADE_ACTION_DEAL if req.order_type == OrderType.MARKET
                else mt5.TRADE_ACTION_PENDING
            )

            request = {
                'action':       action,
                'symbol':       req.symbol,
                'volume':       float(req.quantity),
                'type':         order_type,
                'price':        float(fill_price),
                'deviation':    int(req.max_slippage_pct * 100_000),  # in points
                'magic':        20240501,
                'comment':      (req.client_order_id or 'algosphere')[:31],
                'type_time':    mt5.ORDER_TIME_GTC,
                'type_filling': mt5.ORDER_FILLING_IOC,
            }
            if req.stop_loss is not None:
                request['sl'] = float(req.stop_loss)
            if req.take_profit is not None:
                request['tp'] = float(req.take_profit)

            result = await asyncio.to_thread(mt5.order_send, request)

        if result is None:
            raise OrderRejected(f"MT5 order_send returned None: {mt5.last_error()}")

        if result.retcode != mt5.TRADE_RETCODE_DONE:
            raise OrderRejected(
                f"MT5 rejected (retcode={result.retcode}): {result.comment}"
            )

        avg_price = float(result.price or fill_price)
        slippage  = 0.0
        if req.order_type == OrderType.MARKET and avg_price > 0 and req.price:
            slippage = (avg_price - req.price) / req.price

        return OrderResult(
            order_id        = str(result.order),
            client_order_id = req.client_order_id,
            symbol          = req.symbol,
            side            = req.side.value,
            status          = 'FILLED',
            requested_qty   = req.quantity,
            filled_qty      = float(result.volume),
            avg_fill_price  = avg_price,
            commission      = 0.0,
            slippage_pct    = slippage,
            timestamp_ms    = int(time.time() * 1000),
            raw             = result._asdict() if hasattr(result, '_asdict') else dict(),
        )

    async def cancel_order(self, order_id: str, symbol: str) -> bool:
        if not self._connected:
            return False
        mt5 = _load_mt5()
        async with _MT5_LOCK:
            try:
                req = {
                    'action':  mt5.TRADE_ACTION_REMOVE,
                    'order':   int(order_id),
                }
                result = await asyncio.to_thread(mt5.order_send, req)
                return bool(result and result.retcode == mt5.TRADE_RETCODE_DONE)
            except Exception as e:
                logger.warning(f"MT5 cancel failed for {order_id}: {e}")
                return False

    async def get_positions(self) -> list[Position]:
        if not self._connected:
            return []
        mt5 = _load_mt5()
        async with _MT5_LOCK:
            try:
                positions = await asyncio.to_thread(mt5.positions_get) or []
                out: list[Position] = []
                for p in positions:
                    side = 'long' if p.type == mt5.POSITION_TYPE_BUY else 'short'
                    out.append(Position(
                        symbol         = p.symbol,
                        side           = side,  # type: ignore[arg-type]
                        qty            = float(p.volume),
                        avg_entry      = float(p.price_open),
                        current_price  = float(p.price_current),
                        unrealized_pnl = float(p.profit),
                        margin_used    = 0.0,   # MT5 doesn't expose per-position margin via positions_get
                        broker_pos_id  = str(p.ticket),
                    ))
                return out
            except Exception as e:
                logger.error(f"MT5 get_positions failed: {e}")
                return []

    async def _close_all_async(self) -> int:
        positions = await self.get_positions()
        closed = 0
        mt5 = _load_mt5()
        for pos in positions:
            try:
                tick = mt5.symbol_info_tick(pos.symbol)
                if tick is None:
                    continue
                close_type = (
                    mt5.ORDER_TYPE_SELL if pos.side == 'long' else mt5.ORDER_TYPE_BUY
                )
                price = tick.bid if pos.side == 'long' else tick.ask
                req = {
                    'action':       mt5.TRADE_ACTION_DEAL,
                    'position':     int(pos.broker_pos_id),
                    'symbol':       pos.symbol,
                    'volume':       float(pos.qty),
                    'type':         close_type,
                    'price':        float(price),
                    'deviation':    1000,                 # 100 pips fallback
                    'magic':        20240501,
                    'comment':      'emergency_flatten',
                    'type_filling': mt5.ORDER_FILLING_IOC,
                }
                async with _MT5_LOCK:
                    r = await asyncio.to_thread(mt5.order_send, req)
                if r and r.retcode == mt5.TRADE_RETCODE_DONE:
                    closed += 1
            except Exception as e:
                logger.error(f"MT5 emergency close of {pos.symbol} failed: {e}")
        return closed


# ─── Helper: build adapter from env ─────────────────────────────────────

def adapter_from_env() -> Optional[MT5Adapter]:
    login    = os.environ.get('MT5_LOGIN')
    password = os.environ.get('MT5_PASSWORD')
    server   = os.environ.get('MT5_SERVER')
    if not (login and password and server):
        return None
    path = os.environ.get('MT5_TERMINAL_PATH')
    testnet = os.environ.get('MT5_DEMO', 'true').lower() != 'false'
    try:
        return MT5Adapter(int(login), password, server, path=path, testnet=testnet)
    except ValueError:
        logger.error(f"MT5_LOGIN must be numeric, got: {login!r}")
        return None
