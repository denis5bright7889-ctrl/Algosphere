"""
AlgoSphere — MT5 Bridge Service (Windows VPS side).

Why this exists
---------------
The MetaTrader 5 Python package is Windows-only and drives a desktop
terminal process via shared memory. Our signal-engine runs on Railway
(Linux) where MT5 cannot be imported. This service is the missing
arms-and-legs: a thin HTTP wrapper around the local MetaTrader5
package, exposing exactly the operations the Linux engine needs
(connect / order / cancel / positions / account / quote / symbol-spec).

Topology
--------
  Railway engine ──(HTTPS, X-Bridge-Key auth)──▶  this service  ──▶  MT5 terminal

Run with
--------
  pip install -r requirements.txt
  cp .env.example .env  # fill in BRIDGE_API_KEY
  uvicorn bridge:app --host 0.0.0.0 --port 8000

Multi-account behaviour
-----------------------
The MT5 terminal is a singleton — exactly one broker login is active
at a time. To support multiple users sharing one bridge, every order/
positions call re-logs the terminal to that user's account, serialized
via _MT5_LOCK. This costs ~100–300 ms per call but is correct.

If you only ever serve one account, set MT5_PIN_LOGIN=true in .env to
skip the re-login and pin the terminal to the first /connect call's
credentials. Faster but single-account.

Security
--------
  • Every endpoint requires the X-Bridge-Key header. Generate the key
    with `python -c "import secrets; print(secrets.token_urlsafe(32))"`
    and set the same value as MT5_BRIDGE_API_KEY on the Railway engine.
  • This service receives raw MT5 passwords in request bodies. Run it
    behind HTTPS — Cloudflare Tunnel (free, zero TLS config) is the
    easiest path; see README.md.
"""
from __future__ import annotations
import asyncio
import os
import time
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Depends
from pydantic import BaseModel, Field
from loguru import logger

# MetaTrader5 is Windows-only. Import lazily so the module can be
# loaded for `--reload` / introspection on dev machines without it.
_mt5 = None
def _load_mt5():
    global _mt5
    if _mt5 is None:
        import MetaTrader5 as mt5  # type: ignore
        _mt5 = mt5
    return _mt5


# Module-level lock: the MetaTrader5 module is a singleton, so even
# distinct adapter instances must serialize all calls through it.
_MT5_LOCK = asyncio.Lock()

# Tracks the currently-logged-in account so we skip the re-login when
# successive calls hit the same account.
_current_login: Optional[int] = None

PIN_LOGIN = os.environ.get('MT5_PIN_LOGIN', 'false').lower() == 'true'


# ─── Auth ──────────────────────────────────────────────────────────────

def _verify_bridge_key(x_bridge_key: Optional[str] = Header(default=None)) -> None:
    expected = os.environ.get('BRIDGE_API_KEY', '')
    if not expected:
        # Fail loud: an unauthenticated bridge would expose MT5 to the
        # internet. Refuse to start handling traffic without a key.
        raise HTTPException(
            status_code=503,
            detail='BRIDGE_API_KEY not set on the bridge — refusing to authorise.',
        )
    if x_bridge_key != expected:
        raise HTTPException(status_code=401, detail='Invalid bridge key')


# ─── Request models ────────────────────────────────────────────────────

class ConnectRequest(BaseModel):
    login:    int = Field(..., gt=0)
    password: str = Field(..., min_length=1, max_length=200)
    server:   str = Field(..., min_length=1, max_length=200)


class OrderRequest(BaseModel):
    login:           int
    password:        str
    server:          str
    symbol:          str
    side:            str               # 'buy' | 'sell'
    order_type:      str               # 'market' | 'limit'
    quantity:        float
    price:           Optional[float] = None
    stop_loss:       Optional[float] = None
    take_profit:     Optional[float] = None
    client_order_id: Optional[str]   = None
    max_slippage_pct: float = 0.001
    magic:           int = 20240501


class CancelRequest(BaseModel):
    login:    int
    password: str
    server:   str
    order_id: int


class AccountRequest(BaseModel):
    login:    int
    password: str
    server:   str


# ─── Lifecycle ─────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Probe that MetaTrader5 imports cleanly. If not, fail loud at
    # startup instead of returning surprise 500s per request.
    try:
        _load_mt5()
        logger.info('MT5 bridge: MetaTrader5 package loaded OK')
    except Exception as e:
        logger.error(f'MT5 bridge: MetaTrader5 import failed — {e}')
        # Don't crash — let /health surface the failure so the operator
        # can see it without restarting.
    yield
    mt5 = _mt5
    if mt5 is not None:
        try: mt5.shutdown()
        except Exception: pass


app = FastAPI(title='AlgoSphere MT5 Bridge', version='1.0.0', lifespan=lifespan)


# ─── Helpers ───────────────────────────────────────────────────────────

