"""
Execution adapter base — extends the read-only BrokerAdapter with order routing.

Each exchange-specific adapter subclasses ExecutionAdapter and implements
submit_order() + close_position(). Read-only methods inherit from BrokerAdapter.
"""
from __future__ import annotations
from abc import abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Literal

from risk.broker_adapter import BrokerAdapter


class OrderType(str, Enum):
    MARKET = 'market'
    LIMIT  = 'limit'


class OrderSide(str, Enum):
    BUY  = 'buy'
    SELL = 'sell'


@dataclass
class OrderRequest:
    symbol:           str
    side:             OrderSide
    order_type:       OrderType
    quantity:         float                            # base units (e.g. 0.01 BTC)
    price:            Optional[float]   = None         # required for LIMIT
    stop_loss:        Optional[float]   = None
    take_profit:      Optional[float]   = None
    client_order_id:  Optional[str]     = None
    max_slippage_pct: float             = 0.001        # 0.1% default
    reduce_only:      bool              = False
    metadata:         dict              = field(default_factory=dict)


@dataclass
class OrderResult:
    order_id:        str
    client_order_id: Optional[str]
    symbol:          str
    side:            str
    status:          str
    # NEW | PARTIALLY_FILLED | FILLED | REJECTED | CANCELLED
    requested_qty:   float
    filled_qty:      float
    avg_fill_price:  float
    commission:      float
    slippage_pct:    float
    timestamp_ms:    int
    raw:             dict


@dataclass
class Position:
    symbol:         str
    side:           Literal['long', 'short']
    qty:            float
    avg_entry:      float
    current_price:  float
    unrealized_pnl: float
    margin_used:    float
    broker_pos_id:  str


class OrderRejected(RuntimeError):
    """Raised when the exchange rejects an order outright."""


class SlippageExceeded(RuntimeError):
    """Raised pre-fill when expected slippage exceeds OrderRequest.max_slippage_pct."""


class ExecutionAdapter(BrokerAdapter):
    """
    Extends BrokerAdapter with order submission. Read-only methods (equity,
    spread, positions) are inherited.
    """

    @abstractmethod
    async def submit_order(self, req: OrderRequest) -> OrderResult: ...

    @abstractmethod
    async def cancel_order(self, order_id: str, symbol: str) -> bool: ...

    @abstractmethod
    async def get_positions(self) -> list[Position]: ...
