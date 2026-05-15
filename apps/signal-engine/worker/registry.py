"""Shared singleton registry so api/routes can access the running worker without circular imports."""
from __future__ import annotations
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from worker.signal_worker import SignalWorker

_worker: Optional['SignalWorker'] = None


def set_worker(w: 'SignalWorker') -> None:
    global _worker
    _worker = w


def get_worker() -> Optional['SignalWorker']:
    return _worker
