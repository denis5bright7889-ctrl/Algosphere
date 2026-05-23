"""
execution_engine.py — Phase 4: broker execution abstraction layer.

Defines the ExecutionEngine protocol so the strategy layer can swap
between MT5 and a direct broker REST API without rewriting any logic.

Current implementations
-----------------------
  MT5ExecutionEngine      — wraps the existing MetaTrader5 package.
                            This is the active engine; behaviour is
                            identical to the bridge.py /order flow.

  BrokerAPIExecutionEngine — stub for a future HTTP-based broker API
                             (e.g. OANDA v20, FXCM, cTrader Open API).
                             Raises NotImplementedError on every call
                             until implemented.

Usage (bridge.py or a future caller)
--------------------------------------
  from execution_engine import get_engine, EngineConfig

  engine = get_engine('mt5')          # or 'broker_api'
  result = await engine.submit_order(...)

Adding a new engine
-------------------
  1. Subclass ExecutionEngine and implement all abstract methods.
  2. Register the key in _ENGINE_REGISTRY at the bottom of this file.
  3. No changes to bridge.py or the strategy layer required.
"""
from __future__ import annotations

import asyncio
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional


# ── Value types ────────────────────────────────────────────────────────

@dataclass
class EngineConfig:
    """Credentials + server info passed to an engine at construction."""
    login:    int
    password: str
    server:   str
    magic:    int = 20240501


@dataclass
class OrderResult:
    order_id:       str
    status:         str            # 'FILLED' | 'PENDING' | 'REJECTED'
    requested_qty:  float
    filled_qty:     float
    avg_fill_price: float
    slippage_pct:   float
    commission:     float
    timestamp_ms:   int
    raw:            Any = None


@dataclass
class Position:
    symbol:         str
    side:           str            # 'long' | 'short'
    qty:            float
    avg_entry:      float
    current_price:  float
    unrealized_pnl: float
    broker_pos_id:  str


@dataclass
class AccountInfo:
    login:           int
    name:            str
    server:          str
    currency:        str
    balance:         float
    equity:          float
    leverage:        int
    is_trade_allowed: bool


# ── Abstract interface ─────────────────────────────────────────────────

class ExecutionEngine(ABC):
    """Broker-agnostic execution interface.

    All methods are async. Implementations must never crash the process:
    raise ValueError / RuntimeError for business-logic errors, let the
    caller handle them."""

    @abstractmethod
    async def connect(self, config: EngineConfig) -> bool:
        """Initialize the connection to the broker. Returns True on success."""
        ...

    @abstractmethod
    async def is_connected(self) -> bool:
        """True if the broker connection is alive and tradeable."""
        ...

    @abstractmethod
    async def submit_order(
        self,
        config:     EngineConfig,
        symbol:     str,
        side:       str,            # 'buy' | 'sell'
        order_type: str,            # 'market' | 'limit'
        quantity:   float,
        price:      Optional[float] = None,
        stop_loss:  Optional[float] = None,
        take_profit: Optional[float] = None,
        client_order_id: Optional[str] = None,
        max_slippage_pct: float = 0.001,
    ) -> OrderResult:
        ...

    @abstractmethod
    async def cancel_order(self, config: EngineConfig, order_id: int) -> bool:
        ...

    @abstractmethod
    async def get_positions(self, config: EngineConfig) -> list[Position]:
        ...

    @abstractmethod
    async def get_account(self, config: EngineConfig) -> AccountInfo:
        ...

    @abstractmethod
    async def close_all(self, config: EngineConfig) -> int:
        """Emergency flatten. Returns number of positions closed."""
        ...

    @abstractmethod
    async def shutdown(self) -> None:
        """Clean up resources. Called once on process exit."""
        ...


# ── MT5 implementation ─────────────────────────────────────────────────

