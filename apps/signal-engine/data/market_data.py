"""
AlgoSphere Market Data Provider Abstraction
Broker-independent OHLCV fetching with automatic fallback chain.
Provider priority: Twelve Data → Polygon → Alpha Vantage
"""
from __future__ import annotations
import asyncio
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional
import httpx
from loguru import logger
from engine.feature_engineer import OHLCVBar


class MarketDataProvider(ABC):
    """Abstract base for all market data providers."""

    @abstractmethod
    async def fetch_ohlcv(
        self, symbol: str, interval: str, outputsize: int = 300
    ) -> list[OHLCVBar]:
        ...

    @abstractmethod
    async def fetch_live_price(self, symbol: str) -> Optional[float]:
        ...

    async def get_spread(self, symbol: str) -> float:
        """Returns approximate spread in pips. Override for real bid/ask."""
        return 2.0

    async def get_market_status(self) -> bool:
        """Returns True if market is open. Default assumes always open."""
        return True


# ─── Twelve Data ────────────────────────────────────────────────────────────

TWELVE_INTERVAL_MAP = {
    '1m': '1min', '5m': '5min', '15m': '15min',
    '1h': '1h', '4h': '4h', '1d': '1day',
}

TWELVE_SYMBOL_MAP = {
    'XAUUSD': 'XAU/USD', 'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD',
    'USDJPY': 'USD/JPY', 'GBPJPY': 'GBP/JPY', 'AUDUSD': 'AUD/USD',
    'USDCAD': 'USD/CAD', 'XAGUSD': 'XAG/USD', 'US30': 'DJI',
    'NAS100': 'NDX',
    # Phase-1 FX expansion. Explicit mappings required: the naive
    # symbol.replace('USD','/USD') fallback breaks USD-first pairs
    # ('USDCHF' -> '/USDCHF') and crosses ('EURJPY' stays 'EURJPY').
    'NZDUSD': 'NZD/USD', 'USDCHF': 'USD/CHF',
    'EURJPY': 'EUR/JPY', 'EURGBP': 'EUR/GBP',
    # Metals — TwelveData free tier serves spot metals like gold/silver.
    # (XPT/XPD also resolve via the 6-char fallback, but explicit is clearer.)
    'XPTUSD': 'XPT/USD', 'XPDUSD': 'XPD/USD',
    # Energy — 5-char tickers need explicit mapping or _serves() skips them.
    # Free-tier coverage of energy is NOT guaranteed; if TD returns empty the
    # symbol is marked OFFLINE in /health/symbols (never fabricated).
    'USOIL': 'WTI/USD', 'UKOIL': 'BZ',   # WTI + Brent (BZ) — verified on TD Grow
    # Phase-2 indices expansion (2026-06). Free-tier coverage of indices on
    # TD is plan-dependent — some return 'plan_does_not_allow' even with a
    # valid key. Explicit mapping ensures _serves() lets the request through;
    # if TD declines, the fallback chain hands it to Polygon (I:SPX, I:DAX,
    # I:UKX). Never fabricated — empty bars → OFFLINE in symbol health.
    'SPX500': 'SPX',     # S&P 500
    'GER40':  'DAX',     # DAX 40
    'UK100':  'UKX',     # FTSE 100
}


