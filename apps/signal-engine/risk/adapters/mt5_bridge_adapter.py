"""
MT5BridgeAdapter — engine-side HTTP client for the Windows MT5 bridge.

When the engine runs on Linux (Railway), it cannot import the
Windows-only MetaTrader5 package. Instead, it routes all MT5 calls
to a small FastAPI service (apps/mt5-bridge/bridge.py) running on a
Windows VPS that drives the local MT5 terminal.

This adapter is wire-compatible with the local MT5Adapter — both
implement the same ExecutionAdapter interface — so the factory just
picks based on whether MT5_BRIDGE_URL is set:

  • MT5_BRIDGE_URL set       → MT5BridgeAdapter (this file, HTTP)
  • MT5_BRIDGE_URL unset     → MT5Adapter (local import) if on Windows,
                                otherwise DISABLED via broker_state.

Credentials flow per request: the engine holds the user's MT5
login/password/server (decrypted from broker_connections in the
factory) and includes them in each bridge call body. The bridge
re-logs the terminal as needed. Passwords travel over HTTPS only —
the README enforces a Cloudflare-Tunnel or equivalent TLS setup.
"""
from __future__ import annotations
import asyncio
import os
import time
from typing import Optional
import httpx
from loguru import logger

from risk.adapters.base import (
    ExecutionAdapter, OrderRequest, OrderResult, OrderType, OrderSide,
    Position, OrderRejected,
)
from risk.broker_adapter import SymbolSpec, default_spec


TIMEOUT_S = 20.0


def _bridge_url() -> Optional[str]:
    raw = os.environ.get('MT5_BRIDGE_URL', '').strip()
    if not raw:
        return None
    return raw.rstrip('/')


def _bridge_key() -> str:
    return os.environ.get('MT5_BRIDGE_API_KEY', '')


class MT5BridgeError(RuntimeError):
    """Raised when the bridge returns a non-2xx response or is
    unreachable. Caught upstream as a generic failed handshake."""


