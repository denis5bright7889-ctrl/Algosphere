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
import pathlib
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from loguru import logger

# Load .env BEFORE any module-level os.environ reads. python-dotenv
# defaults to searching CWD, but NSSM services often run from
# C:\Windows\System32 (or wherever the service was registered) — so
# we point it explicitly at the .env file next to bridge.py instead.
# Existing system env vars still take precedence (load_dotenv default
# behavior); .env only fills gaps.
from dotenv import load_dotenv
_ENV_PATH = pathlib.Path(__file__).resolve().parent / '.env'
if _ENV_PATH.exists():
    load_dotenv(_ENV_PATH)
    _dotenv_status = f'loaded from {_ENV_PATH}'
else:
    _dotenv_status = f'.env NOT FOUND at {_ENV_PATH} — relying on process env only'
# Logged at startup (logger configured below) so operators see
# whether the .env was picked up.
logger.info(f'mt5-bridge env init: {_dotenv_status}')

# ─── File logging (rotating) ───────────────────────────────────────────
# Loguru writes to stdout by default (NSSM captures that into its own
# log files). Add a dedicated rotating file too so operators have one
# stable path to tail: tail -f logs/mt5bridge.log.
LOG_DIR = pathlib.Path(os.environ.get('LOG_DIR', 'logs'))
try:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger.add(
        LOG_DIR / 'mt5bridge.log',
        rotation = '10 MB',
        retention= 10,
        compression= None,
        enqueue  = True,    # safe to call from threads & async tasks
        backtrace= True,
        diagnose = False,   # avoid leaking variable values into logs
        level    = 'INFO',
    )
except Exception as _e:    # never let logging setup crash the bridge
    pass

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


# ─── Global MT5 readiness gate ─────────────────────────────────────────
# Tracks whether the MT5 terminal has been initialized and is
# reachable. Set True by wait_for_mt5_ready() at startup. Trading
# endpoints depend on require_mt5_ready() — they return HTTP 503 until
# this flag is True, preventing orders from being submitted to a
# half-booted bridge.
#
# This is the BASELINE terminal-aliveness check — it does NOT verify
# any specific account login (per-request _ensure_login handles that
# in multi-tenant mode). The bridge is "ready" when the MT5 process is
# alive and the Python package can talk to it.

mt5_ready: bool = False
_ready_lock = asyncio.Lock()
try:
    _MT5_READY_TIMEOUT_S = int(os.environ.get('MT5_READY_TIMEOUT_S', '30'))
except ValueError:
    _MT5_READY_TIMEOUT_S = 30


async def wait_for_mt5_ready(timeout_s: Optional[int] = None) -> bool:
    """Initialize the MT5 terminal and verify it responds via
    terminal_info(). No account login is performed — multi-tenant
    bridges log in per request. Sets global `mt5_ready`. Re-callable;
    idempotent once successful.

    Returns True on success, False otherwise. Never raises."""
    global mt5_ready
    timeout = timeout_s if timeout_s is not None else _MT5_READY_TIMEOUT_S

    async with _ready_lock:
        if mt5_ready:
            return True
        try:
            mt5 = _load_mt5()
        except Exception as e:
            logger.error(f'wait_for_mt5_ready: MetaTrader5 import failed — {e}')
            mt5_ready = False
            return False

        async with _MT5_LOCK:
            try:
                init_ok = await asyncio.to_thread(mt5.initialize, timeout=timeout * 1000)
            except Exception as e:
                logger.error(f'wait_for_mt5_ready: initialize() raised — {e}')
                mt5_ready = False
                return False
            if not init_ok:
                logger.error(f'wait_for_mt5_ready: initialize() returned False — {mt5.last_error()}')
                mt5_ready = False
                return False
            try:
                info = await asyncio.to_thread(mt5.terminal_info)
            except Exception as e:
                logger.error(f'wait_for_mt5_ready: terminal_info() raised — {e}')
                mt5_ready = False
                return False
            if info is None:
                logger.error('wait_for_mt5_ready: terminal_info() returned None')
                mt5_ready = False
                return False
            logger.info(
                f'wait_for_mt5_ready: terminal OK — {info.name!r} build {info.build}, '
                f'connected={bool(info.connected)}'
            )

        mt5_ready = True
        return True


def require_mt5_ready() -> None:
    """FastAPI dependency. Raises HTTP 503 if the bridge isn't ready
    to execute. Attach via Depends() on every trading endpoint."""
    if not mt5_ready:
        raise HTTPException(
            status_code=503,
            detail='MT5 not ready — terminal not initialized. Bridge is '
                   'starting up, or the MT5 terminal process is down. '
                   'Check /health for current state.',
        )


