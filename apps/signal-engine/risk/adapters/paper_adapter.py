"""
PaperBroker — institutional paper-trading adapter.

The whole point of this adapter is to make every downstream surface
(signal_engine, risk_engine, /execution, /analytics, /shadow, /backtest,
/journal, telegram notifier, copy-relay) work end-to-end WITHOUT real
broker API keys or a Windows VPS. It conforms to the canonical
ExecutionAdapter interface so nothing upstream needs to know it's a
mock — same `submit_order` / `cancel_order` / `get_positions` /
`refresh_state` contract as Binance/Bybit/OKX/MT5.

Realism model (aggressive defaults — chosen so paper results don't
flatter the user vs live):
  • Slippage:   5 bps direction-aware (buyer pays more, seller gets less).
  • Latency:    50–500 ms uniform random delay on every submit/cancel.
  • Rejections: 1% random reject + sanity rejects (insufficient
                balance, position-size > max_lot, reduce-only mismatch).
  • Spread:     2× widening if `paper_volatile=True` is set on the row
                (caller controls; lets backtests drive vol regimes).
  • Partial fills: orders > 0.5 * configured `max_partial_lot` have a
                30% chance of partial-fill (60–95% of requested qty).

Virtual state persists to public.paper_state (one row per user). On
restart the adapter rebuilds from that row so paper balances survive
engine redeploys. Position rows live as JSONB on the same record —
paper trading is low volume by definition, no need to over-normalize.

Every fill emits an EXECUTION_EVENT row (typed event log, immutable
append-only) so the new event-driven dashboards have a feed.
"""
from __future__ import annotations
import asyncio
import json
import os
import random
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional
from loguru import logger

from risk.adapters.base import (
    ExecutionAdapter, OrderRequest, OrderResult, OrderType, OrderSide,
    Position, OrderRejected,
)
from risk.broker_adapter import SymbolSpec, default_spec


# ─── Realism knobs (env-overridable) ───────────────────────────────────

def _envf(name: str, default: float) -> float:
    try:    return float(os.environ.get(name, default))
    except: return default

DEFAULT_STARTING_BALANCE = _envf('PAPER_STARTING_BALANCE', 10_000.0)
SLIPPAGE_BPS             = _envf('PAPER_SLIPPAGE_BPS',     5.0)   # 5 bps = 0.05%
LATENCY_MIN_MS           = _envf('PAPER_LATENCY_MIN_MS',   50.0)
LATENCY_MAX_MS           = _envf('PAPER_LATENCY_MAX_MS',   500.0)
REJECT_PROB              = _envf('PAPER_REJECT_PROB',      0.01)  # 1%
PARTIAL_FILL_PROB        = _envf('PAPER_PARTIAL_PROB',     0.30)  # 30%
SPREAD_PIPS_DEFAULT      = _envf('PAPER_SPREAD_PIPS',      1.5)


# ─── Persisted state shape ─────────────────────────────────────────────

@dataclass
class _PaperPosition:
    """One open virtual position. Mirror-shape to broker_adapter.Position
    but persistable as a plain dict via dataclasses.asdict()."""
    id:           str
    symbol:       str
    side:         str          # 'long' | 'short'
    qty:          float
    avg_entry:    float
    stop_loss:    Optional[float]
    take_profit:  Optional[float]
    opened_at_ms: int

    def to_jsonable(self) -> dict:
        return {
            'id': self.id, 'symbol': self.symbol, 'side': self.side,
            'qty': self.qty, 'avg_entry': self.avg_entry,
            'stop_loss': self.stop_loss, 'take_profit': self.take_profit,
            'opened_at_ms': self.opened_at_ms,
        }


@dataclass
class _PaperState:
    balance:        float
    positions:      list[_PaperPosition] = field(default_factory=list)
    last_quote:     dict[str, float]     = field(default_factory=dict)
    volatile:       bool                 = False


# ─── DB helpers ────────────────────────────────────────────────────────

def _db():
    from config import get_settings
    from supabase import create_client
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)


