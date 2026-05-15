"""
AlgoSphere Market Data Provider Abstraction
Broker-independent OHLCV fetching with automatic fallback chain.
Provider priority: Twelve Data → Polygon → Alpha Vantage
"""
from __future__ import annotations
import asyncio
from abc import ABC, abstractmethod
from datetime import datetime
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
}


class TwelveDataProvider(MarketDataProvider):
    BASE = 'https://api.twelvedata.com'

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._client = httpx.AsyncClient(timeout=15.0)

    async def fetch_ohlcv(self, symbol: str, interval: str, outputsize: int = 300) -> list[OHLCVBar]:
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


def build_provider(settings) -> Optional[FallbackDataProvider]:
    """Builds the provider chain based on available API keys."""
    providers: list[MarketDataProvider] = []
    if settings.twelve_data_api_key:
        providers.append(TwelveDataProvider(settings.twelve_data_api_key))
    if settings.alpha_vantage_api_key:
        providers.append(AlphaVantageProvider(settings.alpha_vantage_api_key))
    return FallbackDataProvider(providers) if providers else None