# ─── Single-account env mode ───────────────────────────────────────────
# Optional: if MT5_LOGIN/MT5_PASSWORD/MT5_SERVER are present in .env,
# the bridge exposes GET endpoints (/account, /positions, /health-full)
# that use those creds — no body required. The existing POST endpoints
# (creds in body) keep working for multi-tenant Railway use.

def _default_creds() -> Optional[tuple[int, str, str]]:
    login = os.environ.get('MT5_LOGIN', '').strip()
    pwd   = os.environ.get('MT5_PASSWORD', '').strip()
    srv   = os.environ.get('MT5_SERVER', '').strip()
    if not (login and pwd and srv):
        return None
    try:
        return (int(login), pwd, srv)
    except ValueError:
        logger.warning(f"MT5_LOGIN must be numeric, got: {login!r}")
        return None


def _safe_int_env(name: str, default: int) -> int:
    try:    return int(os.environ.get(name, default))
    except: return default


def _safe_float_env(name: str, default: float) -> float:
    try:    return float(os.environ.get(name, default))
    except: return default


# Last-line safety caps (env-overridable). The signal-engine on Railway
# has its own 12-gate risk stack — these are *additional* guardrails at
# the execution boundary in case the engine has a bug or is mis-configured.
MAX_LOT_LIMIT       = _safe_float_env('MAX_LOT_LIMIT',     100.0)  # hard ceiling regardless of broker max
MAX_ORDERS_PER_MIN  = _safe_int_env  ('MAX_ORDERS_PER_MIN', 30)    # per-bridge rate limit
SYMBOL_CACHE_TTL_S  = _safe_int_env  ('SYMBOL_CACHE_TTL_S', 3600)  # refetch broker symbol list after this many seconds


# ─── Dynamic symbol cache (per-server, lazy, TTL'd) ───────────────────
# Brokers use different suffixes — `XAUUSDm`, `EURUSD.r`, `BTCUSD#`, etc.
# Maintaining a static SYMBOL_WHITELIST forces ops to manually mirror
# each broker's naming. Instead, on first contact with a server we pull
# the live list via `mt5.symbols_get()` and cache it. Subsequent orders
# validate against the cached list; the /symbols endpoint exposes it.
#
# Cache is keyed by SERVER name (different brokers => different symbols).
# Same server across users shares one cache entry.

@dataclass
class _SymbolCacheEntry:
    server:     str
    names:      set[str]            # uppercased for O(1) lookup
    full:       list[dict]          # serialized rows for /symbols endpoint
    fetched_at: float

_symbol_cache:      dict[str, _SymbolCacheEntry] = {}
_symbol_cache_lock = asyncio.Lock()


def _serialize_symbol(s) -> dict:
    """Pull the fields callers actually care about. Names match the
    /symbols response shape so the engine can downstream them."""
    return {
        'name':           s.name,
        'description':    getattr(s, 'description', '') or '',
        'currency_base':  getattr(s, 'currency_base', '') or '',
        'currency_profit':getattr(s, 'currency_profit', '') or '',
        'digits':         int(getattr(s, 'digits', 5)),
        'point':          float(getattr(s, 'point', 0.0)),
        'volume_min':     float(getattr(s, 'volume_min', 0.0)),
        'volume_max':     float(getattr(s, 'volume_max', 0.0)),
        'volume_step':    float(getattr(s, 'volume_step', 0.0)),
        'contract_size':  float(getattr(s, 'trade_contract_size', 0.0) or 0.0),
        'trade_mode':     int(getattr(s, 'trade_mode', 0)),    # 0=disabled, 4=full
        'visible':        bool(getattr(s, 'visible', True)),
        'path':           getattr(s, 'path', '') or '',         # broker group ("Forex\Majors\EURUSD")
    }


async def _fetch_and_cache_symbols(server: str) -> _SymbolCacheEntry:
    """Pull live symbols from MT5 for whoever is currently logged in.
    MUST be called with _MT5_LOCK already held AND the terminal already
    logged into `server` — the caller is responsible for that."""
    mt5 = _load_mt5()
    raw = await asyncio.to_thread(mt5.symbols_get) or []
    # Filter: keep only symbols that are visible and have trade_mode != 0.
    # `visible` defaults True if MT5 doesn't supply it. trade_mode == 0
    # means TRADE_DISABLED — broker explicitly forbids trading it.
    keepers = [
        s for s in raw
        if getattr(s, 'visible', True)
        and int(getattr(s, 'trade_mode', 4)) != 0
    ]
    entry = _SymbolCacheEntry(
        server     = server,
        names      = {s.name.upper() for s in keepers},
        full       = [_serialize_symbol(s) for s in keepers],
        fetched_at = time.time(),
    )
    _symbol_cache[server] = entry
    logger.info(f'symbol cache refreshed for {server}: {len(entry.names)} tradable symbols')
    return entry


