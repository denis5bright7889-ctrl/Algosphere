"""
Persistent OHLCV store (L1) — Supabase-backed last-known candles.

Survives engine deploys: a fresh container reads the last good bars from
Supabase instead of cold-starting empty, so an exhausted provider quota no
longer blinds FX/metals. Best-effort throughout — a store failure (table
missing, network, etc.) is swallowed and the caller degrades to the
in-memory hot cache only. Never raises into a scan.

Honesty: persists ONLY real candles a provider actually returned. It never
synthesises or interpolates bars.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
from loguru import logger
from engine.feature_engineer import OHLCVBar

# Cap stored bars per row — comfortably exceeds the 300-bar working window
# while bounding row size.
MAX_STORE_BARS = 320


class PersistentOHLCVStore:
    """Thin Supabase wrapper for the ohlcv_cache table. All ops best-effort."""

    def __init__(self, client):
        self._db = client

    def load(self, symbol: str, interval: str) -> Optional[tuple[list[OHLCVBar], str]]:
        """Return (bars, last_candle_ts) from the store, or None on miss/error."""
        try:
            res = (self._db.table('ohlcv_cache')
                   .select('bars,last_candle_ts')
                   .eq('symbol', symbol).eq('interval', interval)
                   .limit(1).execute())
            rows = res.data or []
            if not rows:
                return None
            raw = rows[0].get('bars') or []
            bars = [OHLCVBar(
                timestamp=b['t'], open=float(b['o']), high=float(b['h']),
                low=float(b['l']), close=float(b['c']), volume=float(b.get('v', 0) or 0),
            ) for b in raw if isinstance(b, dict) and 't' in b]
            if not bars:
                return None
            last_ts = rows[0].get('last_candle_ts') or bars[-1].timestamp
            return bars, last_ts
        except Exception as e:
            logger.debug(f"ohlcv_store load failed {symbol}/{interval}: {e}")
            return None

    def save(self, symbol: str, interval: str, bars: list[OHLCVBar], provider: str = '') -> None:
        if not bars:
            return
        try:
            trimmed = bars[-MAX_STORE_BARS:]
            payload = {
                'symbol':   symbol,
                'interval': interval,
                'bars': [{'t': b.timestamp, 'o': b.open, 'h': b.high,
                          'l': b.low, 'c': b.close, 'v': b.volume} for b in trimmed],
                'bar_count':      len(trimmed),
                'last_candle_ts': trimmed[-1].timestamp,
                'provider':       provider,
                # Set explicitly: the column default only fires on INSERT, and
                # this is an UPSERT — we want updated_at to refresh every write.
                'updated_at':     datetime.now(timezone.utc).isoformat(),
            }
            self._db.table('ohlcv_cache').upsert(
                payload, on_conflict='symbol,interval').execute()
        except Exception as e:
            logger.debug(f"ohlcv_store save failed {symbol}/{interval}: {e}")
