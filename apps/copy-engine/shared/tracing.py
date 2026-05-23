"""
copy-engine — distributed trace context.

A single trace_id follows one signal from the bus through fan-out,
risk, allocation, routing, and the broker fill. It is minted on the
signal_events row (DB default) and propagated by the orchestrator onto
every copy_jobs row; the executor binds it for the duration of a job so
every log line and metric label carries it.

Implementation: contextvars, so each asyncio task gets its own isolated
trace context without threading ids through every function signature.
obs_logging reads these vars via a loguru patcher; nothing else needs to
know they exist.
"""
from __future__ import annotations
import uuid
import contextvars
from dataclasses import dataclass, asdict
from typing import Optional

_trace_ctx: contextvars.ContextVar[Optional["TraceContext"]] = \
    contextvars.ContextVar('algosphere_trace_ctx', default=None)


@dataclass
class TraceContext:
    trace_id:    str
    worker:      Optional[str] = None
    job_id:      Optional[str] = None
    user_id:     Optional[str] = None      # follower
    strategy_id: Optional[str] = None
    broker:      Optional[str] = None
    position_id: Optional[str] = None      # broker order/position id once known

    def as_log_fields(self) -> dict:
        # Drop Nones so log lines stay tidy.
        return {k: v for k, v in asdict(self).items() if v is not None}


def new_trace_id() -> str:
    return str(uuid.uuid4())


def set_context(ctx: TraceContext) -> contextvars.Token:
    """Install a trace context for the current task. Returns a token to
    restore the previous context (use in a finally, or via trace_scope)."""
    return _trace_ctx.set(ctx)


def reset_context(token: contextvars.Token) -> None:
    _trace_ctx.reset(token)


def current() -> Optional[TraceContext]:
    return _trace_ctx.get()


def bind(**fields) -> None:
    """Mutate the current context in place (e.g. attach position_id once
    the broker returns it). No-op if no context is installed."""
    ctx = _trace_ctx.get()
    if ctx is None:
        return
    for k, v in fields.items():
        if hasattr(ctx, k) and v is not None:
            setattr(ctx, k, v)


class trace_scope:
    """Context manager: install a TraceContext for a block, restore on exit.

        with trace_scope(TraceContext(trace_id=..., job_id=...)):
            ...   # all logs/metrics in here carry the trace
    """
    def __init__(self, ctx: TraceContext):
        self._ctx = ctx
        self._token: Optional[contextvars.Token] = None

    def __enter__(self) -> TraceContext:
        self._token = set_context(self._ctx)
        return self._ctx

    def __exit__(self, *exc) -> None:
        if self._token is not None:
            reset_context(self._token)