async def _ensure_login(login: int, password: str, server: str) -> tuple[bool, Optional[str]]:
    """Initialize the terminal if needed and log into `login`.
    Skips re-login if `_current_login` already matches AND PIN_LOGIN is
    not active (we always honour the explicit login in the body)."""
    global _current_login
    mt5 = _load_mt5()

    def _do():
        global _current_login
        # initialize() is idempotent — fine to call repeatedly.
        if not mt5.initialize(timeout=10_000):
            return False, f'initialize failed: {mt5.last_error()}'
        if _current_login == login and PIN_LOGIN:
            return True, None
        if not mt5.login(login, password=password, server=server):
            err = mt5.last_error()
            _current_login = None
            return False, f'login failed: {err}'
        _current_login = login
        return True, None

    return await asyncio.to_thread(_do)


# ─── Endpoints ─────────────────────────────────────────────────────────

@app.get('/health')
async def health():
    """Public — no auth. Lets Railway probe whether the bridge is
    reachable before sending real traffic."""
    mt5 = _mt5
    return {
        'status':       'ok',
        'service':      'algosphere-mt5-bridge',
        'mt5_loaded':   mt5 is not None,
        'pin_login':    PIN_LOGIN,
        'current_login': _current_login,
        'time':         time.time(),
    }


@app.post('/connect', dependencies=[Depends(_verify_bridge_key)])
async def connect(req: ConnectRequest):
    """Handshake — used by the engine's /brokers/test endpoint to
    verify credentials before the user sees a 'connected' badge."""
    async with _MT5_LOCK:
        ok, err = await _ensure_login(req.login, req.password, req.server)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        mt5 = _load_mt5()
        info = await asyncio.to_thread(mt5.account_info)
        if info is None:
            raise HTTPException(status_code=500, detail='account_info returned None')
        return {
            'connected':  True,
            'login':      info.login,
            'name':       info.name,
            'server':     info.server,
            'currency':   info.currency,
            'balance':    float(info.balance),
            'equity':     float(info.equity),
            'leverage':   info.leverage,
            'is_trade_allowed': bool(info.trade_allowed),
        }


@app.post('/account', dependencies=[Depends(_verify_bridge_key)])
async def account(req: AccountRequest):
    """Refresh equity / balance / open position count for the engine's
    risk-engine + dashboard equity widgets."""
    async with _MT5_LOCK:
        ok, err = await _ensure_login(req.login, req.password, req.server)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        mt5 = _load_mt5()
        info = await asyncio.to_thread(mt5.account_info)
        positions = await asyncio.to_thread(mt5.positions_get) or []
        if info is None:
            raise HTTPException(status_code=500, detail='account_info returned None')
        return {
            'equity':              float(info.equity),
            'balance':             float(info.balance),
            'open_position_count': len(positions),
            'currency':            info.currency,
        }


@app.post('/order', dependencies=[Depends(_verify_bridge_key)])
async def submit_order(req: OrderRequest):
    """Submit a market or limit order. Returns the broker's full retcode
    + fill details so the engine can compute slippage + reconcile."""
    async with _MT5_LOCK:
        ok, err = await _ensure_login(req.login, req.password, req.server)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        mt5 = _load_mt5()

        tick = await asyncio.to_thread(mt5.symbol_info_tick, req.symbol)
        if tick is None:
            raise HTTPException(status_code=400, detail=f'unknown symbol {req.symbol}')

        side = req.side.lower()
        if side not in ('buy', 'sell'):
            raise HTTPException(status_code=422, detail=f'invalid side {req.side!r}')
        otype = req.order_type.lower()
        if otype not in ('market', 'limit'):
            raise HTTPException(status_code=422, detail=f'invalid order_type {req.order_type!r}')

        if otype == 'market':
            fill_price = tick.ask if side == 'buy' else tick.bid
            mt5_type = mt5.ORDER_TYPE_BUY if side == 'buy' else mt5.ORDER_TYPE_SELL
            action = mt5.TRADE_ACTION_DEAL
        else:
            if req.price is None:
                raise HTTPException(status_code=422, detail='limit order requires price')
            fill_price = req.price
            mt5_type = mt5.ORDER_TYPE_BUY_LIMIT if side == 'buy' else mt5.ORDER_TYPE_SELL_LIMIT
            action = mt5.TRADE_ACTION_PENDING

        request = {
            'action':       action,
            'symbol':       req.symbol,
            'volume':       float(req.quantity),
            'type':         mt5_type,
            'price':        float(fill_price),
            'deviation':    int(req.max_slippage_pct * 100_000),
            'magic':        req.magic,
            'comment':      (req.client_order_id or 'algosphere')[:31],
            'type_time':    mt5.ORDER_TIME_GTC,
            'type_filling': mt5.ORDER_FILLING_IOC,
        }
        if req.stop_loss  is not None: request['sl'] = float(req.stop_loss)
        if req.take_profit is not None: request['tp'] = float(req.take_profit)

        result = await asyncio.to_thread(mt5.order_send, request)
        if result is None:
            raise HTTPException(status_code=500, detail=f'order_send returned None: {mt5.last_error()}')
        if result.retcode != mt5.TRADE_RETCODE_DONE:
            raise HTTPException(
                status_code=422,
                detail=f'broker rejected (retcode={result.retcode}): {result.comment}',
            )

        avg_price = float(result.price or fill_price)
        slippage = (avg_price - req.price) / req.price if (otype == 'market' and req.price) else 0.0

        return {
            'order_id':       str(result.order),
            'status':         'FILLED',
            'requested_qty':  req.quantity,
            'filled_qty':     float(result.volume),
            'avg_fill_price': avg_price,
            'slippage_pct':   slippage,
            'commission':     0.0,
            'timestamp_ms':   int(time.time() * 1000),
            'raw':            result._asdict() if hasattr(result, '_asdict') else {},
        }