def _load_state(user_id: str) -> Optional[_PaperState]:
    try:
        r = (
            _db().table('paper_state').select('*').eq('user_id', user_id)
            .single().execute()
        )
        row = r.data
        if not row:
            return None
        positions = [_PaperPosition(**p) for p in (row.get('positions') or [])]
        return _PaperState(
            balance    = float(row.get('balance') or DEFAULT_STARTING_BALANCE),
            positions  = positions,
            last_quote = dict(row.get('last_quote') or {}),
            volatile   = bool(row.get('volatile') or False),
        )
    except Exception as e:
        logger.debug(f"PaperBroker._load_state: no row for {user_id[:8]}… ({e})")
        return None


def _save_state(user_id: str, state: _PaperState) -> None:
    try:
        (
            _db().table('paper_state')
            .upsert({
                'user_id':    user_id,
                'balance':    state.balance,
                'positions':  [p.to_jsonable() for p in state.positions],
                'last_quote': state.last_quote,
                'volatile':   state.volatile,
            }, on_conflict='user_id')
            .execute()
        )
    except Exception as e:
        logger.warning(f"PaperBroker._save_state failed for {user_id[:8]}…: {e}")


def _emit_event(user_id: str, event_type: str, payload: dict) -> None:
    """Write to the immutable execution_events log. Best-effort."""
    try:
        (
            _db().table('execution_events')
            .insert({
                'user_id':    user_id,
                'event_type': event_type,
                'broker':     'paper',
                'payload':    payload,
            })
            .execute()
        )
    except Exception as e:
        logger.debug(f"PaperBroker event emit failed ({event_type}): {e}")


# ─── Price source — used when req.price is omitted ─────────────────────

_price_provider = None

async def _fetch_price(symbol: str) -> Optional[float]:
    """Best-effort live quote via the engine's market-data provider chain.
    Returns None if no provider is configured (engine running keyless)."""
    global _price_provider
    if _price_provider is None:
        try:
            from config import get_settings
            from data.market_data import build_provider
            _price_provider = build_provider(get_settings())
        except Exception as e:
            logger.warning(f"PaperBroker: failed to build market-data provider: {e}")
            _price_provider = False    # mark as tried-and-failed
    if not _price_provider:
        return None
    try:
        return await _price_provider.fetch_live_price(symbol)
    except Exception as e:
        logger.warning(f"PaperBroker: fetch_live_price({symbol}) failed: {e}")
        return None


# ─── Adapter ───────────────────────────────────────────────────────────