async def _ensure_symbol_cache(
    login: int, password: str, server: str, *, force: bool = False,
) -> _SymbolCacheEntry:
    """Return a cached entry for `server`, refreshing if missing/stale.
    Acquires _MT5_LOCK and re-logs the terminal as needed."""
    cached = _symbol_cache.get(server)
    if cached and not force and (time.time() - cached.fetched_at) < SYMBOL_CACHE_TTL_S:
        return cached

    async with _symbol_cache_lock:
        # Re-check inside the lock — another task may have populated.
        cached = _symbol_cache.get(server)
        if cached and not force and (time.time() - cached.fetched_at) < SYMBOL_CACHE_TTL_S:
            return cached
        async with _MT5_LOCK:
            ok, err = await _ensure_login(login, password, server)
            if not ok:
                raise HTTPException(status_code=400, detail=err)
            return await _fetch_and_cache_symbols(server)


# ─── Watchdog state (background MT5 liveness ping) ─────────────────────
# Periodic task pings account_info() — if it fails N times in a row, we
# flag the bridge as not-execution-ready and surface in /health. NSSM
# auto-restarts on process death, but doesn't notice silent MT5 hangs.

_watchdog_state: dict = {
    'last_ping_ms':    0,
    'last_ok_ms':      0,
    'consec_failures': 0,
    'execution_ready': False,
    'account':         None,
    'equity':          None,
}

# Sliding window of recent /order timestamps for the rate limit.
_order_times: deque[float] = deque(maxlen=200)


def _rate_limit_check() -> None:
    """Raise HTTPException if the bridge has fired more than
    MAX_ORDERS_PER_MIN orders in the last 60 seconds."""
    now = time.time()
    # Drop old entries
    while _order_times and (now - _order_times[0]) > 60:
        _order_times.popleft()
    if len(_order_times) >= MAX_ORDERS_PER_MIN:
        raise HTTPException(
            status_code=429,
            detail=f'Rate limit: {MAX_ORDERS_PER_MIN} orders/min exceeded',
        )


def _validate_qty(qty: float) -> None:
    """Quantity-only guardrails — symbol validation is dynamic (see
    _validate_order_safety_async)."""
    if qty <= 0:
        raise HTTPException(status_code=422, detail=f'qty must be > 0 (got {qty})')
    if qty > MAX_LOT_LIMIT:
        raise HTTPException(
            status_code=422,
            detail=f'qty {qty:g} exceeds MAX_LOT_LIMIT {MAX_LOT_LIMIT:g}',
        )


async def _validate_order_safety_async(
    login: int, password: str, server: str, symbol: str, qty: float,
) -> None:
    """Full order safety check: quantity caps + dynamic symbol
    validation against the broker's live symbol list. Lazy-populates
    the cache on first request for this server. Raises HTTPException
    on violation."""
    _validate_qty(qty)
    s = symbol.upper().strip()
    entry = await _ensure_symbol_cache(login, password, server)
    if s not in entry.names:
        # Include a small sample to help the engine/operator pick a
        # broker-correct suffix (e.g. XAUUSDm vs XAUUSD).
        sample = sorted([n for n in entry.names if s.replace('.', '').replace('#', '') in n])[:5]
        detail = (
            f'symbol {s!r} not in broker symbol list for server {server!r} '
            f'({len(entry.names)} known)'
        )
        if sample:
            detail += f'. Similar: {sample}'
        raise HTTPException(status_code=422, detail=detail)


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

    # Initialize the MT5 terminal eagerly so trading endpoints don't
    # have to pay the cold-start cost on the first user request. Sets
    # the global `mt5_ready` flag. Trading endpoints gate on it via
    # Depends(require_mt5_ready) and 503 until it's True.
    ok = await wait_for_mt5_ready()
    if ok:
        logger.info('MT5 bridge: ✅ ready to execute (mt5_ready=True)')
    else:
        logger.warning(
            'MT5 bridge: ⚠️ NOT ready at startup — trading endpoints will 503 '
            'until the terminal becomes reachable. Check MT5 terminal process.'
        )

    # Start the watchdog only if default creds are present — otherwise
    # there's nothing to ping (we'd just be re-logging random accounts).
    wd_task: Optional[asyncio.Task] = None
    if _default_creds() is not None:
        wd_task = asyncio.create_task(_watchdog_loop())
        logger.info('MT5 bridge: watchdog task started')
    else:
        logger.info('MT5 bridge: no MT5_LOGIN/PASSWORD/SERVER in env — watchdog disabled')

    yield

    if wd_task is not None:
        wd_task.cancel()
        try:    await wd_task
        except: pass
    mt5 = _mt5
    if mt5 is not None:
        try: mt5.shutdown()
        except Exception: pass