class TwelveDataProvider(MarketDataProvider):
    BASE = 'https://api.twelvedata.com'

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._client = httpx.AsyncClient(timeout=15.0)

    def _serves(self, symbol: str) -> bool:
        """True if this provider can serve the symbol on the current plan.

        The TwelveData Basic (free) plan covers FX / metals only — indices,
        equities, ETFs and crypto either return an error or aren't entitled.
        Every API attempt (even a failure) burns 1 of the 800 daily credits,
        so we MUST early-return for unsupported asset classes. Mirrors the
        Coinbase pattern (`[] for non-crypto`).

        Rule:
          - Symbols mapped in TWELVE_SYMBOL_MAP → serve
          - 6-char alphabetic ticker (EURUSD / XAUUSD pattern) → serve
          - Anything else (1-5 char equity tickers like AAPL, …USDT crypto,
            I:NDX indices, etc.) → do NOT call the API
        """
        s = symbol.upper()
        if s in TWELVE_SYMBOL_MAP:
            return True
        if len(s) == 6 and s.isalpha():
            return True
        return False

    async def fetch_ohlcv(self, symbol: str, interval: str, outputsize: int = 300) -> list[OHLCVBar]:
        if not self._serves(symbol):
            return []  # skip the API call — preserves the daily credit budget
        td_symbol = TWELVE_SYMBOL_MAP.get(symbol, symbol.replace('USD', '/USD'))
        td_interval = TWELVE_INTERVAL_MAP.get(interval, interval)
        params = {
            'symbol': td_symbol,
            'interval': td_interval,
            'outputsize': min(outputsize, 5000),
            'apikey': self.api_key,
            'format': 'JSON',
            'order': 'ASC',
        }
        try:
            resp = await self._client.get(f'{self.BASE}/time_series', params=params)
            resp.raise_for_status()
            data = resp.json()
            if data.get('status') == 'error':
                logger.warning(f"TwelveData error for {symbol}: {data.get('message')}")
                return []
            values = data.get('values', [])
            return [OHLCVBar(
                timestamp=v['datetime'],
                open=float(v['open']),
                high=float(v['high']),
                low=float(v['low']),
                close=float(v['close']),
                volume=float(v.get('volume', 0) or 0),
            ) for v in values]
        except Exception as e:
            logger.error(f"TwelveData fetch failed for {symbol}: {e}")
            return []

    async def fetch_live_price(self, symbol: str) -> Optional[float]:
        if not self._serves(symbol):
            return None  # same credit-preservation as fetch_ohlcv
        td_symbol = TWELVE_SYMBOL_MAP.get(symbol, symbol)
        try:
            resp = await self._client.get(
                f'{self.BASE}/price',
                params={'symbol': td_symbol, 'apikey': self.api_key},
            )
            data = resp.json()
            return float(data.get('price', 0)) or None
        except Exception:
            return None


# ─── Alpha Vantage fallback ─────────────────────────────────────────────────

AV_INTERVAL_MAP = {'1m': '1min', '5m': '5min', '15m': '15min', '1h': '60min'}


class AlphaVantageProvider(MarketDataProvider):
    BASE = 'https://www.alphavantage.co/query'

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._client = httpx.AsyncClient(timeout=20.0)

    async def fetch_ohlcv(self, symbol: str, interval: str, outputsize: int = 300) -> list[OHLCVBar]:
        av_interval = AV_INTERVAL_MAP.get(interval, '60min')
        from_sym = symbol[:3]
        to_sym   = symbol[3:] if len(symbol) == 6 else 'USD'
        params = {
            'function': 'FX_INTRADAY',
            'from_symbol': from_sym,
            'to_symbol': to_sym,
            'interval': av_interval,
            'outputsize': 'full' if outputsize > 100 else 'compact',
            'apikey': self.api_key,
        }
        try:
            resp = await self._client.get(self.BASE, params=params)
            data = resp.json()
            key = f'Time Series FX ({av_interval})'
            series = data.get(key, {})
            bars = sorted(series.items())[-outputsize:]
            return [OHLCVBar(
                timestamp=ts,
                open=float(v['1. open']),
                high=float(v['2. high']),
                low=float(v['3. low']),
                close=float(v['4. close']),
            ) for ts, v in bars]
        except Exception as e:
            logger.error(f"AlphaVantage fetch failed for {symbol}: {e}")
            return []

    async def fetch_live_price(self, symbol: str) -> Optional[float]:
        bars = await self.fetch_ohlcv(symbol, '1m', 1)
        return bars[-1].close if bars else None


# ─── Coinbase (crypto, keyless, US-region safe) ─────────────────────────────

COINBASE_GRANULARITY = {'1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1d': 86400}

# Engine crypto symbols (Binance-style …USDT) → Coinbase product ids.
# Anything not listed here falls through to the `…USDT` -> `…-USD` fallback
# in _product(); explicit entries are kept for documentation + to lock in
# the intended product id for symbols where the naive strip wouldn't work.
COINBASE_PRODUCT_MAP = {
    'BTCUSDT': 'BTC-USD', 'ETHUSDT':  'ETH-USD', 'SOLUSDT': 'SOL-USD',
    'XRPUSDT': 'XRP-USD', 'ADAUSDT':  'ADA-USD', 'DOGEUSDT': 'DOGE-USD',
    'AVAXUSDT':'AVAX-USD','LINKUSDT': 'LINK-USD','LTCUSDT': 'LTC-USD',
    'DOTUSDT': 'DOT-USD', 'BCHUSDT':  'BCH-USD',
}