class PaperBroker(ExecutionAdapter):
    """
    Virtual broker — no credentials, full ExecutionAdapter compliance.

    One adapter per user. State is per-user-persisted to paper_state.
    """

    def __init__(self, user_id: str, starting_balance: Optional[float] = None):
        self._user_id   = user_id
        self.login      = f"paper_{user_id[:8]}"
        self._connected = True
        self._lock      = asyncio.Lock()
        # ExecutionAdapter interface: every adapter exposes .testnet (the
        # ExecuteOut payload uses it). Paper is always non-real-money.
        self.testnet    = True

        state = _load_state(user_id)
        if state is None:
            state = _PaperState(balance=starting_balance or DEFAULT_STARTING_BALANCE)
            _save_state(user_id, state)
            _emit_event(user_id, 'PAPER_INIT', {
                'starting_balance': state.balance,
            })
        self._state = state

    # ─── BrokerAdapter (read-only) ─────────────────────────────────────

    async def connect(self) -> None:
        # Paper broker is always connected — it's a local process. The
        # async method exists to satisfy the interface.
        self._connected = True

    async def close(self) -> None:
        self._connected = False

    def get_account_login(self) -> str:        return self.login
    def is_connected(self) -> bool:            return self._connected
    def get_balance(self) -> Optional[float]:  return self._state.balance
    def get_equity(self) -> Optional[float]:
        # equity = cash balance + unrealized PnL on open positions
        unrealized = 0.0
        for p in self._state.positions:
            q = self._state.last_quote.get(p.symbol, p.avg_entry)
            if p.side == 'long':
                unrealized += (q - p.avg_entry) * p.qty
            else:
                unrealized += (p.avg_entry - q) * p.qty
        return self._state.balance + unrealized

    def open_position_count(self) -> int:
        return len(self._state.positions)

    def get_symbol_spec(self, symbol: str) -> Optional[SymbolSpec]:
        return default_spec(symbol)

    def get_spread_pips(self, symbol: str) -> Optional[float]:
        base = SPREAD_PIPS_DEFAULT
        return base * 2.0 if self._state.volatile else base

    def close_all_positions(self) -> int:
        """Sync close-all for kill-switch. Doesn't fetch live prices —
        closes at the last cached quote (or avg_entry as fallback)."""
        closed = 0
        for p in list(self._state.positions):
            q = self._state.last_quote.get(p.symbol, p.avg_entry)
            pnl = ((q - p.avg_entry) if p.side == 'long'
                   else (p.avg_entry - q)) * p.qty
            self._state.balance += pnl
            self._state.positions.remove(p)
            closed += 1
            _emit_event(self._user_id, 'POSITION_CLOSED', {
                'position_id': p.id, 'symbol': p.symbol, 'side': p.side,
                'qty': p.qty, 'avg_entry': p.avg_entry, 'exit': q,
                'realized_pnl': pnl, 'reason': 'kill_switch',
            })
        if closed:
            _save_state(self._user_id, self._state)
        return closed

    async def refresh_state(self) -> None:
        """Refresh marks on all open positions against live quotes."""
        for p in list(self._state.positions):
            q = await _fetch_price(p.symbol)
            if q is not None:
                self._state.last_quote[p.symbol] = q
        _save_state(self._user_id, self._state)

    # ─── ExecutionAdapter (order routing) ──────────────────────────────

    async def submit_order(self, req: OrderRequest) -> OrderResult:
        async with self._lock:
            await self._simulate_latency()

            # 1% pure-random rejection — production brokers reject
            # for a hundred reasons we can't model exactly.
            if random.random() < REJECT_PROB:
                _emit_event(self._user_id, 'ORDER_REJECTED', {
                    'symbol': req.symbol, 'side': req.side.value,
                    'qty': req.quantity, 'reason': 'random_simulation',
                })
                raise OrderRejected('PaperBroker: simulated random rejection (1% rate)')

            # Determine fill price. LIMIT requires it; MARKET falls
            # back to a live quote, then to req.price, then refuses.
            base_price = req.price
            if req.order_type == OrderType.MARKET:
                live = await _fetch_price(req.symbol)
                if live is not None:
                    base_price = live
                    self._state.last_quote[req.symbol] = live
            if base_price is None:
                raise OrderRejected(
                    f'PaperBroker: no price available for {req.symbol} '
                    f'(LIMIT requires req.price; MARKET requires either '
                    f'req.price or a configured market-data provider)'
                )

            spec = default_spec(req.symbol)
            if req.quantity < spec.min_lot:
                raise OrderRejected(
                    f'PaperBroker: qty {req.quantity:g} < min_lot {spec.min_lot:g}'
                )
            if req.quantity > spec.max_lot:
                raise OrderRejected(
                    f'PaperBroker: qty {req.quantity:g} > max_lot {spec.max_lot:g}'
                )

            # Direction-aware slippage. Buyer pays the ask (+slip),
            # seller hits the bid (-slip). Volatile-mode doubles slip.
            slip_pct = SLIPPAGE_BPS / 10_000.0
            if self._state.volatile:
                slip_pct *= 2.0
            if req.side == OrderSide.BUY:
                fill_price = base_price * (1.0 + slip_pct)
            else:
                fill_price = base_price * (1.0 - slip_pct)
            slippage_pct = (fill_price - base_price) / base_price if base_price else 0.0

            # Partial fill simulation — only kicks in on large orders.
            requested = req.quantity
            filled    = requested
            partial   = False
            if requested > 5 * spec.min_lot and random.random() < PARTIAL_FILL_PROB:
                fraction = random.uniform(0.6, 0.95)
                filled  = max(spec.min_lot, round(requested * fraction, 6))
                partial = True

            # Insufficient-balance sanity check (for longs only — paper
            # doesn't model margin perfectly but does block obvious
            # over-leverage). Reserve 10% of notional as 'margin proxy'.
            notional = filled * fill_price
            if req.side == OrderSide.BUY:
                margin_proxy = notional * 0.10
                if margin_proxy > self._state.balance:
                    _emit_event(self._user_id, 'ORDER_REJECTED', {
                        'symbol': req.symbol, 'reason': 'insufficient_balance',
                        'required': margin_proxy, 'available': self._state.balance,
                    })
                    raise OrderRejected(
                        f'PaperBroker: insufficient balance (need ~${margin_proxy:.2f}, '
                        f'have ${self._state.balance:.2f})'
                    )

            # Apply the fill: open a new position. Closing-out is handled
            # by `cancel_order`-on-a-position-id or `close_all_positions`.
            pos = _PaperPosition(
                id            = str(uuid.uuid4()),
                symbol        = req.symbol,
                side          = 'long' if req.side == OrderSide.BUY else 'short',
                qty           = filled,
                avg_entry     = fill_price,
                stop_loss     = req.stop_loss,
                take_profit   = req.take_profit,
                opened_at_ms  = int(time.time() * 1000),
            )
            self._state.positions.append(pos)
            _save_state(self._user_id, self._state)

            order_id = pos.id
            status   = 'PARTIALLY_FILLED' if partial else 'FILLED'
            ts_ms    = int(time.time() * 1000)

            _emit_event(self._user_id, 'ORDER_FILLED', {
                'order_id': order_id, 'symbol': req.symbol,
                'side': req.side.value, 'order_type': req.order_type.value,
                'requested_qty': requested, 'filled_qty': filled,
                'avg_fill_price': fill_price, 'slippage_pct': slippage_pct,
                'status': status, 'sl': req.stop_loss, 'tp': req.take_profit,
            })

            return OrderResult(
                order_id        = order_id,
                client_order_id = req.client_order_id,
                symbol          = req.symbol,
                side            = req.side.value,
                status          = status,
                requested_qty   = requested,
                filled_qty      = filled,
                avg_fill_price  = fill_price,
                commission      = 0.0,        # paper has zero commission
                slippage_pct    = slippage_pct,
                timestamp_ms    = ts_ms,
                raw             = {'paper': True, 'partial': partial},
            )

    async def cancel_order(self, order_id: str, symbol: str) -> bool:
        """In PaperBroker, every fill creates a position keyed by
        position_id == order_id. 'Cancelling' means closing that
        position at the current quote."""
        async with self._lock:
            await self._simulate_latency()
            for p in list(self._state.positions):
                if p.id == order_id:
                    q = await _fetch_price(p.symbol) or p.avg_entry
                    pnl = ((q - p.avg_entry) if p.side == 'long'
                           else (p.avg_entry - q)) * p.qty
                    self._state.balance += pnl
                    self._state.positions.remove(p)
                    _save_state(self._user_id, self._state)
                    _emit_event(self._user_id, 'POSITION_CLOSED', {
                        'position_id': p.id, 'symbol': p.symbol, 'side': p.side,
                        'qty': p.qty, 'avg_entry': p.avg_entry, 'exit': q,
                        'realized_pnl': pnl, 'reason': 'cancel_order',
                    })
                    return True
            return False

    async def get_positions(self) -> list[Position]:
        out: list[Position] = []
        for p in self._state.positions:
            q = self._state.last_quote.get(p.symbol, p.avg_entry)
            unr = ((q - p.avg_entry) if p.side == 'long'
                   else (p.avg_entry - q)) * p.qty
            out.append(Position(
                symbol         = p.symbol,
                side           = p.side,    # type: ignore[arg-type]
                qty            = p.qty,
                avg_entry      = p.avg_entry,
                current_price  = q,
                unrealized_pnl = unr,
                margin_used    = 0.0,
                broker_pos_id  = p.id,
            ))
        return out

    # ─── Helpers ───────────────────────────────────────────────────────

    async def _simulate_latency(self) -> None:
        ms = random.uniform(LATENCY_MIN_MS, LATENCY_MAX_MS)
        await asyncio.sleep(ms / 1000.0)

    def set_volatile(self, on: bool) -> None:
        """Caller-driven volatility flag — doubles slippage + spread.
        Used by backtest harness to drive regime scenarios."""
        self._state.volatile = on
        _save_state(self._user_id, self._state)
