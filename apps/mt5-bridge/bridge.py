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
import json as _json
import os
import pathlib
import sys
import time
import traceback
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
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

# JSON structured log sink — machine-readable alongside the human log.
try:
    logger.add(
        LOG_DIR / 'mt5bridge_json.log',
        rotation='10 MB',
        retention=10,
        enqueue=True,
        backtrace=False,
        diagnose=False,
        level='INFO',
        serialize=True,
    )
except Exception:
    pass

# Crash dump — capture unhandled exceptions to a timestamped JSON file.
def _crash_dump(exc_type, exc_value, exc_tb):
    if issubclass(exc_type, (KeyboardInterrupt, SystemExit)):
        sys.__excepthook__(exc_type, exc_value, exc_tb)
        return
    crash_file = LOG_DIR / f'crash_{int(time.time())}.json'
    dump = {
        'timestamp': time.time(),
        'exception': exc_type.__name__,
        'message': str(exc_value),
        'traceback': traceback.format_exception(exc_type, exc_value, exc_tb),
    }
    try:
        crash_file.write_text(_json.dumps(dump, indent=2))
    except Exception:
        pass
    logger.error(f'UNHANDLED EXCEPTION — crash dump written: {crash_file}')
    sys.__excepthook__(exc_type, exc_value, exc_tb)

sys.excepthook = _crash_dump

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

# Bridge service start time — surfaced as service_uptime_s on /health
# so the dashboard can render an "Uptime" widget. Set once at import.
SERVICE_STARTED_AT: float = time.time()


async def _probe_mt5(timeout_s: Optional[int] = None) -> bool:
    """Initialize the MT5 terminal and verify it responds via
    terminal_info(). No account login is performed — multi-tenant
    bridges log in per request. Returns True iff the terminal is
    reachable. Never raises, and never touches the global `mt5_ready`
    flag — the caller owns that. Logs at debug so the periodic readiness
    watchdog doesn't flood the log; meaningful state transitions are
    logged by the callers (lifespan / _readiness_watchdog_loop)."""
    timeout = timeout_s if timeout_s is not None else _MT5_READY_TIMEOUT_S
    try:
        mt5 = _load_mt5()
    except Exception as e:
        logger.debug(f'_probe_mt5: MetaTrader5 import failed — {e}')
        return False

    async with _MT5_LOCK:
        try:
            init_ok = await asyncio.to_thread(mt5.initialize, timeout=timeout * 1000)
        except Exception as e:
            logger.debug(f'_probe_mt5: initialize() raised — {e}')
            return False
        if not init_ok:
            logger.debug(f'_probe_mt5: initialize() returned False — {mt5.last_error()}')
            return False
        try:
            info = await asyncio.to_thread(mt5.terminal_info)
        except Exception as e:
            logger.debug(f'_probe_mt5: terminal_info() raised — {e}')
            return False
        if info is None:
            logger.debug('_probe_mt5: terminal_info() returned None')
            return False
        logger.debug(
            f'_probe_mt5: terminal OK — {info.name!r} build {info.build}, '
            f'connected={bool(info.connected)}'
        )
    return True


async def wait_for_mt5_ready(timeout_s: Optional[int] = None) -> bool:
    """Eager startup initialization. Probes the terminal once and sets
    the global `mt5_ready`. Re-callable; idempotent once successful (the
    readiness watchdog keeps the flag fresh thereafter).

    Returns True on success, False otherwise. Never raises."""
    global mt5_ready
    async with _ready_lock:
        if mt5_ready:
            return True
        mt5_ready = await _probe_mt5(timeout_s)
        return mt5_ready


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

# Tracks whether the MT5 terminal reports an active broker connection.
# Updated by _readiness_watchdog_loop alongside mt5_ready.
_terminal_connected: bool = False

# ─── In-memory trade queue (Phase 1/3: queue rather than reject) ───────
# When mt5_ready is False, /trade/place enqueues the request here.
# A single worker loop drains the queue once MT5 is available, keeping
# the single-MT5-instance guarantee — no parallel execution threads.

@dataclass
class _QueuedTrade:
    queue_id:     str
    req:          Any          # OrderRequest
    enqueued_at:  float        = field(default_factory=time.time)
    status:       str          = 'pending'   # pending|executing|done|failed
    result:       Optional[dict] = None
    error:        str          = ''
    completed_at: Optional[float] = None

_trade_queue_store: dict[str, _QueuedTrade] = {}
_trade_queue_lock   = asyncio.Lock()
_trade_queue_signal = asyncio.Event()          # set by producers, cleared by worker

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