class CoinbaseProvider(MarketDataProvider):
    """Crypto OHLCV via the public Coinbase Exchange API (no key).

    Why Coinbase and not Binance: the engine runs in a US region (Railway
    us-west); Binance REST returns HTTP 451 to US IPs, so the server can't
    use it. Coinbase is US-domiciled and works. Returns [] for any
    non-crypto symbol so the fallback chain hands forex/metals to Twelve
    Data.
    """

    BASE = 'https://api.exchange.coinbase.com'

    def __init__(self):
        self._client = httpx.AsyncClient(
            timeout=15.0, headers={'User-Agent': 'algosphere-engine'})

    def _product(self, symbol: str) -> Optional[str]:
        if symbol in COINBASE_PRODUCT_MAP:
            return COINBASE_PRODUCT_MAP[symbol]
        if symbol.endswith('USDT'):
            return f'{symbol[:-4]}-USD'
        return None

    async def fetch_ohlcv(self, symbol: str, interval: str, outputsize: int = 300) -> list[OHLCVBar]:
        product = self._product(symbol)
        if not product:
            return []  # not crypto — defer to another provider
        gran = COINBASE_GRANULARITY.get(interval, 3600)
        try:
            resp = await self._client.get(
                f'{self.BASE}/products/{product}/candles',
                params={'granularity': gran},
            )
            resp.raise_for_status()
            rows = resp.json()
            if not isinstance(rows, list):
                return []
            # Coinbase candle = [time, low, high, open, close, volume], newest-first.
            bars = [OHLCVBar(
                timestamp=datetime.utcfromtimestamp(int(r[0])).strftime('%Y-%m-%d %H:%M:%S'),
                open=float(r[3]), high=float(r[2]), low=float(r[1]),
                close=float(r[4]), volume=float(r[5]),
            ) for r in rows[:outputsize] if isinstance(r, list) and len(r) >= 6]
            bars.reverse()  # → ASC (oldest→newest), matching Twelve Data's order
            return bars
        except Exception as e:
            logger.error(f"Coinbase fetch failed for {symbol} ({product}): {e}")
            return []

    async def fetch_live_price(self, symbol: str) -> Optional[float]:
        product = self._product(symbol)
        if not product:
            return None
        try:
            resp = await self._client.get(f'{self.BASE}/products/{product}/ticker')
            data = resp.json()
            return float(data.get('price', 0)) or None
        except Exception:
            return None


# ─── Polygon.io (institutional multi-asset backbone) ───────────────────────
#
# Aggregates endpoint: /v2/aggs/ticker/{ticker}/range/1/hour/{from}/{to}
# Polygon prefixes the ticker by asset class:
#   forex/metals  C:EURUSD   C:XAUUSD   C:GBPUSD ...
#   crypto        X:BTCUSD   X:ETHUSD   X:SOLUSD ...     (drop the …T)
#   indices       I:NDX      I:SPX      I:DJI ...
#   equities      AAPL       MSFT       (no prefix)
#
# Polygon serves every asset class in one chain, which is why it slots in as
# the multi-asset fallback after TwelveData. On the current 'Stocks Starter'-
# class plan, data is end-of-15-min delayed (status: DELAYED) — fine for
# 1h-bar regime classification, since the newest closed hourly bar is well
# outside the delay window. Some symbols (SPX, DJI) require a higher plan
# and return NOT_AUTHORIZED; those are silently treated as [] so the chain
# tries the next provider rather than crashing.

POLYGON_INTERVAL_MAP = {
    '1m': (1, 'minute'), '5m': (5, 'minute'), '15m': (15, 'minute'),
    '1h': (1, 'hour'),   '4h': (4, 'hour'),   '1d': (1, 'day'),
}

# Calendar-day lookback per interval. Sized to comfortably exceed 300 bars
# for equities (which only trade ~6.5h/day, Mon-Fri); crypto/FX which trade
# nearly 24/7 will simply have extra bars trimmed by `outputsize`.
POLYGON_LOOKBACK_DAYS = {
    '1m': 7, '5m': 14, '15m': 30, '1h': 90, '4h': 180, '1d': 730,
}


