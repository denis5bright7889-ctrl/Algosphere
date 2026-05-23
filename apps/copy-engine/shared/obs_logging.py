"""
copy-engine — structured JSON logging.

One call at worker startup (configure_logging) switches loguru to emit
one JSON object per line, with the active trace context (trace_id,
job_id, user_id, strategy_id, broker, position_id) merged into every
record automatically via a patcher reading the tracing contextvars.

JSON logs are what Grafana/Loki, CloudWatch, and Railway's log drains
parse for free — no regex. Local dev can flip ALGOSPHERE_LOG_PRETTY=1
for human-readable colored output instead.
"""
from __future__ import annotations
import os
import sys

from loguru import logger

from shared import tracing


def _patch_trace(record) -> None:
    """Merge the current trace context into record['extra'] so every line
    carries it whether or not the call site passed it explicitly."""
    ctx = tracing.current()
    if ctx is not None:
        for k, v in ctx.as_log_fields().items():
            record['extra'].setdefault(k, v)


def configure_logging(service: str, level: str | None = None) -> None:
    level = (level or os.environ.get('ALGOSPHERE_LOG_LEVEL', 'INFO')).upper()
    pretty = os.environ.get('ALGOSPHERE_LOG_PRETTY', '').lower() in ('1', 'true', 'yes')

    logger.remove()
    logger.configure(patcher=_patch_trace, extra={'service': service})

    if pretty:
        logger.add(
            sys.stdout, level=level, backtrace=True, diagnose=False,
            format='<green>{time:HH:mm:ss.SSS}</green> | <level>{level: <7}</level> '
                   '| <cyan>{extra[service]}</cyan> | {message} '
                   '| <dim>{extra}</dim>',
        )
    else:
        # serialize=True → one JSON object per line, including extra{}.
        logger.add(sys.stdout, level=level, serialize=True,
                   backtrace=True, diagnose=False)

    logger.info(f'logging configured (service={service}, level={level}, json={not pretty})')