_dep_report: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dependency gate — lenient (major-version only; optional deps
    # degrade, never crash). Surfaced on /health so false "degraded"
    # noise (dotenv missing / patch-version mismatch) is visible and
    # explainable rather than alarming.
    global _dep_report
    try:
        from dependency_guard import check_dependencies, log_report
        rep = check_dependencies()
        log_report(rep, logger)
        _dep_report = rep.as_dict()
    except Exception as e:
        logger.warning(f'dependency_guard unavailable ({e}) — continuing')
        _dep_report = {}

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

    # Always-on readiness watchdog: re-probes terminal liveness every
    # MT5_READY_PROBE_INTERVAL_S and refreshes mt5_ready (up AND down),
    # so a boot-ordering race or a terminal bounce self-heals without a
    # service restart. Independent of default creds.
    ready_task = asyncio.create_task(_readiness_watchdog_loop())
    logger.info('MT5 bridge: readiness watchdog started')

    # Start the account watchdog only if default creds are present —
    # otherwise there's nothing to ping (we'd just be re-logging random
    # accounts).
    wd_task: Optional[asyncio.Task] = None
    if _default_creds() is not None:
        wd_task = asyncio.create_task(_watchdog_loop())
        logger.info('MT5 bridge: watchdog task started')
    else:
        logger.info('MT5 bridge: no MT5_LOGIN/PASSWORD/SERVER in env — watchdog disabled')

    # Trade-queue worker — single execution engine for queued /trade requests.
    queue_task = asyncio.create_task(_trade_queue_worker())
    logger.info('MT5 bridge: trade queue worker started')

    # Queue cleanup — evicts expired done/failed items every 5 minutes.
    cleanup_task = asyncio.create_task(_queue_cleanup_loop())
    logger.info('MT5 bridge: queue cleanup task started')

    yield

    ready_task.cancel()
    try:    await ready_task
    except: pass
    if wd_task is not None:
        wd_task.cancel()
        try:    await wd_task
        except: pass
    queue_task.cancel()
    try:    await queue_task
    except: pass
    cleanup_task.cancel()
    try:    await cleanup_task
    except: pass
    mt5 = _mt5
    if mt5 is not None:
        try: mt5.shutdown()
        except Exception: pass


WATCHDOG_INTERVAL_S    = _safe_int_env('WATCHDOG_INTERVAL_S',    30)
WATCHDOG_MAX_FAILURES  = _safe_int_env('WATCHDOG_MAX_FAILURES',  3)
# How often the always-on readiness watchdog re-probes terminal liveness.
# Legacy override kept for backward compat — prefer MT5_RECONNECT_MIN_S.
MT5_READY_PROBE_INTERVAL_S = _safe_int_env('MT5_READY_PROBE_INTERVAL_S', 15)
# Exponential-backoff reconnect bounds for the readiness watchdog.
# Min = healthy-state probe interval. Max = worst-case retry on failure.
MT5_RECONNECT_MIN_S = _safe_int_env('MT5_RECONNECT_MIN_S', 5)
MT5_RECONNECT_MAX_S = _safe_int_env('MT5_RECONNECT_MAX_S', 30)
# Max seconds the trade queue worker waits for MT5 before failing the item.
TRADE_QUEUE_TIMEOUT_S = _safe_int_env('TRADE_QUEUE_TIMEOUT_S', 120)
# How long to retain done/failed queue items before eviction (seconds).
QUEUE_TTL_S = _safe_int_env('QUEUE_TTL_S', 3600)
# Grace window after process start where liveness probe never returns degraded.
# Prevents the orchestrator from killing us while MT5 terminal is warming up.
STARTUP_GRACE_S = _safe_int_env('STARTUP_GRACE_S', 30)


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


async def _readiness_watchdog_loop() -> None:
    """Always-on terminal-liveness watchdog with exponential backoff.

    When the terminal is healthy the probe runs every
    MT5_RECONNECT_MIN_S (default 5 s). On failure the interval backs
    off: 5 -> 10 -> 20 -> 30 s (MT5_RECONNECT_MAX_S cap). Resets to the
    minimum on the first successful probe. Updates both `mt5_ready` and
    `_terminal_connected`. Never crashes itself."""
    global mt5_ready, _terminal_connected
    backoff_s: float = MT5_RECONNECT_MIN_S
    while True:
        try:
            await asyncio.sleep(backoff_s)
            ok = await _probe_mt5(timeout_s=min(10, int(backoff_s)))
            if ok != mt5_ready:
                level = logger.info if ok else logger.warning
                level(
                    f'readiness watchdog: mt5_ready {mt5_ready} -> {ok} '
                    f'(backoff={backoff_s:.0f}s)'
                )
                mt5_ready = ok
                # Notify the trade-queue worker that MT5 came back.
                if ok:
                    _trade_queue_signal.set()
            # Track broker connection from terminal_info when available.
            if ok and _mt5 is not None:
                try:
                    info = _mt5.terminal_info()
                    _terminal_connected = bool(info and info.connected)
                except Exception:
                    _terminal_connected = False
            else:
                _terminal_connected = False
            # Backoff: reset on success, double on failure (capped).
            if ok:
                backoff_s = MT5_RECONNECT_MIN_S
            else:
                backoff_s = min(backoff_s * 2, MT5_RECONNECT_MAX_S)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning(f'readiness watchdog error (continuing): {e}')


async def _trade_queue_worker() -> None:
    """Single execution worker that drains _trade_queue_store in FIFO
    order. Enforces the single-MT5-instance rule — no parallel sends.
    Waits up to TRADE_QUEUE_TIMEOUT_S for MT5 to become ready before
    failing an item. Never crashes itself."""
    while True:
        try:
            await _trade_queue_signal.wait()
            while True:
                # Find oldest pending item (FIFO).
                async with _trade_queue_lock:
                    pending = sorted(
                        [t for t in _trade_queue_store.values() if t.status == 'pending'],
                        key=lambda t: t.enqueued_at,
                    )
                    if not pending:
                        _trade_queue_signal.clear()
                        break
                    item = pending[0]
                    item.status = 'executing'

                # Wait for MT5 readiness up to the timeout.
                wait_start = time.time()
                while not mt5_ready:
                    if (time.time() - wait_start) >= TRADE_QUEUE_TIMEOUT_S:
                        break
                    await asyncio.sleep(2.0)

                if not mt5_ready:
                    async with _trade_queue_lock:
                        item.status = 'failed'
                        item.error  = f'MT5 not ready after {TRADE_QUEUE_TIMEOUT_S}s timeout'
                        item.completed_at = time.time()
                    logger.warning(
                        f'trade queue: {item.queue_id} failed — MT5 timeout '
                        f'({TRADE_QUEUE_TIMEOUT_S}s)'
                    )
                    continue

                # Execute the queued trade through the standard handler.
                try:
                    result = await submit_order(item.req)
                    async with _trade_queue_lock:
                        item.status       = 'done'
                        item.result       = result
                        item.completed_at = time.time()
                    logger.info(
                        f'trade queue: {item.queue_id} executed — '
                        f'{item.req.side} {item.req.symbol}'
                    )
                except HTTPException as exc:
                    async with _trade_queue_lock:
                        item.status       = 'failed'
                        item.error        = str(exc.detail)
                        item.completed_at = time.time()
                except Exception as exc:
                    async with _trade_queue_lock:
                        item.status       = 'failed'
                        item.error        = str(exc)
                        item.completed_at = time.time()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f'trade queue worker unexpected error: {exc}')
            await asyncio.sleep(1.0)


