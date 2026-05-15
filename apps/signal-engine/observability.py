"""
AlgoSphere Signal Engine — Observability
Configures structured JSON logging (loguru) and basic request metrics.
"""
from __future__ import annotations
import sys
import time
from loguru import logger
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


def configure_logging(environment: str = 'production') -> None:
    """Configure loguru for structured JSON output in production, pretty in dev."""
    logger.remove()

    if environment == 'development':
        logger.add(
            sys.stderr,
            level='DEBUG',
            colorize=True,
            format='<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | {message}',
        )
    else:
        logger.add(
            sys.stdout,
            level='INFO',
            serialize=True,   # JSON output for log aggregators (Railway, Datadog, etc.)
            enqueue=True,     # async-safe
        )


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Logs every request with method, path, status, and duration."""

    async def dispatch(self, request: Request, call_next) -> Response:
        t0 = time.monotonic()
        response = await call_next(request)
        duration_ms = int((time.monotonic() - t0) * 1000)

        if not request.url.path.startswith('/ws'):
            logger.info(
                f"{request.method} {request.url.path} → {response.status_code} ({duration_ms}ms)"
            )
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Simple in-process IP-based rate limiter for REST endpoints.
    Allows up to `max_requests` per `window_seconds` per IP.
    WebSocket connections are excluded — they're long-lived by design.
    """

    def __init__(self, app, max_requests: int = 60, window_seconds: int = 60):
        super().__init__(app)
        self._max = max_requests
        self._window = window_seconds
        self._buckets: dict[str, list[float]] = {}

    async def dispatch(self, request: Request, call_next) -> Response:
        # Skip WebSocket upgrades
        if request.headers.get('upgrade', '').lower() == 'websocket':
            return await call_next(request)

        # Skip health checks from rate limiting
        if request.url.path == '/api/v1/health':
            return await call_next(request)

        ip = request.client.host if request.client else 'unknown'
        now = time.monotonic()
        window_start = now - self._window

        hits = self._buckets.get(ip, [])
        hits = [t for t in hits if t > window_start]
        hits.append(now)
        self._buckets[ip] = hits

        # Prune old entries to avoid unbounded growth
        if len(self._buckets) > 10_000:
            self._buckets = {k: v for k, v in self._buckets.items() if v}

        if len(hits) > self._max:
            from fastapi.responses import JSONResponse
            return JSONResponse(
                {'detail': 'Rate limit exceeded'},
                status_code=429,
                headers={'Retry-After': str(self._window)},
            )

        return await call_next(request)
