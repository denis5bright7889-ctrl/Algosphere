"""
start.py — the ONE entry point for the AlgoSphere MT5 bridge.

This is the fix for the "port-8000 loop / multiple python.exe /
auto-respawn" symptoms. The rule it enforces:

    There is exactly ONE bridge process. Everything (FastAPI, the
    MT5 watchdog, the guardian gate) lives INSIDE it as asyncio
    tasks. There are NO separate watchdog.py / guardian.py processes.

How it guarantees a single instance:
  1. PID-file lock at runtime/bridge.lock. If the file exists AND its
     PID is alive AND /health responds → another bridge is already
     running → we exit 0 cleanly (idempotent; safe to run from NSSM
     or a scheduled task without spawning a duplicate).
  2. Port-8000 owner check (psutil). If 8000 is held by a process
     that is NOT our healthy bridge, we LOG the offending PID +
     cmdline and exit 1 — we do NOT blindly kill it (per the strict
     rule). A stale lock from a dead PID is cleaned up automatically.
  3. We then run uvicorn IN-PROCESS with workers=1, reload=False.
     This process IS the server — no subprocess fan-out, so there is
     never more than one python.exe for the bridge.

Run it with:  py start.py
NSSM / Task Scheduler should launch `py start.py`, NOT `uvicorn`
directly — otherwise the single-instance guard is bypassed.
"""
from __future__ import annotations
import os
import sys
import atexit
import socket
import pathlib

from loguru import logger

HOST = os.environ.get('BRIDGE_HOST', '127.0.0.1')
PORT = int(os.environ.get('BRIDGE_PORT', '8000'))

_RUNTIME_DIR = pathlib.Path(__file__).resolve().parent / 'runtime'
_LOCK_PATH   = _RUNTIME_DIR / 'bridge.lock'
_HEALTH_URL  = f'http://{HOST}:{PORT}/health'


# ─── Liveness helpers ──────────────────────────────────────────────────

def _health_responds(timeout: float = 2.0) -> bool:
    """True if something answers /health on our host:port."""
    try:
        import httpx
        r = httpx.get(_HEALTH_URL, timeout=timeout)
        return r.status_code == 200
    except Exception:
        return False


def _pid_alive(pid: int) -> bool:
    try:
        import psutil
        return psutil.pid_exists(pid)
    except Exception:
        # Without psutil, assume alive (conservative — we'd rather not
        # double-launch than risk it). Fall back to the health probe.
        return True


def _port_owner(port: int):
    """Return (pid, cmdline) of whoever holds `port`, or (None, None)."""
    try:
        import psutil
        for conn in psutil.net_connections(kind='inet'):
            if conn.laddr and conn.laddr.port == port and conn.status == psutil.CONN_LISTEN:
                pid = conn.pid
                if pid:
                    try:
                        return pid, ' '.join(psutil.Process(pid).cmdline())
                    except Exception:
                        return pid, '<unknown cmdline>'
        return None, None
    except Exception:
        return None, None


def _port_is_free(host: str, port: int) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
    try:
        s.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


# ─── Single-instance guard ─────────────────────────────────────────────

def _acquire_single_instance() -> bool:
    """Return True if WE may start the bridge; False if another healthy
    bridge already owns it (caller should exit 0)."""
    _RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Existing lock?
    if _LOCK_PATH.exists():
        try:
            existing_pid = int(_LOCK_PATH.read_text().strip() or '0')
        except Exception:
            existing_pid = 0
        if existing_pid and _pid_alive(existing_pid) and _health_responds():
            logger.info(f'start.py: bridge already running (pid={existing_pid}, /health ok) — nothing to do')
            return False
        # Stale lock (dead pid or no health) → reclaim it.
        logger.warning(f'start.py: stale lock (pid={existing_pid}) — reclaiming')
        try: _LOCK_PATH.unlink()
        except Exception: pass

    # 2. Port held by someone else?
    if not _port_is_free(HOST, PORT):
        # Is it actually our healthy bridge (lock was missing but server up)?
        if _health_responds():
            logger.info(f'start.py: port {PORT} already serving a healthy bridge — nothing to do')
            return False
        pid, cmd = _port_owner(PORT)
        logger.error(
            f'start.py: port {PORT} is occupied by a NON-bridge process '
            f'(pid={pid}, cmd={cmd!r}). Refusing to start. '
            f'Investigate/stop that process manually — start.py will NOT kill it.'
        )
        return False

    # 3. Claim the lock.
    _LOCK_PATH.write_text(str(os.getpid()))
    atexit.register(_release_lock)
    logger.info(f'start.py: single-instance lock acquired (pid={os.getpid()})')
    return True


def _release_lock() -> None:
    try:
        if _LOCK_PATH.exists() and _LOCK_PATH.read_text().strip() == str(os.getpid()):
            _LOCK_PATH.unlink()
    except Exception:
        pass


# ─── Entry ─────────────────────────────────────────────────────────────

def main() -> int:
    # Dependency gate first — lenient; never blocks unless a REQUIRED
    # dep is unusable (in which case uvicorn couldn't import anyway).
    try:
        from dependency_guard import check_dependencies, log_report
        report = check_dependencies()
        log_report(report, logger)
        if report.fatal:
            logger.error(f'start.py: cannot start — required deps unusable: {report.fatal}')
            return 1
    except Exception as e:
        # The guard itself must never block startup.
        logger.warning(f'start.py: dependency_guard skipped ({e})')

    if not _acquire_single_instance():
        return 0   # another healthy instance owns it — idempotent no-op

    logger.info(f'start.py: launching uvicorn (workers=1, reload=False) on {HOST}:{PORT}')
    import uvicorn
    # workers=1 + reload=False is NON-NEGOTIABLE: the MT5 terminal is a
    # singleton and all state (locks, current_login, caches) is in-process.
    uvicorn.run(
        'bridge:app',
        host=HOST,
        port=PORT,
        workers=1,
        reload=False,
        log_level=os.environ.get('UVICORN_LOG_LEVEL', 'info'),
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