async def _queue_cleanup_loop() -> None:
    """Background eviction: remove done/failed queue items older than
    QUEUE_TTL_S so the in-memory store doesn't grow without bound.
    Runs every 5 minutes. Never crashes itself."""
    while True:
        try:
            await asyncio.sleep(300)
            cutoff = time.time() - QUEUE_TTL_S
            async with _trade_queue_lock:
                expired = [
                    qid for qid, item in _trade_queue_store.items()
                    if item.status in ('done', 'failed')
                    and item.completed_at is not None
                    and item.completed_at < cutoff
                ]
                for qid in expired:
                    del _trade_queue_store[qid]
            if expired:
                logger.info(f'queue cleanup: evicted {len(expired)} expired items')
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f'queue cleanup error (continuing): {exc}')


app = FastAPI(title='AlgoSphere MT5 Bridge', version='1.3.0', lifespan=lifespan)


# ─── Request-logging middleware ────────────────────────────────────────

@app.middleware('http')
async def _log_requests(request: Request, call_next):
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as e:
        ms = int((time.perf_counter() - started) * 1000)
        logger.error(f'{request.method} {request.url.path} -> EXC ({ms}ms): {e}')
        raise
    ms = int((time.perf_counter() - started) * 1000)
    if response.status_code >= 500:
        logger.error(f'{request.method} {request.url.path} -> {response.status_code} ({ms}ms)')
    elif response.status_code >= 400:
        logger.warning(f'{request.method} {request.url.path} -> {response.status_code} ({ms}ms)')
    else:
        logger.info(f'{request.method} {request.url.path} -> {response.status_code} ({ms}ms)')
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
        if not mt5.login(login, password=password, server=server, timeout=5_000):
            err = mt5.last_error()
            _current_login = None
            try:
                mt5.shutdown()  # reset IPC state so next initialize() works cleanly
            except Exception:
                pass
            return False, f'login failed: {err}'
        _current_login = login
        return True, None

    return await asyncio.to_thread(_do)