WATCHDOG_INTERVAL_S    = _safe_int_env('WATCHDOG_INTERVAL_S',    30)
WATCHDOG_MAX_FAILURES  = _safe_int_env('WATCHDOG_MAX_FAILURES',  3)


async def _watchdog_loop() -> None:
    """Background task: every WATCHDOG_INTERVAL_S, call account_info on
    the configured default account and update _watchdog_state. After
    WATCHDOG_MAX_FAILURES consecutive failures, execution_ready flips
    to False and stays there until a ping succeeds again.

    This catches the case where MT5 terminal hangs silently while the
    Python process is still alive (NSSM doesn't notice that)."""
    while True:
        try:
            await asyncio.sleep(WATCHDOG_INTERVAL_S)
            creds = _default_creds()
            if creds is None:
                continue  # creds were removed at runtime — stay quiet
            login, password, server = creds

            async with _MT5_LOCK:
                ok, err = await _ensure_login(login, password, server)
                _watchdog_state['last_ping_ms'] = int(time.time() * 1000)
                if not ok:
                    _watchdog_state['consec_failures'] += 1
                    if _watchdog_state['consec_failures'] >= WATCHDOG_MAX_FAILURES:
                        _watchdog_state['execution_ready'] = False
                    logger.warning(f'watchdog: login failed ({err}) — consec={_watchdog_state["consec_failures"]}')
                    continue

                mt5 = _load_mt5()
                info = await asyncio.to_thread(mt5.account_info)
                if info is None:
                    _watchdog_state['consec_failures'] += 1
                    if _watchdog_state['consec_failures'] >= WATCHDOG_MAX_FAILURES:
                        _watchdog_state['execution_ready'] = False
                    logger.warning('watchdog: account_info returned None')
                    continue

                _watchdog_state['consec_failures'] = 0
                _watchdog_state['execution_ready'] = True
                _watchdog_state['last_ok_ms']      = _watchdog_state['last_ping_ms']
                _watchdog_state['account']         = int(info.login)
                _watchdog_state['equity']          = float(info.equity)
        except asyncio.CancelledError:
            break
        except Exception as e:
            # Watchdog must never crash itself.
            logger.warning(f'watchdog loop error (continuing): {e}')


app = FastAPI(title='AlgoSphere MT5 Bridge', version='1.1.0', lifespan=lifespan)


# ─── Request-logging middleware ────────────────────────────────────────

