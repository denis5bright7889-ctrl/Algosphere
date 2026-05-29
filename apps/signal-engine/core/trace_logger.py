"""
Per-cycle structured execution trace.

Every scan cycle, per symbol, emits one JSONL row recording exactly
where the pipeline stopped. The /api/v1/diagnostics/trading endpoint
tails this file to surface a real rejection breakdown — "no silent
failures" (spec section 11).

Design notes
------------
- Off by default. Enable with EXECUTION_TRACE_ENABLED=1. Production
  may toggle this temporarily when debugging.
- Append-only, line-buffered JSON-lines at logs/execution_trace.jsonl.
  Path overridable via EXECUTION_TRACE_PATH.
- Bounded: rotates when the file exceeds EXECUTION_TRACE_MAX_BYTES
  (default 10 MB) to a `.1` rollover. Single retention; older drops.
- Never raises. Any IO failure is swallowed — the trace logger must
  never wedge the worker.

Row shape (all keys always present so the consumer can filter cheaply)
---------------------------------------------------------------------
    {
        ts:                     iso-timestamp,
        symbol:                 str,
        timeframe:              str,
        bars_loaded:            int,
        regime:                 str | null,
        confidence_score:       int | null,
        ensemble_score:         float | null,
        ensemble_voted:         [str, ...],
        rejected_by:            str | null,   # e.g. 'insufficient_bars',
                                              # 'no_consensus', 'gate.confidence',
                                              # 'risk.13_per_symbol_cap',
                                              # 'dry_run', 'published'
        rejection_reason:       str | null,
        gate_passed:            bool,
        risk_gates_passed:      int | null,
        risk_gates_failed:      [str, ...] | null,
        execution_attempted:    bool,
        mt5_retcode:            int | null,
        latency_ms:             int | null,
    }
"""
from __future__ import annotations
import json
import os
import pathlib
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional
from loguru import logger


ENABLED = os.environ.get('EXECUTION_TRACE_ENABLED', '').lower() in ('1', 'true', 'yes')
TRACE_PATH = pathlib.Path(os.environ.get('EXECUTION_TRACE_PATH', 'logs/execution_trace.jsonl'))
MAX_BYTES = int(os.environ.get('EXECUTION_TRACE_MAX_BYTES', str(10 * 1024 * 1024)))

_lock = threading.Lock()
_inited = False


def _ensure_dir() -> None:
    global _inited
    if _inited:
        return
    try:
        TRACE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _inited = True
    except Exception as e:
        logger.warning(f"trace_logger: cannot create {TRACE_PATH.parent}: {e}")


def _rotate_if_needed() -> None:
    try:
        if not TRACE_PATH.exists():
            return
        if TRACE_PATH.stat().st_size <= MAX_BYTES:
            return
        rollover = TRACE_PATH.with_suffix(TRACE_PATH.suffix + '.1')
        try:
            if rollover.exists():
                rollover.unlink()
        except Exception:
            pass
        TRACE_PATH.rename(rollover)
    except Exception as e:
        logger.debug(f"trace_logger: rotation failed: {e}")


def emit(row: dict) -> None:
    """Append one trace row. Never raises; never blocks the worker."""
    if not ENABLED:
        return
    _ensure_dir()
    # Required keys with sane defaults — keeps the consumer simple.
    payload = {
        'ts':                   datetime.now(timezone.utc).isoformat(),
        'symbol':               None,
        'timeframe':            None,
        'bars_loaded':          0,
        'regime':               None,
        'confidence_score':     None,
        'ensemble_score':       None,
        'ensemble_voted':       [],
        'rejected_by':          None,
        'rejection_reason':     None,
        'gate_passed':          False,
        'risk_gates_passed':    None,
        'risk_gates_failed':    None,
        'execution_attempted':  False,
        'mt5_retcode':          None,
        'latency_ms':           None,
    }
    payload.update({k: v for k, v in row.items() if k in payload})
    try:
        with _lock:
            _rotate_if_needed()
            with TRACE_PATH.open('a', encoding='utf-8') as f:
                f.write(json.dumps(payload, default=str) + '\n')
    except Exception as e:
        # One-time noisy log per launch is fine; never throw.
        logger.debug(f"trace_logger.emit failed: {e}")


def is_enabled() -> bool:
    return ENABLED


def path_str() -> str:
    return str(TRACE_PATH)