class MT5ExecutionEngine(ExecutionEngine):
    """Thin wrapper around the MetaTrader5 Python package.

    Delegates to the same _ensure_login / mt5.order_send flow used by
    bridge.py's /order endpoint, ensuring a single MT5 instance shared
    across all calls via the module-level _MT5_LOCK in bridge.py."""

    async def connect(self, config: EngineConfig) -> bool:
        try:
            import MetaTrader5 as mt5  # type: ignore
            if not mt5.initialize(timeout=15_000):
                return False
            if not mt5.login(config.login, password=config.password, server=config.server):
                return False
            return True
        except Exception:
            return False

    async def is_connected(self) -> bool:
        try:
            import MetaTrader5 as mt5  # type: ignore
            info = await asyncio.to_thread(mt5.terminal_info)
            return info is not None and bool(info.connected)
        except Exception:
            return False

    async def submit_order(
        self,
        config:     EngineConfig,
        symbol:     str,
        side:       str,
        order_type: str,
        quantity:   float,
        price:      Optional[float] = None,
        stop_loss:  Optional[float] = None,
        take_profit: Optional[float] = None,
        client_order_id: Optional[str] = None,
        max_slippage_pct: float = 0.001,
    ) -> OrderResult:
        import MetaTrader5 as mt5  # type: ignore

        def _do():
            if not mt5.initialize(timeout=10_000):
                raise RuntimeError(f'initialize failed: {mt5.last_error()}')
            if not mt5.login(config.login, password=config.password, server=config.server):
                raise RuntimeError(f'login failed: {mt5.last_error()}')

            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                raise ValueError(f'unknown symbol: {symbol}')

            s = side.lower()
            ot = order_type.lower()
            if ot == 'market':
                fill_price = tick.ask if s == 'buy' else tick.bid
                mt5_type   = mt5.ORDER_TYPE_BUY if s == 'buy' else mt5.ORDER_TYPE_SELL
                action     = mt5.TRADE_ACTION_DEAL
            else:
                if price is None:
                    raise ValueError('limit order requires price')
                fill_price = price
                mt5_type   = mt5.ORDER_TYPE_BUY_LIMIT if s == 'buy' else mt5.ORDER_TYPE_SELL_LIMIT
                action     = mt5.TRADE_ACTION_PENDING

            req: dict[str, Any] = {
                'action':       action,
                'symbol':       symbol,
                'volume':       float(quantity),
                'type':         mt5_type,
                'price':        float(fill_price),
                'deviation':    int(max_slippage_pct * 100_000),
                'magic':        config.magic,
                'comment':      (client_order_id or 'algosphere')[:31],
                'type_time':    mt5.ORDER_TIME_GTC,
                'type_filling': mt5.ORDER_FILLING_IOC,
            }
            if stop_loss   is not None: req['sl'] = float(stop_loss)
            if take_profit is not None: req['tp'] = float(take_profit)

            result = mt5.order_send(req)
            if result is None:
                raise RuntimeError(f'order_send returned None: {mt5.last_error()}')
            if result.retcode != mt5.TRADE_RETCODE_DONE:
                raise RuntimeError(
                    f'broker rejected (retcode={result.retcode}): {result.comment}'
                )
            avg = float(result.price or fill_price)
            slip = (avg - price) / price if (ot == 'market' and price) else 0.0
            return OrderResult(
                order_id=str(result.order),
                status='FILLED',
                requested_qty=quantity,
                filled_qty=float(result.volume),
                avg_fill_price=avg,
                slippage_pct=slip,
                commission=0.0,
                timestamp_ms=int(time.time() * 1000),
                raw=result._asdict() if hasattr(result, '_asdict') else {},
            )

        return await asyncio.to_thread(_do)

    async def cancel_order(self, config: EngineConfig, order_id: int) -> bool:
        import MetaTrader5 as mt5  # type: ignore

        def _do():
            mt5.initialize(timeout=10_000)
            mt5.login(config.login, password=config.password, server=config.server)
            r = mt5.order_send({'action': mt5.TRADE_ACTION_REMOVE, 'order': order_id})
            return bool(r and r.retcode == mt5.TRADE_RETCODE_DONE)

        return await asyncio.to_thread(_do)

    async def get_positions(self, config: EngineConfig) -> list[Position]:
        import MetaTrader5 as mt5  # type: ignore

        def _do():
            mt5.initialize(timeout=10_000)
            mt5.login(config.login, password=config.password, server=config.server)
            rows = mt5.positions_get() or []
            return [
                Position(
                    symbol=p.symbol,
                    side='long' if p.type == mt5.POSITION_TYPE_BUY else 'short',
                    qty=float(p.volume),
                    avg_entry=float(p.price_open),
                    current_price=float(p.price_current),
                    unrealized_pnl=float(p.profit),
                    broker_pos_id=str(p.ticket),
                )
                for p in rows
            ]

        return await asyncio.to_thread(_do)

    async def get_account(self, config: EngineConfig) -> AccountInfo:
        import MetaTrader5 as mt5  # type: ignore

        def _do():
            mt5.initialize(timeout=10_000)
            mt5.login(config.login, password=config.password, server=config.server)
            info = mt5.account_info()
            if info is None:
                raise RuntimeError('account_info returned None')
            return AccountInfo(
                login=int(info.login),
                name=info.name,
                server=info.server,
                currency=info.currency,
                balance=float(info.balance),
                equity=float(info.equity),
                leverage=int(info.leverage),
                is_trade_allowed=bool(info.trade_allowed),
            )

        return await asyncio.to_thread(_do)

    async def close_all(self, config: EngineConfig) -> int:
        import MetaTrader5 as mt5  # type: ignore

        def _do():
            mt5.initialize(timeout=10_000)
            mt5.login(config.login, password=config.password, server=config.server)
            rows = mt5.positions_get() or []
            closed = 0
            for p in rows:
                tick = mt5.symbol_info_tick(p.symbol)
                if tick is None:
                    continue
                close_type = (
                    mt5.ORDER_TYPE_SELL if p.type == mt5.POSITION_TYPE_BUY
                    else mt5.ORDER_TYPE_BUY
                )
                price = tick.bid if p.type == mt5.POSITION_TYPE_BUY else tick.ask
                req = {
                    'action':       mt5.TRADE_ACTION_DEAL,
                    'position':     int(p.ticket),
                    'symbol':       p.symbol,
                    'volume':       float(p.volume),
                    'type':         close_type,
                    'price':        float(price),
                    'deviation':    1000,
                    'magic':        config.magic,
                    'comment':      'emergency_flatten',
                    'type_filling': mt5.ORDER_FILLING_IOC,
                }
                r = mt5.order_send(req)
                if r and r.retcode == mt5.TRADE_RETCODE_DONE:
                    closed += 1
            return closed

        return await asyncio.to_thread(_do)

    async def shutdown(self) -> None:
        try:
            import MetaTrader5 as mt5  # type: ignore
            mt5.shutdown()
        except Exception:
            pass