@app.middleware('http')
async def _log_requests(request: Request, call_next):
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as e:
        ms = int((time.perf_counter() - started) * 1000)
        logger.error(f'{request.method} {request.url.path} → EXC ({ms}ms): {e}')
        raise
    ms = int((time.perf_counter() - started) * 1000)
    if response.status_code >= 500:
        logger.error(f'{request.method} {request.url.path} → {response.status_code} ({ms}ms)')
    elif response.status_code >= 400:
        logger.warning(f'{request.method} {request.url.path} → {response.status_code} ({ms}ms)')
    else:
        logger.info(f'{request.method} {request.url.path} → {response.status_code} ({ms}ms)')
    return response


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
    reachable before sending real traffic.

    Canonical fields (always present):
        status:     'ok' | 'degraded'
        mt5_loaded: bool  — MetaTrader5 package importable
        timestamp:  float — epoch seconds

    Extended fields (back-compat for richer dashboards):
        mt5_ready, mt5_connected, execution_ready, account, equity,
        consec_failures, last_ok_age_s, pin_login, current_login,
        creds_configured."""
    mt5 = _mt5
    wd  = _watchdog_state
    creds_configured = _default_creds() is not None
    last_ok_age_s = (
        (time.time() * 1000 - wd['last_ok_ms']) / 1000.0
        if wd['last_ok_ms'] else None
    )
    mt5_connected = (
        creds_configured
        and last_ok_age_s is not None
        and last_ok_age_s < (WATCHDOG_INTERVAL_S * 3)
    )
    mt5_loaded = mt5 is not None
    # Canonical status: degraded if the package didn't load, OR if
    # we're in single-account mode and the watchdog says we've lost
    # contact with the account.
    status = 'ok' if mt5_loaded and mt5_ready and (mt5_connected or not creds_configured) else 'degraded'
    # ── Risk-panel config snapshot ──────────────────
    # Surface the bridge's own safety caps so the /admin Risk panel
    # can show them. Also include the current rate-window usage so
    # operators see proximity to the rate limit.
    now = time.time()
    rate_used = sum(1 for t in _order_times if (now - t) < 60)
    rate_status = (
        'safe'    if rate_used < 0.6 * MAX_ORDERS_PER_MIN
        else 'warn' if rate_used < 0.9 * MAX_ORDERS_PER_MIN
        else 'breach'
    )
    return {
        # ── Canonical ───────────────────────────────
        'status':           status,
        'mt5_loaded':       mt5_loaded,
        'timestamp':        time.time(),
        # ── Extended (back-compat) ──────────────────
        'service':          'algosphere-mt5-bridge',
        'mt5_ready':        mt5_ready,
        'mt5_connected':    mt5_connected,
        'execution_ready':  bool(wd['execution_ready']) if creds_configured else False,
        'account':          wd['account'],
        'equity':           wd['equity'],
        'consec_failures':  wd['consec_failures'],
        'last_ok_age_s':    last_ok_age_s,
        'pin_login':        PIN_LOGIN,
        'current_login':    _current_login,
        'creds_configured': creds_configured,
        # ── Risk panel ──────────────────────────────
        'risk': {
            'max_lot_limit':       MAX_LOT_LIMIT,
            'max_orders_per_min':  MAX_ORDERS_PER_MIN,
            'orders_last_60s':     rate_used,
            'rate_status':         rate_status,
            'symbol_cache_ttl_s':  SYMBOL_CACHE_TTL_S,
            'symbol_servers':      sorted(_symbol_cache.keys()),
            'symbol_total':        sum(len(e.names) for e in _symbol_cache.values()),
        },
        # Legacy alias — older clients may still read `time`
        'time':             time.time(),
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


@app.post('/order', dependencies=[Depends(_verify_bridge_key), Depends(require_mt5_ready)])
async def submit_order(req: OrderRequest):
    """Submit a market or limit order. Returns the broker's full retcode
    + fill details so the engine can compute slippage + reconcile.

    Last-line safety: rejects orders that violate MAX_LOT_LIMIT, the
    per-minute rate limit, or aren't in the broker's live symbol list
    BEFORE any MT5 order call. These are guardrails — the signal-engine
    has its own 12-gate risk stack upstream."""
    _rate_limit_check()
    await _validate_order_safety_async(
        req.login, req.password, req.server, req.symbol, req.quantity,
    )

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

        _order_times.append(time.time())
        logger.info(
            f'order accepted: {side.upper()} {req.symbol} qty={req.quantity:g} '
            f'fill={avg_price:.5f} slip={slippage:.4%} ticket={result.order}'
        )

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


@app.post('/cancel', dependencies=[Depends(_verify_bridge_key), Depends(require_mt5_ready)])
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


@app.post('/close_all', dependencies=[Depends(_verify_bridge_key), Depends(require_mt5_ready)])
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


class SymbolsRequest(AccountRequest):
    refresh:  bool          = False    # force a re-pull from MT5 even if cache is fresh
    category: Optional[str] = None     # 'forex' | 'metals' | 'indices' | 'crypto' | 'commodities'


# Best-effort category guesses based on MT5 `path` (broker group) +
# common naming. Brokers don't use a standard taxonomy, so we look at
# the symbol path first (e.g. "Forex\Majors\EURUSD") then fall back
# to suffix heuristics. Returns None when nothing matches.
def _guess_category(sym: dict) -> Optional[str]:
    path = (sym.get('path') or '').lower()
    name = (sym.get('name') or '').upper()
    if 'forex'   in path or 'fx'    in path: return 'forex'
    if 'metal'   in path or 'spot' in path and any(m in name for m in ('XAU','XAG','XPT','XPD')): return 'metals'
    if 'crypto'  in path or any(c in name for c in ('BTC','ETH','XRP','SOL','DOGE','ADA')): return 'crypto'
    if 'indic'   in path or 'index' in path or name in {'US30','NAS100','SPX500','GER40','UK100','JP225'}: return 'indices'
    if 'oil'     in path or 'energ' in path or name in {'USOIL','UKOIL','NGAS','BRENT'}: return 'commodities'
    if any(m in name for m in ('XAU','XAG','XPT','XPD')): return 'metals'
    # 6-letter currency pair convention (EURUSD, GBPJPY, etc.)
    if len(name) == 6 and name.isalpha(): return 'forex'
    return None


@app.post('/symbols', dependencies=[Depends(_verify_bridge_key)])
async def symbols(req: SymbolsRequest):
    """Return the broker's live tradable symbol list for `req.server`.

    Lazily populated on first call per server, cached for
    SYMBOL_CACHE_TTL_S seconds (default 1h). Set `refresh: true` to
    force a re-pull from MT5. Optional `category` filter narrows the
    result to a heuristic class (forex/metals/indices/crypto/commodities).

    This is the source of truth for what symbols the engine can
    actually submit orders against — /order validates against this
    same cache."""
    entry = await _ensure_symbol_cache(
        req.login, req.password, req.server, force=req.refresh,
    )
    items = entry.full
    if req.category:
        wanted = req.category.lower().strip()
        items = [s for s in items if _guess_category(s) == wanted]
    return {
        'server':     entry.server,
        'count':      len(items),
        'total':      len(entry.full),
        'fetched_at': entry.fetched_at,
        'cache_age_s': max(0, int(time.time() - entry.fetched_at)),
        'category':   req.category,
        'symbols':    items,
    }


# ───────────────────────────────────────────────────────────────────────
# Higher-level convenience endpoints
# ───────────────────────────────────────────────────────────────────────
#
# The endpoints below sit on top of the primitives above. They give
# external clients (e.g. curl, dashboards, simple webhooks) a more
# intuitive shape: /trade/place / /trade/close / GET /account /
# GET /positions. The single-account GET variants read creds from env
# (MT5_LOGIN/PASSWORD/SERVER) so you don't have to POST passwords in
# every body.
#
# The existing POST endpoints with creds-in-body keep working — those
# are what the Railway engine's MT5BridgeAdapter calls (multi-tenant
# path). Nothing above this line changed semantics.


def _require_default_creds() -> tuple[int, str, str]:
    """Return env-configured (login, password, server) or 503."""
    creds = _default_creds()
    if creds is None:
        raise HTTPException(
            status_code=503,
            detail='Single-account mode disabled — set MT5_LOGIN, '
                   'MT5_PASSWORD, MT5_SERVER in .env to enable GET endpoints',
        )
    return creds


class TradePlaceRequest(BaseModel):
    """Simpler shape than OrderRequest — single-account, uses .env creds.
    Direction is 'BUY' / 'SELL' (per the spec) instead of side enum."""
    symbol:      str
    lot:         float
    direction:   str                          # 'BUY' | 'SELL'
    order_type:  str = 'market'               # 'market' | 'limit'
    price:       Optional[float] = None       # required for LIMIT
    stop_loss:   Optional[float] = None
    take_profit: Optional[float] = None
    client_order_id: Optional[str] = None
    max_slippage_pct: float = 0.001


class TradeCloseRequest(BaseModel):
    ticket: int = Field(..., gt=0)


@app.post('/trade/place', dependencies=[Depends(_verify_bridge_key), Depends(require_mt5_ready)])
async def trade_place(req: TradePlaceRequest):
    """Single-account place-order using .env credentials. Maps the
    spec's {symbol, lot, direction, sl, tp} shape onto the existing
    /order internals so we don't duplicate the MT5 plumbing."""
    login, password, server = _require_default_creds()
    side = req.direction.lower()
    if side not in ('buy', 'sell'):
        raise HTTPException(status_code=422, detail=f'direction must be BUY or SELL (got {req.direction!r})')

    return await submit_order(OrderRequest(
        login            = login,
        password         = password,
        server           = server,
        symbol           = req.symbol,
        side             = side,
        order_type       = req.order_type,
        quantity         = req.lot,
        price            = req.price,
        stop_loss        = req.stop_loss,
        take_profit      = req.take_profit,
        client_order_id  = req.client_order_id,
        max_slippage_pct = req.max_slippage_pct,
    ))