@app.post('/cancel', dependencies=[Depends(_verify_bridge_key)])
async def cancel_order(req: CancelRequest):
    """Cancel a pending limit order. For market positions, use /close."""
    async with _MT5_LOCK:
        ok, err = await _ensure_login(req.login, req.password, req.server)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        mt5 = _load_mt5()
        request = {'action': mt5.TRADE_ACTION_REMOVE, 'order': int(req.order_id)}
        result = await asyncio.to_thread(mt5.order_send, request)
        return {'cancelled': bool(result and result.retcode == mt5.TRADE_RETCODE_DONE)}


@app.post('/positions', dependencies=[Depends(_verify_bridge_key)])
async def positions(req: AccountRequest):
    async with _MT5_LOCK:
        ok, err = await _ensure_login(req.login, req.password, req.server)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        mt5 = _load_mt5()
        rows = await asyncio.to_thread(mt5.positions_get) or []
        out = []
        for p in rows:
            out.append({
                'symbol':         p.symbol,
                'side':           'long' if p.type == mt5.POSITION_TYPE_BUY else 'short',
                'qty':            float(p.volume),
                'avg_entry':      float(p.price_open),
                'current_price':  float(p.price_current),
                'unrealized_pnl': float(p.profit),
                'margin_used':    0.0,
                'broker_pos_id':  str(p.ticket),
            })
        return {'positions': out}


@app.post('/close_all', dependencies=[Depends(_verify_bridge_key)])
async def close_all(req: AccountRequest):
    """Emergency flatten — kill-switch path."""
    async with _MT5_LOCK:
        ok, err = await _ensure_login(req.login, req.password, req.server)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        mt5 = _load_mt5()
        rows = await asyncio.to_thread(mt5.positions_get) or []
        closed = 0
        for p in rows:
            tick = await asyncio.to_thread(mt5.symbol_info_tick, p.symbol)
            if tick is None: continue
            close_type = mt5.ORDER_TYPE_SELL if p.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
            price = tick.bid if p.type == mt5.POSITION_TYPE_BUY else tick.ask
            request = {
                'action':       mt5.TRADE_ACTION_DEAL,
                'position':     int(p.ticket),
                'symbol':       p.symbol,
                'volume':       float(p.volume),
                'type':         close_type,
                'price':        float(price),
                'deviation':    1000,
                'magic':        20240501,
                'comment':      'emergency_flatten',
                'type_filling': mt5.ORDER_FILLING_IOC,
            }
            r = await asyncio.to_thread(mt5.order_send, request)
            if r and r.retcode == mt5.TRADE_RETCODE_DONE:
                closed += 1
        return {'closed_count': closed}


class SymbolRequest(AccountRequest):
    symbol: str


@app.post('/symbol_spec', dependencies=[Depends(_verify_bridge_key)])
async def symbol_spec(req: SymbolRequest):
    async with _MT5_LOCK:
        ok, err = await _ensure_login(req.login, req.password, req.server)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        mt5 = _load_mt5()
        info = await asyncio.to_thread(mt5.symbol_info, req.symbol)
        if info is None:
            return {'spec': None}
        return {'spec': {
            'symbol':        info.name,
            'tick_size':     float(info.point),
            'tick_value':    float(info.trade_tick_value or 1.0),
            'min_lot':       float(info.volume_min),
            'max_lot':       float(info.volume_max),
            'lot_step':      float(info.volume_step),
            'contract_size': float(info.trade_contract_size or 100_000),
            'digits':        int(info.digits),
            'spread_points': int(info.spread),
        }}


@app.post('/quote', dependencies=[Depends(_verify_bridge_key)])
async def quote(req: SymbolRequest):
    async with _MT5_LOCK:
        ok, err = await _ensure_login(req.login, req.password, req.server)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        mt5 = _load_mt5()
        tick = await asyncio.to_thread(mt5.symbol_info_tick, req.symbol)
        if tick is None:
            return {'tick': None}
        return {'tick': {
            'symbol': req.symbol,
            'bid':    float(tick.bid),
            'ask':    float(tick.ask),
            'last':   float(tick.last) if tick.last else None,
            'time':   int(tick.time),
        }}