# ── Broker REST API stub (Phase 4 future) ─────────────────────────────

class BrokerAPIExecutionEngine(ExecutionEngine):
    """Future: direct broker REST API (e.g. OANDA v20, cTrader Open API).

    Implement _post() and the abstract methods below to swap out MT5
    without touching the strategy layer. All methods raise
    NotImplementedError until implemented."""

    def __init__(self, base_url: str, api_key: str) -> None:
        self._base_url = base_url.rstrip('/')
        self._api_key  = api_key

    async def _post(self, path: str, payload: dict) -> dict:
        raise NotImplementedError('BrokerAPIExecutionEngine not yet implemented')

    async def connect(self, config: EngineConfig) -> bool:
        raise NotImplementedError

    async def is_connected(self) -> bool:
        raise NotImplementedError

    async def submit_order(self, config, symbol, side, order_type, quantity,
                           price=None, stop_loss=None, take_profit=None,
                           client_order_id=None, max_slippage_pct=0.001) -> OrderResult:
        raise NotImplementedError

    async def cancel_order(self, config: EngineConfig, order_id: int) -> bool:
        raise NotImplementedError

    async def get_positions(self, config: EngineConfig) -> list[Position]:
        raise NotImplementedError

    async def get_account(self, config: EngineConfig) -> AccountInfo:
        raise NotImplementedError

    async def close_all(self, config: EngineConfig) -> int:
        raise NotImplementedError

    async def shutdown(self) -> None:
        pass


# ── Registry ───────────────────────────────────────────────────────────

_ENGINE_REGISTRY: dict[str, type[ExecutionEngine]] = {
    'mt5':        MT5ExecutionEngine,
    'broker_api': BrokerAPIExecutionEngine,
}


def get_engine(name: str = 'mt5', **kwargs) -> ExecutionEngine:
    """Factory. name must be a key in _ENGINE_REGISTRY."""
    cls = _ENGINE_REGISTRY.get(name)
    if cls is None:
        raise ValueError(
            f'Unknown execution engine {name!r}. '
            f'Available: {list(_ENGINE_REGISTRY)}'
        )
    return cls(**kwargs)