@app.post('/trade/close', dependencies=[Depends(_verify_bridge_key), Depends(require_mt5_ready)])
async def trade_close(req: TradeCloseRequest):
    """Close a specific OPEN position by its broker ticket. Different
    from /cancel (which removes pending orders) and /close_all (which
    flattens everything)."""
    login, password, server = _require_default_creds()
    async with _MT5_LOCK:
        ok, err = await _ensure_login(login, password, server)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        mt5 = _load_mt5()
        positions = await asyncio.to_thread(mt5.positions_get, ticket=req.ticket)
        if not positions:
            raise HTTPException(status_code=404, detail=f'no open position with ticket {req.ticket}')
        pos = positions[0]
        tick = await asyncio.to_thread(mt5.symbol_info_tick, pos.symbol)
        if tick is None:
            raise HTTPException(status_code=400, detail=f'no tick for {pos.symbol}')

        # Reverse the side to flatten. Buys close at the bid, sells at the ask.
        close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
        price = tick.bid if pos.type == mt5.POSITION_TYPE_BUY else tick.ask
        request = {
            'action':       mt5.TRADE_ACTION_DEAL,
            'position':     int(pos.ticket),
            'symbol':       pos.symbol,
            'volume':       float(pos.volume),
            'type':         close_type,
            'price':        float(price),
            'deviation':    1000,
            'magic':        20240501,
            'comment':      'trade_close',
            'type_filling': mt5.ORDER_FILLING_IOC,
        }
        result = await asyncio.to_thread(mt5.order_send, request)
        if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
            detail = (
                f'close failed (retcode={result.retcode}): {result.comment}'
                if result is not None else f'order_send None: {mt5.last_error()}'
            )
            raise HTTPException(status_code=422, detail=detail)

        logger.info(f'position closed: ticket={req.ticket} symbol={pos.symbol} exit={result.price}')
        return {
            'closed':         True,
            'ticket':         req.ticket,
            'symbol':         pos.symbol,
            'exit_price':     float(result.price or price),
            'realized_volume': float(result.volume or pos.volume),
            'timestamp_ms':   int(time.time() * 1000),
        }