class PolygonProvider(MarketDataProvider):
    """Multi-asset OHLCV via Polygon.io (a.k.a. 'Massive' in this stack).

    Returns [] (not an exception) for any symbol the current plan isn't
    authorized for, so the fallback chain moves on cleanly.
    """

    BASE = 'https://api.polygon.io'

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._client = httpx.AsyncClient(timeout=15.0)

    def _ticker(self, symbol: str) -> Optional[str]:
        """Map engine symbol → Polygon ticker. Returns None for unmappable."""
        s = symbol.upper()
        # Crypto: …USDT → X:…USD
        if s.endswith('USDT'):
            return f'X:{s[:-4]}USD'
        # 6-char forex/metals: EURUSD, XAUUSD, GBPUSD, etc. → C:EURUSD
        if len(s) == 6 and s.isalpha():
            return f'C:{s}'
        # Indices (engine convention: prefix 'I:' or known names)
        if s.startswith('I:'):
            return s
        if s in {'SPX','NDX','DJI','RUT','VIX','GER40','UK100','JPN225','NAS100','US30','SPX500'}:
            # Engine-friendly names → Polygon index tickers
            #   NAS100 → NDX, US30 → DJI, SPX500 → SPX
            # GER40/UK100/JPN225 pass through as-is (Polygon may decline on
            # current plan; chain moves on if so — never fabricated).
            return f'I:{ {"NAS100":"NDX","US30":"DJI","SPX500":"SPX"}.get(s, s) }'
        # Equities: plain ticker (AAPL, MSFT, TSLA, SPY, QQQ ...)
        if s.isalpha() and 1 <= len(s) <= 5:
            return s
        return None

    async def fetch_ohlcv(self, symbol: str, interval: str, outputsize: int = 300) -> list[OHLCVBar]:
        ticker = self._ticker(symbol)
        if not ticker:
            return []
        mult, unit = POLYGON_INTERVAL_MAP.get(interval, (1, 'hour'))
        # YYYY-MM-DD format reliably returns the full window across all
        # asset classes. Epoch-ms in the URL silently truncates responses
        # on this plan tier — verified empirically (10 bars vs 88 for AAPL).
        from datetime import timedelta
        today = datetime.utcnow().date()
        from_d = (today - timedelta(days=POLYGON_LOOKBACK_DAYS.get(interval, 90))).isoformat()
        to_d   = today.isoformat()
        url = f'{self.BASE}/v2/aggs/ticker/{ticker}/range/{mult}/{unit}/{from_d}/{to_d}'
        try:
            resp = await self._client.get(url, params={
                'adjusted': 'true', 'sort': 'asc', 'limit': min(outputsize * 2, 5000),
                'apiKey': self.api_key,
            })
            if resp.status_code == 403:
                # NOT_AUTHORIZED — plan doesn't cover this symbol; let chain move on.
                return []
            resp.raise_for_status()
            data = resp.json()
            status = data.get('status')
            if status not in ('OK', 'DELAYED'):
                # ERROR / NOT_AUTHORIZED / etc. — degrade silently.
                logger.debug(f"Polygon non-OK status for {symbol} ({ticker}): {status} {data.get('error','')}")
                return []
            rows = data.get('results') or []
            bars = [OHLCVBar(
                timestamp=datetime.utcfromtimestamp(int(r['t']) / 1000).strftime('%Y-%m-%d %H:%M:%S'),
                open=float(r['o']), high=float(r['h']), low=float(r['l']),
                close=float(r['c']), volume=float(r.get('v', 0) or 0),
            ) for r in rows[-outputsize:] if 'o' in r and 'c' in r]
            return bars
        except Exception as e:
            logger.error(f"Polygon fetch failed for {symbol} ({ticker}): {e}")
            return []

    async def fetch_live_price(self, symbol: str) -> Optional[float]:
        bars = await self.fetch_ohlcv(symbol, '1m', 2)
        return bars[-1].close if bars else None


# ─── Provider factory with fallback chain ───────────────────────────────────

class FallbackDataProvider(MarketDataProvider):
    """Tries providers in order until one returns data."""

    def __init__(self, providers: list[MarketDataProvider]):
        self.providers = providers

    async def fetch_ohlcv(self, symbol: str, interval: str, outputsize: int = 300) -> list[OHLCVBar]:
        for provider in self.providers:
            bars = await provider.fetch_ohlcv(symbol, interval, outputsize)
            if bars:
                return bars
            logger.warning(f"Provider {provider.__class__.__name__} returned no data for {symbol}")
        logger.error(f"All providers failed for {symbol}")
        return []

    async def fetch_live_price(self, symbol: str) -> Optional[float]:
        for provider in self.providers:
            price = await provider.fetch_live_price(symbol)
            if price:
                return price
        return None


# Bar-interval → seconds, for cache freshness (a fetch is reused until a new
# candle of this interval should have closed).
INTERVAL_SECONDS = {
    '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '4h': 14400, '1d': 86400,
}