@asynccontextmanager
async def _mt5_session(login: int, password: str, server: str):
    """Acquire _MT5_LOCK (15 s) and log in (45 s) for one HTTP request.

    Raises:
        503  bridge busy  — lock held longer than 15 s
        504  MT5 timeout  — initialize/login did not return within 45 s
        400  login failed — MT5 rejected the credentials
    """
    try:
        await asyncio.wait_for(_MT5_LOCK.acquire(), timeout=15.0)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail='bridge busy — MT5 lock held too long')
    try:
        try:
            ok, err = await asyncio.wait_for(
                _ensure_login(login, password, server), timeout=45.0
            )
        except asyncio.TimeoutError:
            try:
                _load_mt5().shutdown()
            except Exception:
                pass
            raise HTTPException(status_code=504, detail='MT5 unresponsive — login timed out')
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        yield
    finally:
        _MT5_LOCK.release()


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
        'service_uptime_s': int(time.time() - SERVICE_STARTED_AT),
        'mt5_ready':        mt5_ready,
        'bridge_ready':     mt5_ready,   # alias — spec name for the same flag
        'terminal_connected': _terminal_connected,
        'mt5_connected':    mt5_connected,
        'execution_ready':  bool(wd['execution_ready']) if creds_configured else False,
        'account':          wd['account'],
        'equity':           wd['equity'],
        'consec_failures':  wd['consec_failures'],
        'last_ok_age_s':    last_ok_age_s,
        'pin_login':        PIN_LOGIN,
        'current_login':    _current_login,
        'creds_configured': creds_configured,
        'dependencies':     _dep_report,
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
        # ── Trade queue ─────────────────────────────
        'trade_queue': {
            'pending':  sum(1 for t in _trade_queue_store.values() if t.status == 'pending'),
            'executing':sum(1 for t in _trade_queue_store.values() if t.status == 'executing'),
            'done':     sum(1 for t in _trade_queue_store.values() if t.status == 'done'),
            'failed':   sum(1 for t in _trade_queue_store.values() if t.status == 'failed'),
            'total':    len(_trade_queue_store),
        },
        # Legacy alias — older clients may still read `time`
        'time':             time.time(),
    }


@app.get('/health/live')
async def health_live():
    """Process liveness probe — always returns 200 while the process is
    running. No auth required so orchestrators (k8s, Docker HEALTHCHECK,
    load balancers) can call it without a key.

    This is a LIVENESS probe: it answers "is the process alive?" and
    should NEVER return 503 for dependency failures (MT5 down). Returning
    503 here would cause the orchestrator to kill and restart the bridge,
    losing the in-memory queue and the single-instance lock — exactly
    what we don't want during an MT5 reconnect cycle.

    Use /health/ready for the READINESS probe (returns 503 until MT5 is
    connected and ready to accept trades).

    /health returns the full diagnostic payload for dashboards."""
    pending_count = sum(
        1 for t in _trade_queue_store.values() if t.status == 'pending'
    )
    in_grace = (time.time() - SERVICE_STARTED_AT) < STARTUP_GRACE_S
    return {
        'live':               True,
        'mt5_ready':          mt5_ready,
        'terminal_connected': _terminal_connected,
        'queued_trades':      pending_count,
        'uptime_s':           int(time.time() - SERVICE_STARTED_AT),
        'startup_grace':      in_grace,
    }