@app.get('/account', dependencies=[Depends(_verify_bridge_key)])
async def get_account():
    """Stateless GET — uses .env creds. Returns the current account's
    equity / balance / open-position count + the watchdog's freshness
    indicator so a single curl tells you whether the bridge is healthy."""
    login, password, server = _require_default_creds()
    async with _MT5_LOCK:
        ok, err = await _ensure_login(login, password, server)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        mt5 = _load_mt5()
        info = await asyncio.to_thread(mt5.account_info)
        positions = await asyncio.to_thread(mt5.positions_get) or []
        if info is None:
            raise HTTPException(status_code=500, detail='account_info returned None')
        return {
            'login':               int(info.login),
            'name':                info.name,
            'server':              info.server,
            'currency':            info.currency,
            'leverage':            int(info.leverage),
            'balance':             float(info.balance),
            'equity':              float(info.equity),
            'margin':              float(info.margin),
            'free_margin':         float(info.margin_free),
            'open_position_count': len(positions),
            'is_trade_allowed':    bool(info.trade_allowed),
            'watchdog': {
                'execution_ready': _watchdog_state['execution_ready'],
                'consec_failures': _watchdog_state['consec_failures'],
                'last_ok_ms':      _watchdog_state['last_ok_ms'],
            },
        }


@app.get('/positions', dependencies=[Depends(_verify_bridge_key)])
async def get_positions():
    """Stateless GET — uses .env creds. Returns all open positions."""
    login, password, server = _require_default_creds()
    async with _MT5_LOCK:
        ok, err = await _ensure_login(login, password, server)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        mt5 = _load_mt5()
        rows = await asyncio.to_thread(mt5.positions_get) or []
        out = []
        for p in rows:
            out.append({
                'ticket':         int(p.ticket),
                'symbol':         p.symbol,
                'side':           'long' if p.type == mt5.POSITION_TYPE_BUY else 'short',
                'qty':            float(p.volume),
                'avg_entry':      float(p.price_open),
                'current_price':  float(p.price_current),
                'unrealized_pnl': float(p.profit),
                'sl':             float(p.sl) if p.sl else None,
                'tp':             float(p.tp) if p.tp else None,
                'opened_at':      int(p.time),
            })
        return {'positions': out, 'count': len(out)}


