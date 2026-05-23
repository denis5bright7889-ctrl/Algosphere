"""
copy-engine — Redis Streams dispatch bus (low-latency wakeup).

The durable system of record is Postgres `copy_jobs` (claimed via
SKIP LOCKED). Redis sits IN FRONT as a wakeup signal so executors react
in milliseconds instead of waiting out a fixed poll interval:

  • orchestrator XADDs one tiny message per fan-out ("there is work").
  • executors XREADGROUP-BLOCK on the stream; on a message (or timeout)
    they run the authoritative SKIP LOCKED claim to get actual work.

Crucially, Redis is an OPTIMIZATION, not a source of truth. The message
carries no job state — only a nudge. If Redis is down, a message is lost,
or REDIS_URL is unset, executors fall back to plain interval polling and
nothing is dropped (the claim query still finds every queued row). This
preserves the "durable queue only / no new hard dependency" invariant.

Backpressure-friendly: XADD uses approximate MAXLEN trimming so the
stream can't grow unbounded under a 10k-follower fan-out burst.
"""
from __future__ import annotations
from typing import Optional

from loguru import logger

try:
    import redis.asyncio as aioredis
    _REDIS_LIB = True
except Exception:                       # pragma: no cover
    _REDIS_LIB = False


class QueueBus:
    """Thin wrapper. All methods degrade to no-ops when Redis is
    unavailable so callers never branch on it."""

    def __init__(self, url: str, stream: str, group: str, consumer: str,
                 maxlen: int = 100_000):
        self._url = (url or '').strip()
        self._stream = stream
        self._group = group
        self._consumer = consumer
        self._maxlen = maxlen
        self._r: Optional["aioredis.Redis"] = None

    @property
    def enabled(self) -> bool:
        return bool(self._url) and _REDIS_LIB

    async def connect(self) -> None:
        if not self.enabled:
            logger.info('queue_bus: Redis disabled (no REDIS_URL or redis lib) — '
                        'executors will poll. Durable queue unaffected.')
            return
        try:
            self._r = aioredis.from_url(self._url, encoding='utf-8',
                                        decode_responses=True)
            await self._r.ping()
            # Idempotently create the consumer group at the stream tail.
            try:
                await self._r.xgroup_create(self._stream, self._group,
                                            id='$', mkstream=True)
            except Exception as e:
                if 'BUSYGROUP' not in str(e):
                    raise
            logger.info(f'queue_bus: connected (stream={self._stream}, group={self._group})')
        except Exception as e:
            logger.warning(f'queue_bus: connect failed ({e}) — falling back to polling')
            self._r = None

    async def publish(self, count: int = 1) -> None:
        """Best-effort wakeup nudge after a fan-out. Never raises."""
        if self._r is None:
            return
        try:
            await self._r.xadd(self._stream, {'jobs': str(count)},
                               maxlen=self._maxlen, approximate=True)
        except Exception as e:
            logger.debug(f'queue_bus publish skipped: {e}')

    async def wait_for_work(self, block_ms: int) -> bool:
        """Block up to block_ms for a wakeup. Returns True if nudged (caller
        should claim immediately), False on timeout. Falls through to a
        timeout (caller polls anyway) when Redis is unavailable."""
        if self._r is None:
            # No Redis → behave like a sleep; caller polls on the same cadence.
            import asyncio
            await asyncio.sleep(block_ms / 1000.0)
            return False
        try:
            resp = await self._r.xreadgroup(
                self._group, self._consumer,
                streams={self._stream: '>'}, count=64, block=block_ms)
            if not resp:
                return False
            # ACK everything we read — messages are wakeups, not work units.
            ids = [mid for _stream, msgs in resp for mid, _ in msgs]
            if ids:
                try:
                    await self._r.xack(self._stream, self._group, *ids)
                except Exception:
                    pass
            return True
        except Exception as e:
            logger.debug(f'queue_bus wait_for_work fell back ({e})')
            import asyncio
            await asyncio.sleep(block_ms / 1000.0)
            return False

    async def close(self) -> None:
        if self._r is not None:
            try:
                await self._r.aclose()
            except Exception:
                pass