# Symbol data-availability states (observability + completeness weighting).
#   ACTIVE   — fresh live bars this cycle, OR hot-cache within half the TTL
#   DEGRADED — served from the in-memory hot cache (still within TTL, but the
#              latest upstream attempt was empty / not refreshed this cycle)
#   STALE    — served from the persistent store on a cold start (real bars,
#              but old — upstream is currently down/quota-capped)
#   OFFLINE  — no bars anywhere (live, hot, or persistent)
# completeness_for() maps these to a [0.3, 1.0] factor the engine multiplies
# into the weighted score, so a symbol on stale data contributes less —
# never structurally blocked, just dampened.
_COMPLETENESS = {'ACTIVE': 1.0, 'DEGRADED': 0.85, 'STALE': 0.5, 'OFFLINE': 0.0}


class CachedDataProvider(MarketDataProvider):
    """Two-tier OHLCV cache wrapping the fallback chain.

      L2 (hot)  — in-memory dict keyed by (symbol, interval); serves closed
                  candles within their interval TTL (cuts upstream calls and
                  keeps TwelveData under its 800/day cap).
      L1 (warm) — OPTIONAL persistent Supabase store (PersistentOHLCVStore).
                  Survives deploys: on a cold start where every live provider
                  is empty (e.g. TD quota exhausted right after a restart),
                  the last-known REAL candles are served from the store
                  instead of blanking the symbol. The durable fix for the
                  cold-start partial-universe outage.

    Resolution order on fetch:
      1. hot cache (fresh within TTL)        → ACTIVE / DEGRADED
      2. live providers                      → ACTIVE (writes through to L1+L2)
      3. hot cache (stale, upstream empty)   → DEGRADED
      4. persistent store (cold start)       → STALE  (NOT written to hot cache,
                                                so upstream is retried next cycle)
      5. nothing anywhere                    → OFFLINE → []

    Graceful: if no persistent store is configured, behaviour is identical to
    the previous in-memory-only cache. Never raises.
    """

    # A live fetch must return at least this many bars to be treated as
    # "good" (overwrite cache + persist). TwelveData intermittently returns
    # thin responses (e.g. 10 bars) under load; those must NOT poison a
    # richer cached/persisted set or the symbol would skip on the pipeline's
    # 50-bar floor. Set just above that floor for margin.
    _MIN_USABLE_BARS = 60

    def __init__(self, inner: MarketDataProvider, store=None):
        self.inner = inner
        self._cache: dict[tuple[str, str], tuple[list[OHLCVBar], float]] = {}
        self._store = store
        # Per-(symbol, interval) last status for observability + completeness.
        self._status: dict[tuple[str, str], dict] = {}

    def _mark(self, key, status: str, bar_count: int, last_candle_ts: Optional[str]) -> None:
        self._status[key] = {
            'symbol':         key[0],
            'interval':       key[1],
            'data_status':    status,
            'bar_count':      bar_count,
            'last_candle_ts': last_candle_ts,
            'last_update':    datetime.now(timezone.utc).isoformat(),
        }

    async def fetch_ohlcv(self, symbol: str, interval: str, outputsize: int = 300) -> list[OHLCVBar]:
        key = (symbol, interval)
        now = datetime.now().timestamp()
        ttl = INTERVAL_SECONDS.get(interval, 3600)

        # 1. Hot cache, fresh within TTL.
        cached = self._cache.get(key)
        if cached and (now - cached[1]) < ttl:
            fresh = (now - cached[1]) < ttl * 0.5
            self._mark(key, 'ACTIVE' if fresh else 'DEGRADED', len(cached[0]),
                       cached[0][-1].timestamp if cached[0] else None)
            return cached[0]

        # 2. Live providers. A GOOD fetch (>= MIN_USABLE bars) overwrites the
        #    cache + persists; a thin/empty fetch falls through to richer data.
        bars = await self.inner.fetch_ohlcv(symbol, interval, outputsize)
        if len(bars) >= self._MIN_USABLE_BARS:
            self._cache[key] = (bars, now)
            self._mark(key, 'ACTIVE', len(bars), bars[-1].timestamp)
            if self._store:
                self._store.save(symbol, interval, bars, provider='live')
            return bars

        thin = 'thin(%d)' % len(bars) if bars else 'empty'

        # 3. Hot cache — prefer it when it's richer than what upstream gave.
        if cached and len(cached[0]) >= max(len(bars), self._MIN_USABLE_BARS):
            age = int(now - cached[1])
            logger.warning(f"OHLCV cache: upstream {thin} for {symbol} — serving hot "
                           f"cache ({len(cached[0])} bars, age {age}s)")
            self._mark(key, 'DEGRADED', len(cached[0]),
                       cached[0][-1].timestamp if cached[0] else None)
            return cached[0]

        # 4. Persistent store (cold start — survives deploys). Prefer it when
        #    richer; do NOT warm the hot cache so upstream is retried next cycle.
        if self._store:
            loaded = self._store.load(symbol, interval)
            if loaded and len(loaded[0]) >= max(len(bars), self._MIN_USABLE_BARS):
                pbars, last_ts = loaded
                logger.warning(f"OHLCV cold-start: {symbol} upstream {thin} — serving "
                               f"{len(pbars)} persisted bars (last {last_ts})")
                self._mark(key, 'STALE', len(pbars), last_ts)
                return pbars

        # 5. Nothing richer available. Return whatever upstream gave (even thin)
        #    so the pipeline's own 50-bar floor decides; cache it in memory only
        #    (do NOT persist a thin set — the store stays clean of poisoned data).
        if bars:
            self._cache[key] = (bars, now)
            self._mark(key, 'DEGRADED', len(bars), bars[-1].timestamp)
            return bars
        self._mark(key, 'OFFLINE', 0, None)
        return []

    def completeness_for(self, symbol: str, interval: str) -> float:
        """Data-completeness factor ∈ [0.3, 1.0] for the engine's weighted
        score. Stale/degraded data dampens (never blocks) a symbol's signal."""
        st = self._status.get((symbol, interval))
        if not st:
            return 1.0
        return max(0.3, _COMPLETENESS.get(st['data_status'], 1.0)) if st['data_status'] != 'OFFLINE' else 0.0

    def symbol_health(self) -> list[dict]:
        """Snapshot of every symbol's data status (internal observability)."""
        return list(self._status.values())

    async def fetch_live_price(self, symbol: str) -> Optional[float]:
        return await self.inner.fetch_live_price(symbol)

    async def get_spread(self, symbol: str) -> float:
        return await self.inner.get_spread(symbol)