# ───────────────────────────────────────────────────────────────────────
# Operator control dashboard
# ───────────────────────────────────────────────────────────────────────
# Self-contained ops console served at /dashboard. The frontend is
# a plain HTML/JS file (no build step, no framework) that polls the
# /processes /logs /health endpoints on a short interval. Useful for
# at-a-glance "is the bridge alive, is MT5 connected, what just
# logged" answers without SSHing into the VPS.
#
# Auth: the dashboard prompts for the X-Bridge-Key on first load,
# stores it in sessionStorage, and includes it on every fetch. To
# expire the session, close the tab.

# Processes the operator typically cares about. start.py / watchdog.py
# / guardian.py are NSSM's job in our setup — they're listed so the
# dashboard explicitly reports their absence as "not running" rather
# than pretending they exist.
EXPECTED_PROCESSES = [
    'bridge.py',          # this service
    'uvicorn',            # ASGI server hosting bridge.py
    'cloudflared',        # tunnel exposing it
    'terminal64.exe',     # MT5 terminal (Windows x64)
    'terminal.exe',       # MT5 terminal (legacy)
    'start.py',           # operator-supplied (not in repo — will show as not running)
    'watchdog.py',        # operator-supplied (NSSM covers auto-restart in our setup)
    'guardian.py',        # operator-supplied (same)
]


@app.get('/processes', dependencies=[Depends(_verify_bridge_key)])
async def list_processes():
    """Snapshot of OS processes the operator cares about. Uses psutil
    to scan all running processes once, then groups matches by the
    expected names. For Python scripts we look at the cmdline (the .py
    name doesn't show up as the process name)."""
    import psutil
    found: dict[str, list[dict]] = {}

    for p in psutil.process_iter(['pid', 'name', 'cmdline', 'create_time']):
        try:
            info = p.info
            name = (info.get('name') or '').lower()
            cmdline_str = ' '.join(info.get('cmdline') or []).lower()
            for expected in EXPECTED_PROCESSES:
                exp = expected.lower()
                # For .py scripts, match on cmdline; for .exe match on name.
                if exp.endswith('.py'):
                    matched = exp in cmdline_str
                elif exp.endswith('.exe'):
                    matched = exp in name
                else:
                    matched = exp in name or exp in cmdline_str
                if matched:
                    found.setdefault(expected, []).append({
                        'pid':         info['pid'],
                        'name':        info.get('name'),
                        'created_at':  info.get('create_time'),
                        'uptime_s':    max(0, int(time.time() - (info.get('create_time') or time.time()))),
                    })
                    break
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    return {
        'processes': [
            {
                'name':      name,
                'running':   name in found,
                'count':     len(found.get(name, [])),
                'instances': found.get(name, []),
            }
            for name in EXPECTED_PROCESSES
        ],
        'timestamp': time.time(),
    }


@app.get('/logs', dependencies=[Depends(_verify_bridge_key)])
async def get_recent_logs(lines: int = 20):
    """Tail the last N lines from logs/mt5bridge.log. Memory-efficient
    (uses a bounded deque so the full file is never loaded). Used by
    the dashboard's TRADES card to surface recent activity."""
    if lines <= 0 or lines > 500:
        raise HTTPException(status_code=422, detail='lines must be 1..500')
    log_file = LOG_DIR / 'mt5bridge.log'
    if not log_file.exists():
        return {'logs': [], 'count': 0, 'log_file': str(log_file), 'message': 'log file not found yet'}
    try:
        with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
            tail = deque(f, maxlen=lines)
        return {
            'logs':     [line.rstrip() for line in tail],
            'count':    len(tail),
            'log_file': str(log_file),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'failed to read log: {e}')


_DASHBOARD_HTML_PATH = pathlib.Path(__file__).resolve().parent / 'dashboard.html'


@app.get('/admin')
async def serve_admin():
    """Operator command center. Bloomberg-style terminal UI rendered
    from dashboard.html — the canonical single-page control interface
    for this bridge instance. Public route (no auth on the page itself);
    the JS prompts for X-Bridge-Key once on first load and uses it for
    every API call. Without the key, /processes and /logs return 401
    and the cards show 'auth required'."""
    from fastapi.responses import HTMLResponse, PlainTextResponse
    if not _DASHBOARD_HTML_PATH.exists():
        return PlainTextResponse(
            f'dashboard.html not found at {_DASHBOARD_HTML_PATH}',
            status_code=500,
        )
    return HTMLResponse(_DASHBOARD_HTML_PATH.read_text(encoding='utf-8'))


@app.get('/dashboard')
async def serve_dashboard_alias():
    """Back-compat alias for the old /dashboard URL. Redirects to
    /admin so anyone with the old URL bookmarked still lands on the
    right place."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url='/admin', status_code=308)