class MT5BridgeAdapter(ExecutionAdapter):
    """
    Async HTTP client implementing the full ExecutionAdapter contract
    against the remote bridge. State (equity, positions) is cached
    after refresh_state() so the sync read methods can return without
    re-fetching.
    """

    def __init__(self, login: int, password: str, server: str,
                 testnet: bool = True,
                 owner_user_id: Optional[str] = None):
        self._login_id  = int(login)
        self.password   = password
        self.server     = server
        self.testnet    = testnet
        self.login      = f"mt5_{login}"
        self._connected = False
        self._equity:    Optional[float] = None
        self._balance:   Optional[float] = None
        self._open_n:    int = 0
        # Cache symbol specs / spreads to avoid round-tripping every
        # risk-engine check.
        self._spec_cache:   dict[str, SymbolSpec] = {}
        self._spread_cache: dict[str, float] = {}
        # Required for the execution_events emit (journal auto-detect
        # trigger needs user_id). Factory wires this in for live deploys.
        self.owner_user_id = owner_user_id

    # ─── Lifecycle ────────────────────────────────────────────────────

    async def connect(self) -> None:
        url = _bridge_url()
        if not url:
            raise MT5BridgeError('MT5_BRIDGE_URL not configured on engine')
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.post(
                    f'{url}/connect',
                    headers={'X-Bridge-Key': _bridge_key()},
                    json={
                        'login':    self._login_id,
                        'password': self.password,
                        'server':   self.server,
                    },
                )
            if r.status_code >= 400:
                self._connected = False
                raise MT5BridgeError(f'bridge /connect {r.status_code}: {r.text[:200]}')
            data = r.json()
            self._connected = bool(data.get('connected'))
            self._equity    = data.get('equity')
            self._balance   = data.get('balance')
            logger.info(
                f"MT5BridgeAdapter: connected via {url} "
                f"(login={self._login_id}, equity={self._equity})"
            )
        except httpx.HTTPError as e:
            self._connected = False
            raise MT5BridgeError(f'bridge unreachable: {e}') from e

    async def close(self) -> None:
        # No persistent session to tear down on the engine side; the
        # bridge holds the MT5 terminal handle.
        self._connected = False

    # ─── BrokerAdapter (read-only) ────────────────────────────────────

    def get_account_login(self) -> str:           return self.login
    def is_connected(self) -> bool:               return self._connected
    def get_equity(self) -> Optional[float]:      return self._equity
    def get_balance(self) -> Optional[float]:     return self._balance
    def open_position_count(self) -> int:         return self._open_n

    def get_symbol_spec(self, symbol: str) -> Optional[SymbolSpec]:
        cached = self._spec_cache.get(symbol)
        if cached is not None:
            return cached
        return default_spec(symbol)

    def get_spread_pips(self, symbol: str) -> Optional[float]:
        return self._spread_cache.get(symbol)

    def close_all_positions(self) -> int:
        """Sync flatten — called by the kill switch. Fires async work
        on the running loop and returns 0 immediately (the bridge
        confirms via the next refresh)."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self._close_all_async())
                return 0
            return loop.run_until_complete(self._close_all_async())
        except Exception as e:
            logger.error(f'MT5BridgeAdapter close_all failed: {e}')
            return 0

    async def _close_all_async(self) -> int:
        url = _bridge_url()
        if not url: return 0
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.post(
                    f'{url}/close_all',
                    headers={'X-Bridge-Key': _bridge_key()},
                    json={
                        'login': self._login_id, 'password': self.password, 'server': self.server,
                    },
                )
            if r.status_code >= 400:
                logger.error(f'bridge /close_all {r.status_code}: {r.text[:200]}')
                return 0
            return int(r.json().get('closed_count', 0))
        except Exception as e:
            logger.error(f'bridge /close_all failed: {e}')
            return 0

    async def refresh_state(self) -> None:
        url = _bridge_url()
        if not url:
            self._connected = False
            return
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.post(
                    f'{url}/account',
                    headers={'X-Bridge-Key': _bridge_key()},
                    json={
                        'login': self._login_id, 'password': self.password, 'server': self.server,
                    },
                )
            if r.status_code >= 400:
                self._connected = False
                logger.warning(f'bridge /account {r.status_code}: {r.text[:200]}')
                return
            data = r.json()
            self._equity  = data.get('equity')
            self._balance = data.get('balance')
            self._open_n  = int(data.get('open_position_count') or 0)
            self._connected = True
        except Exception as e:
            self._connected = False
            logger.warning(f'bridge /account failed: {e}')

    # ─── ExecutionAdapter (order routing) ─────────────────────────────

    async def submit_order(self, req: OrderRequest) -> OrderResult:
        # Local import — avoid circular at module load.
        from risk.adapters.execution_event_emit import emit_execution_event

        def _reject(reason: str, **extra) -> None:
            """Persist ORDER_REJECTED to execution_events before raising
            so the journal + diagnostics see the broker rejection. The
            journal trigger ignores ORDER_REJECTED (won't create a row)
            but the system_event_log mirror captures it."""
            if self.owner_user_id:
                emit_execution_event(
                    user_id=self.owner_user_id, broker='mt5',
                    event_type='ORDER_REJECTED',
                    payload={'symbol': req.symbol, 'side': req.side.value,
                             'reason': reason, **extra},
                )

        url = _bridge_url()
        if not url:
            _reject('MT5_BRIDGE_URL not configured')
            raise OrderRejected('MT5_BRIDGE_URL not configured')

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.post(
                    f'{url}/order',
                    headers={'X-Bridge-Key': _bridge_key()},
                    json={
                        'login':            self._login_id,
                        'password':         self.password,
                        'server':           self.server,
                        'symbol':           req.symbol,
                        'side':             req.side.value,
                        'order_type':       req.order_type.value,
                        'quantity':         req.quantity,
                        'price':            req.price,
                        'stop_loss':        req.stop_loss,
                        'take_profit':      req.take_profit,
                        'client_order_id':  req.client_order_id,
                        'max_slippage_pct': req.max_slippage_pct,
                    },
                )
        except httpx.HTTPError as e:
            _reject('bridge_unreachable', error=str(e)[:200])
            raise OrderRejected(f'MT5 bridge unreachable: {e}') from e

        if r.status_code == 422:
            # Validation or broker rejection — surface verbatim.
            try:    detail = r.json().get('detail', r.text[:200])
            except: detail = r.text[:200]
            _reject('bridge_422', detail=str(detail)[:200])
            raise OrderRejected(f'MT5 bridge rejected: {detail}')
        if r.status_code >= 400:
            _reject(f'http_{r.status_code}', body=r.text[:200])
            raise OrderRejected(f'MT5 bridge HTTP {r.status_code}: {r.text[:200]}')

        d = r.json()

        # Persist ORDER_FILLED — the SINGLE most important call site for
        # the journal. The auto-detection trigger creates the
        # journal_entries row from this insert. Without this, real
        # Exness fills never appear in the journal.
        if self.owner_user_id:
            emit_execution_event(
                user_id=self.owner_user_id, broker='mt5',
                event_type='ORDER_FILLED',
                payload={
                    'order_id':       str(d.get('order_id', '')),
                    'symbol':         req.symbol,
                    'side':           req.side.value,
                    'order_type':     req.order_type.value,
                    'requested_qty':  float(d.get('requested_qty', req.quantity)),
                    'filled_qty':     float(d.get('filled_qty', 0)),
                    'avg_fill_price': float(d.get('avg_fill_price', 0)),
                    'slippage_pct':   float(d.get('slippage_pct', 0)),
                    'status':         d.get('status', 'FILLED'),
                    'sl':             req.stop_loss,
                    'tp':             req.take_profit,
                },
            )
        else:
            logger.error(
                f"MT5 bridge ORDER_FILLED skipped — owner_user_id unset "
                f"(symbol={req.symbol} order_id={d.get('order_id')})"
            )

        return OrderResult(
            order_id        = str(d['order_id']),
            client_order_id = req.client_order_id,
            symbol          = req.symbol,
            side            = req.side.value,
            status          = d.get('status', 'FILLED'),
            requested_qty   = float(d.get('requested_qty', req.quantity)),
            filled_qty      = float(d.get('filled_qty', 0)),
            avg_fill_price  = float(d.get('avg_fill_price', 0)),
            commission      = float(d.get('commission', 0)),
            slippage_pct    = float(d.get('slippage_pct', 0)),
            timestamp_ms    = int(d.get('timestamp_ms', time.time() * 1000)),
            raw             = d.get('raw') or {},
        )

    async def cancel_order(self, order_id: str, symbol: str) -> bool:
        url = _bridge_url()
        if not url: return False
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.post(
                    f'{url}/cancel',
                    headers={'X-Bridge-Key': _bridge_key()},
                    json={
                        'login': self._login_id, 'password': self.password, 'server': self.server,
                        'order_id': int(order_id),
                    },
                )
            if r.status_code >= 400:
                return False
            return bool(r.json().get('cancelled'))
        except Exception as e:
            logger.warning(f'bridge /cancel failed: {e}')
            return False

    async def get_positions(self) -> list[Position]:
        url = _bridge_url()
        if not url: return []
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.post(
                    f'{url}/positions',
                    headers={'X-Bridge-Key': _bridge_key()},
                    json={
                        'login': self._login_id, 'password': self.password, 'server': self.server,
                    },
                )
            if r.status_code >= 400:
                logger.warning(f'bridge /positions {r.status_code}: {r.text[:200]}')
                return []
            out: list[Position] = []
            for d in r.json().get('positions', []):
                out.append(Position(
                    symbol         = d['symbol'],
                    side           = d['side'],   # type: ignore[arg-type]
                    qty            = float(d['qty']),
                    avg_entry      = float(d['avg_entry']),
                    current_price  = float(d['current_price']),
                    unrealized_pnl = float(d['unrealized_pnl']),
                    margin_used    = float(d.get('margin_used') or 0),
                    broker_pos_id  = str(d['broker_pos_id']),
                ))
            return out
        except Exception as e:
            logger.warning(f'bridge /positions failed: {e}')
            return []

    async def get_closed_deals(self, since_epoch: int | None = None) -> list[dict]:
        """Fetch closing-deal records from MT5 history since `since_epoch`.

        Each returned dict carries the close-side fields the reconciler
        needs to enrich its POSITION_CLOSED event:
            position_id   — string, matches the open position's id
            exit_price    — price of the closing deal
            realized_pnl  — broker-reported profit (excludes commission/swap)
            commission    — broker fee
            swap          — overnight financing
            close_time    — ISO-8601 UTC timestamp
            symbol        — instrument symbol
            volume        — closed volume in lots

        Empty list on any error / no bridge configured — never raises.
        """
        url = _bridge_url()
        if not url: return []
        body: dict[str, object] = {
            'login':    self._login_id,
            'password': self.password,
            'server':   self.server,
        }
        if since_epoch is not None:
            body['since'] = int(since_epoch)
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.post(
                    f'{url}/closed_deals',
                    headers={'X-Bridge-Key': _bridge_key()},
                    json=body,
                )
            if r.status_code >= 400:
                logger.warning(f'bridge /closed_deals {r.status_code}: {r.text[:200]}')
                return []
            out: list[dict] = []
            for d in r.json().get('deals', []) or []:
                out.append({
                    'position_id':  str(d.get('position_id') or ''),
                    'deal_id':      str(d.get('deal_id') or ''),
                    'symbol':       d.get('symbol'),
                    'volume':       float(d.get('volume') or 0),
                    'exit_price':   float(d.get('price') or 0),
                    'realized_pnl': float(d.get('profit') or 0),
                    'commission':   float(d.get('commission') or 0),
                    'swap':         float(d.get('swap') or 0),
                    'close_time':   d.get('time'),
                })
            return out
        except Exception as e:
            logger.warning(f'bridge /closed_deals failed: {e}')
            return []