def build_provider(settings) -> Optional[MarketDataProvider]:
    """Builds the provider chain.

    Order is deliberate, not preference-ordered:
      1. Coinbase   — crypto only, keyless, real-time. Serves …USDT, [] else.
      2. TwelveData — FX/metals real-time. Hard-capped 800 credits/day on
         the Basic plan, so it's first for the asset classes it serves but
         WILL stop responding once the daily cap is exhausted.
      3. Polygon    — the institutional multi-asset backbone. Serves FX,
         metals, crypto, equities, AND indices in one chain. Status is
         'DELAYED' (~15 min) on the current plan, which is fine for 1h-bar
         classification but means it sits AFTER real-time TD/Coinbase for
         the asset classes they cover. It is the ONLY path for equities
         and indices, so adding it unlocks SPY/AAPL/NDX-style cards.
      4. AlphaVantage — FX emergency only (~25 req/day free tier).

    This means the engine ALWAYS has a usable provider for crypto even
    without keys, and gains equity/index coverage the moment Polygon is
    configured (POLYGON_API_KEY env var).
    """
    providers: list[MarketDataProvider] = [CoinbaseProvider()]
    if settings.twelve_data_api_key:
        providers.append(TwelveDataProvider(settings.twelve_data_api_key))
    if settings.polygon_api_key:
        providers.append(PolygonProvider(settings.polygon_api_key))
    if settings.alpha_vantage_api_key:
        providers.append(AlphaVantageProvider(settings.alpha_vantage_api_key))

    # L1 persistent store (optional) — survives deploys so the hot cache no
    # longer cold-starts empty. Best-effort: if Supabase isn't configured or
    # the table is absent, the store no-ops and the cache is in-memory only.
    store = None
    if getattr(settings, 'has_supabase', False):
        try:
            from supabase import create_client
            from data.ohlcv_store import PersistentOHLCVStore
            client = create_client(settings.supabase_url, settings.supabase_service_role_key)
            store = PersistentOHLCVStore(client)
            logger.info("OHLCV persistent store (L1) enabled")
        except Exception as e:
            logger.warning(f"OHLCV persistent store unavailable — in-memory only: {e}")

    # Wrap the chain: L2 hot cache + optional L1 persistent backing.
    return CachedDataProvider(FallbackDataProvider(providers), store=store)