@app.get('/health/ready')
async def health_ready():
    """Readiness probe — returns 503 until the MT5 terminal is reachable
    and the bridge is ready to execute trades. Use this endpoint for load
    balancer health checks that should stop routing traffic when MT5 is
    unavailable. No auth required."""
    pending_count = sum(
        1 for t in _trade_queue_store.values() if t.status == 'pending'
    )
    uptime = int(time.time() - SERVICE_STARTED_AT)
    if not mt5_ready:
        return JSONResponse(
            status_code=503,
            content={
                'ready':              False,
                'mt5_ready':          False,
                'terminal_connected': _terminal_connected,
                'queued_trades':      pending_count,
                'uptime_s':           uptime,
            },
        )
    return {
        'ready':              True,
        'mt5_ready':          True,
        'terminal_connected': _terminal_connected,
        'queued_trades':      pending_count,
        'uptime_s':           uptime,
    }


@app.post('/connect', dependencies=[Depends(_verify_bridge_key)])
async def connect(req: ConnectRequest):
    """Handshake — used by the engine's /brokers/test endpoint to
    verify credentials before the user sees a 'connected' badge."""
    async with _mt5_session(req.login, req.password, req.server):
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
    async with _mt5_session(req.login, req.password, req.server):
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
    + fill details so the engine can compute slippage + reconcile.

    Last-line safety: rejects orders that violate MAX_LOT_LIMIT, the
    per-minute rate limit, or aren't in the broker's live symbol list
    BEFORE any MT5 order call. These are guardrails — the signal-engine
    has its own 12-gate risk stack upstream.

    Validation order (important — keeps 422s surfacing even when MT5 is down):
      1. Rate limit (no MT5 needed) → 429
      2. Quantity cap (no MT5 needed) → 422
      3. Side validation buy|sell (no MT5 needed) → 422
      4. MT5 readiness gate → 503
      5. Symbol validation via live cache → 422
      6. MT5 order execution"""
    _rate_limit_check()
    _validate_qty(req.quantity)     # fast: no MT5 needed, validates before 503 gate
    if req.side.lower() not in ('buy', 'sell'):
        raise HTTPException(status_code=422, detail=f'side must be buy or sell (got {req.side!r})')
    require_mt5_ready()             # MT5 gate after cheap validation passes
    await _validate_order_safety_async(
        req.login, req.password, req.server, req.symbol, req.quantity,
    )

    async with _mt5_session(req.login, req.password, req.server):
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


@app.post('/cancel', dependencies=[Depends(_verify_bridge_key)])
async def cancel_order(req: CancelRequest):
    """Cancel a pending limit order. For market positions, use /close."""
    require_mt5_ready()
    async with _mt5_session(req.login, req.password, req.server):
        mt5 = _load_mt5()
        request = {'action': mt5.TRADE_ACTION_REMOVE, 'order': int(req.order_id)}
        result = await asyncio.to_thread(mt5.order_send, request)
        return {'cancelled': bool(result and result.retcode == mt5.TRADE_RETCODE_DONE)}


@app.post('/positions', dependencies=[Depends(_verify_bridge_key)])
async def positions(req: AccountRequest):
    async with _mt5_session(req.login, req.password, req.server):
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
    require_mt5_ready()
    async with _mt5_session(req.login, req.password, req.server):
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


class ClosedDealsRequest(AccountRequest):
    # Unix epoch seconds. Bridge selects deals from this time to "now".
    # Defaults to 30 days back if not supplied — matches
    # broker_reconciler's lookback for the open-set rebuild.
    since: int | None = None


@app.post('/closed_deals', dependencies=[Depends(_verify_bridge_key)])
async def closed_deals(req: ClosedDealsRequest):
    """Returns CLOSED deals from the MT5 history table since `since`.

    Phase 1 of the broker-reality enrichment: the reconciler currently
    detects "position closed" by noticing it vanished from
    positions_get(), but has no way to learn HOW it closed (exit price,
    realized pnl, commission, swap). Those fields live in the deal
    history record, which requires HistorySelect() + HistoryDealsGet()
    to fetch.

    Returns ONE row per closing position_id (deduplicated). The closing
    deal is the one with entry in {DEAL_ENTRY_OUT, DEAL_ENTRY_OUT_BY},
    where profit/commission/swap are populated. Opening deals
    (DEAL_ENTRY_IN) are ignored — they have no exit metrics.

    Exception handling: any unhandled error inside the dedup loop used
    to bubble up as an opaque HTTP 500, leaving the reconciler with no
    way to diagnose. We now catch it, log the full traceback bridge-side,
    and return a 500 whose JSON body includes the exception class + the
    last few stack frames so the reconciler log line is actionable.
    """
    import traceback as _tb
    from datetime import datetime, timezone, timedelta
    since_ts = req.since if req.since is not None else int(
        (datetime.now(timezone.utc) - timedelta(days=30)).timestamp()
    )
    async with _mt5_session(req.login, req.password, req.server):
        mt5 = _load_mt5()

        from_dt = datetime.fromtimestamp(since_ts, tz=timezone.utc)
        to_dt   = datetime.now(timezone.utc)

        try:
            ok = await asyncio.to_thread(mt5.history_select, from_dt, to_dt)
            if not ok:
                return {'deals': [], 'count': 0, 'note': 'history_select returned False'}

            rows = await asyncio.to_thread(mt5.history_deals_get, from_dt, to_dt) or []

            # Closing deals only — these carry exit price, profit, commission, swap.
            # entry values:
            #   DEAL_ENTRY_IN     (0) → opening (no exit metrics; skip)
            #   DEAL_ENTRY_OUT    (1) → closing
            #   DEAL_ENTRY_INOUT  (2) → reversal: closes one position, opens another
            #   DEAL_ENTRY_OUT_BY (3) → offset close
            DEAL_ENTRY_OUT     = getattr(mt5, 'DEAL_ENTRY_OUT',     1)
            DEAL_ENTRY_INOUT   = getattr(mt5, 'DEAL_ENTRY_INOUT',   2)
            DEAL_ENTRY_OUT_BY  = getattr(mt5, 'DEAL_ENTRY_OUT_BY',  3)
            CLOSE_ENTRIES = {DEAL_ENTRY_OUT, DEAL_ENTRY_INOUT, DEAL_ENTRY_OUT_BY}

            # Deduplicate by position_id. If multiple closing deals exist
            # (partial closes), keep the latest one — it has the cumulative
            # realized state of the position from the broker's perspective.
            by_pos: dict[str, dict] = {}
            for d in rows:
                # Field-by-field: any individual deal that's malformed
                # (missing entry, position_id, ticket, etc.) gets skipped
                # rather than failing the whole batch.
                try:
                    entry = getattr(d, 'entry', None)
                    if entry is None or entry not in CLOSE_ENTRIES:
                        continue
                    posid = str(getattr(d, 'position_id', '') or '')
                    if posid in ('', '0'):
                        continue
                    this_time = int(getattr(d, 'time', 0) or 0)
                    if this_time <= 0:
                        continue
                    existing = by_pos.get(posid)
                    if existing is not None and this_time <= existing['time_epoch']:
                        continue
                    entry_type = 'BUY' if getattr(d, 'type', None) == getattr(mt5, 'DEAL_TYPE_BUY', 0) else 'SELL'
                    by_pos[posid] = {
                        'position_id':  posid,
                        'deal_id':      int(getattr(d, 'ticket', 0) or 0),
                        'symbol':       getattr(d, 'symbol', '') or '',
                        'volume':       float(getattr(d, 'volume', 0) or 0),
                        'entry_type':   entry_type,
                        'price':        float(getattr(d, 'price', 0) or 0),
                        'profit':       float(getattr(d, 'profit', 0) or 0),
                        'commission':   float(getattr(d, 'commission', 0) or 0),
                        'swap':         float(getattr(d, 'swap', 0) or 0),
                        'time_epoch':   this_time,
                        # ISO-8601 UTC for the wire — broker_reconciler
                        # serialises datetimes the same way elsewhere.
                        'time':         datetime.fromtimestamp(this_time, tz=timezone.utc)
                                                .isoformat().replace('+00:00', 'Z'),
                    }
                except Exception as e_row:
                    logger.warning(f'closed_deals: skipped malformed deal: {type(e_row).__name__}: {e_row}')
                    continue

            deals = list(by_pos.values())
            # Sort newest-first so consumers can take the first match cheaply.
            deals.sort(key=lambda d: d['time_epoch'], reverse=True)
            # Strip the helper field from the wire payload.
            for d in deals:
                d.pop('time_epoch', None)

            return {'deals': deals, 'count': len(deals), 'raw_count': len(rows)}
        except HTTPException:
            raise
        except Exception as e:
            tb = _tb.format_exc()
            logger.error(f'closed_deals: unhandled error since={since_ts} login={req.login}: {tb}')
            raise HTTPException(
                status_code=500,
                detail={
                    'error': f'{type(e).__name__}: {e}',
                    'since': since_ts,
                    # Last 4 stack frames — enough to localise without
                    # leaking full bridge internals.
                    'trace': tb.splitlines()[-12:],
                },
            )


@app.post('/symbol_spec', dependencies=[Depends(_verify_bridge_key)])
async def symbol_spec(req: SymbolRequest):
    async with _mt5_session(req.login, req.password, req.server):
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
    async with _mt5_session(req.login, req.password, req.server):
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


@app.post('/trade/place', dependencies=[Depends(_verify_bridge_key)])
async def trade_place(req: TradePlaceRequest):
    """Single-account place-order using .env credentials.

    If MT5 is ready: executes immediately and returns 200.
    If MT5 is not ready: queues the trade and returns 202 with a
    queue_id. Poll /trade/status/{queue_id} to track execution.
    Never rejects — only queues or executes.

    Direction validated BEFORE the creds check so callers always get 422
    for invalid direction, even when no default creds are configured."""
    side = req.direction.lower()
    if side not in ('buy', 'sell'):
        raise HTTPException(
            status_code=422,
            detail=f'direction must be BUY or SELL (got {req.direction!r})',
        )
    login, password, server = _require_default_creds()

    order_req = OrderRequest(
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
    )

    # Fast path — MT5 is up, execute now.
    if mt5_ready and _terminal_connected:
        return await submit_order(order_req)

    # Slow path — MT5 not ready, queue the trade for deferred execution.
    qid  = uuid.uuid4().hex[:12]
    item = _QueuedTrade(queue_id=qid, req=order_req)
    async with _trade_queue_lock:
        _trade_queue_store[qid] = item
    _trade_queue_signal.set()
    logger.info(
        f'trade queued (mt5_ready={mt5_ready} connected={_terminal_connected}): '
        f'queue_id={qid} {side} {req.symbol} {req.lot} lots'
    )
    return JSONResponse(
        status_code=202,
        content={
            'status':     'queued',
            'queue_id':   qid,
            'symbol':     req.symbol,
            'side':       side,
            'lot':        req.lot,
            'message':    'MT5 not ready — trade queued. Poll /trade/status/{queue_id} for result.',
            'poll_url':   f'/trade/status/{qid}',
        },
    )


@app.post('/trade/close', dependencies=[Depends(_verify_bridge_key), Depends(require_mt5_ready)])
async def trade_close(req: TradeCloseRequest):
    """Close a specific OPEN position by its broker ticket. Different
    from /cancel (which removes pending orders) and /close_all (which
    flattens everything)."""
    login, password, server = _require_default_creds()
    async with _mt5_session(login, password, server):
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


@app.get('/trade/status/{queue_id}', dependencies=[Depends(_verify_bridge_key)])
async def trade_status(queue_id: str):
    """Poll the status of a queued trade submitted via /trade/place when
    MT5 was unavailable. Returns the execution result once done, or the
    current queue position if still pending."""
    async with _trade_queue_lock:
        item = _trade_queue_store.get(queue_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f'queue_id {queue_id!r} not found')

    pending_before = sum(
        1 for t in _trade_queue_store.values()
        if t.status == 'pending' and t.enqueued_at < item.enqueued_at
    )
    return {
        'queue_id':     item.queue_id,
        'status':       item.status,
        'enqueued_at':  item.enqueued_at,
        'completed_at': item.completed_at,
        'queue_position': pending_before if item.status == 'pending' else 0,
        'result':       item.result,
        'error':        item.error or None,
        'mt5_ready':    mt5_ready,
    }


@app.get('/account', dependencies=[Depends(_verify_bridge_key)])
async def get_account():
    """Stateless GET — uses .env creds. Returns the current account's
    equity / balance / open-position count + the watchdog's freshness
    indicator so a single curl tells you whether the bridge is healthy."""
    login, password, server = _require_default_creds()
    async with _mt5_session(login, password, server):
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
    async with _mt5_session(login, password, server):
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

# Processes the operator typically cares about. start_runtime.py is the
# new session-aware entry point; start.py is the legacy NSSM launcher.
# Both are listed so the dashboard shows which generation is active.
EXPECTED_PROCESSES = [
    'start_runtime.py',   # new user-session entry point (Phase 2)
    'start.py',           # legacy NSSM entry point (deprecated)
    'bridge.py',          # this service (loaded by the entry points above)
    'uvicorn',            # ASGI server hosting bridge.py
    'cloudflared',        # Cloudflare tunnel (exposes bridge over HTTPS)
    'terminal64.exe',     # MT5 terminal (Windows x64)
    'terminal.exe',       # MT5 terminal (legacy 32-bit)
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


# ───────────────────────────────────────────────────────────────────────
# /system/* alias namespace
# ───────────────────────────────────────────────────────────────────────
# Operator-facing alternate paths. Same handlers as the bare endpoints
# above — exposes them under a /system/ prefix for ops scripts that
# prefer a clearer namespace ("everything under /system is internal
# monitoring, never user-facing"). Trading endpoints (/order, /trade/*)
# stay at the root since they're business APIs, not system telemetry.

@app.get('/system/health')
async def system_health():
    return await health()

@app.get('/system/status')
async def system_status():
    """Alias for /health — the spec calls this 'status' since it
    answers the "is the whole stack OK?" question."""
    return await health()

@app.get('/system/processes', dependencies=[Depends(_verify_bridge_key)])
async def system_processes():
    return await list_processes()

@app.get('/system/logs', dependencies=[Depends(_verify_bridge_key)])
async def system_logs(lines: int = 50):
    return await get_recent_logs(lines)


# ───────────────────────────────────────────────────────────────────────
# Phase 6 — Final state validation
# ───────────────────────────────────────────────────────────────────────

@app.get('/system/validate', dependencies=[Depends(_verify_bridge_key)])
async def system_validate():
    """Phase 6 production-grade validation snapshot.

    Checks all the conditions the spec requires before declaring the
    system fully operational:
      - status = ok
      - single active runtime PID (lock file matches this process)
      - no orphan ports (no unexpected listening sockets from this PID)
      - MT5 stable OR execution engine active
      - zero degraded state loops (watchdog consec_failures == 0)

    Returns status='ok' only if ALL conditions pass."""
    import psutil

    pid = os.getpid()
    bridge_port = int(os.environ.get('BRIDGE_PORT', '8000'))

    # ── Single-instance check ───────────────────────────────────────────
    # Primary lock is runtime/bridge.lock; start_runtime.py falls back to
    # %TEMP%/algosphere_bridge.lock when the primary is ACL-locked by a
    # previous elevated session.  Check both so the single_instance flag
    # stays True regardless of which lock path was actually used.
    _lock_candidates = [
        pathlib.Path(__file__).resolve().parent / 'runtime' / 'bridge.lock',
        pathlib.Path(os.environ.get('TEMP', os.environ.get('TMP', 'C:\\Temp')))
        / 'algosphere_bridge.lock',
    ]
    lock_pid:   Optional[int] = None
    single_instance = False
    try:
        for _lp in _lock_candidates:
            if _lp.exists():
                _lpid = int(_lp.read_text().strip() or '0')
                if _lpid == pid:
                    lock_pid = _lpid
                    single_instance = True
                    break
                if lock_pid is None:
                    lock_pid = _lpid  # keep first found for reporting
    except Exception:
        pass

    # ── Orphan port check ───────────────────────────────────────────────
    # Any LISTENING socket owned by this PID that isn't the bridge port.
    orphan_ports: list[int] = []
    try:
        def _get_conns():
            return psutil.net_connections(kind='inet')
        for conn in await asyncio.to_thread(_get_conns):
            if (conn.pid == pid
                    and conn.status == psutil.CONN_LISTEN
                    and conn.laddr
                    and conn.laddr.port != bridge_port):
                orphan_ports.append(conn.laddr.port)
    except Exception:
        pass

    # ── Trade queue depth ───────────────────────────────────────────────
    queue_depth = sum(1 for t in _trade_queue_store.values() if t.status == 'pending')

    # ── Degraded loop check ─────────────────────────────────────────────
    consec_failures  = _watchdog_state.get('consec_failures', 0)
    execution_ready  = bool(_watchdog_state.get('execution_ready', False))
    creds_configured = _default_creds() is not None

    all_ok = (
        mt5_ready
        and single_instance
        and not orphan_ports
        and consec_failures == 0
        and queue_depth == 0
    )
    status = 'ok' if all_ok else 'degraded'

    return {
        'status':            status,
        'pid':               pid,
        'lock_pid':          lock_pid,
        'single_instance':   single_instance,
        'mt5_ready':         mt5_ready,
        'terminal_connected': _terminal_connected,
        'execution_ready':   execution_ready if creds_configured else None,
        'consec_failures':   consec_failures,
        'orphan_ports':      orphan_ports,
        'trade_queue_depth': queue_depth,
        'uptime_s':          int(time.time() - SERVICE_STARTED_AT),
        'checks': {
            'mt5_ready':       mt5_ready,
            'single_instance': single_instance,
            'no_orphan_ports': not orphan_ports,
            'watchdog_clean':  consec_failures == 0,
            'queue_empty':     queue_depth == 0,
        },
    }
