"""
start_runtime.py — Phase 2: user-session-only entry point.

Replaces start.py + NSSM as the canonical way to launch the bridge.

Key guarantees
--------------
1. Session guard   — refuses to start in Windows Session 0 (the service
                     desktop where MT5 terminals cannot run). Hard-exits
                     with code 2 so a watchdog knows not to restart.
2. Single instance — same file-lock protocol as start.py (runtime/bridge.lock).
3. NSSM-free       — pure userland; started via Task Scheduler "At log on"
                     or a desktop shortcut, NOT via nssm/sc.
4. No subprocess   — uvicorn runs in-process (workers=1, reload=False).

Migration from start.py + NSSM
-------------------------------
  1. Disable (do NOT delete) the NSSM service:
       nssm set AlgoSphereBridge Start SERVICE_DEMAND_START
     Or mark it manually in services.msc → Startup type = Manual.
  2. Add a Task Scheduler entry:
       Trigger : At log on (your admin account)
       Action  : py C:\Algosphere\apps\mt5-bridge\start_runtime.py
       Settings: Do not start a new instance if already running
  3. Reboot or log off/on — start_runtime.py takes over.

DO NOT run this file in Session 0 (i.e., as a Windows Service directly).
It will refuse and exit cleanly so the SC/NSSM framework knows not to
restart it.
"""
from __future__ import annotations
import atexit
import ctypes
import os
import pathlib
import socket
import sys
import time

# ── Logging ────────────────────────────────────────────────────────────
# Bootstrapped before any other code so we capture session-check failures.
from loguru import logger

_BASE = pathlib.Path(__file__).resolve().parent
_ENV_PATH = _BASE / '.env'
if _ENV_PATH.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_ENV_PATH)
    except ImportError:
        pass

LOG_DIR = pathlib.Path(os.environ.get('LOG_DIR', str(_BASE / 'logs')))
LOG_DIR.mkdir(parents=True, exist_ok=True)
logger.add(
    LOG_DIR / 'start_runtime.log',
    rotation='5 MB',
    retention=5,
    enqueue=True,
    level='INFO',
)

HOST         = os.environ.get('BRIDGE_HOST', '127.0.0.1')
PORT         = int(os.environ.get('BRIDGE_PORT', '8000'))
_RUNTIME_DIR = _BASE / 'runtime'
_LOCK_PATH   = _RUNTIME_DIR / 'bridge.lock'
_HEALTH_URL  = f'http://{HOST}:{PORT}/health'


# ── Session guard ──────────────────────────────────────────────────────

def _current_session_id() -> int:
    """Return the Windows session ID of the calling process.
    Session 0 = service desktop. Session 1+ = interactive user sessions."""
    try:
        pid     = os.getpid()
        session = ctypes.c_ulong(0)
        if ctypes.windll.kernel32.ProcessIdToSessionId(pid, ctypes.byref(session)):
            return session.value
    except Exception as e:
        logger.warning(f'session detection failed: {e} — assuming interactive')
    return 1  # default to interactive if detection fails


def _assert_interactive_session() -> None:
    """Hard-exit if running in Session 0 (Windows service desktop).

    MT5 terminals are COM/GUI processes that require an interactive
    session. Allowing Session 0 execution would silently produce an
    unreachable MT5 terminal and hours of debugging.

    Exit code 2 is chosen deliberately so Task Scheduler / any process
    supervisor knows this is a configuration error, not a transient
    crash to retry immediately."""
    sid = _current_session_id()
    if sid == 0:
        logger.error(
            'start_runtime.py: running in Windows Session 0 (service desktop). '
            'MT5 requires an interactive user session. '
            'Do NOT run this file as a Windows Service. '
            'Use Task Scheduler with "At log on" trigger instead. '
            'Exiting with code 2.'
        )
        sys.exit(2)
    logger.info(f'start_runtime.py: session check passed (session_id={sid})')


# ── Liveness helpers ───────────────────────────────────────────────────

def _health_responds(timeout: float = 2.0) -> bool:
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
        return True


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


def _port_owner(port: int):
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


# ── Single-instance guard ──────────────────────────────────────────────
# The lock file may have been created by an elevated process, giving
# it restrictive ACLs that deny writes from a non-elevated session.
# Strategy: try the standard path first; on PermissionError fall back
# to a user-writable temp path so the guard still works regardless of
# how the previous instance was started.

_FALLBACK_LOCK = pathlib.Path(os.environ.get('TEMP', os.environ.get('TMP', 'C:\\Temp'))) / 'algosphere_bridge.lock'
_active_lock_path: pathlib.Path = _LOCK_PATH   # resolved in _acquire_single_instance


def _try_write_lock(path: pathlib.Path, pid: int) -> bool:
    """Write `pid` to `path`. Returns True on success."""
    try:
        path.write_text(str(pid))
        return True
    except Exception:
        return False


def _acquire_single_instance() -> bool:
    """Return True if this process may start. Returns False (caller exits 0)
    if another healthy instance already owns the lock.

    Checks both _LOCK_PATH (standard) and _FALLBACK_LOCK so it detects
    instances started via the elevated start.py legacy path too."""
    global _active_lock_path
    _RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    # Check both lock paths — elevated start.py uses _LOCK_PATH,
    # this file uses whichever is writable.
    for candidate in (_LOCK_PATH, _FALLBACK_LOCK):
        if not candidate.exists():
            continue
        try:
            existing_pid = int(candidate.read_text().strip() or '0')
        except Exception:
            existing_pid = 0
        if existing_pid and _pid_alive(existing_pid) and _health_responds():
            logger.info(
                f'start_runtime.py: bridge already running '
                f'(pid={existing_pid}, lock={candidate}, /health ok) — nothing to do'
            )
            return False
        # Stale lock — try to remove it (may fail on ACL-locked files).
        logger.warning(f'start_runtime.py: stale lock at {candidate} (pid={existing_pid}) — clearing')
        try:
            candidate.unlink()
        except Exception as e:
            logger.warning(f'start_runtime.py: cannot remove stale lock ({e}) — overwrite attempt follows')

    if not _port_is_free(HOST, PORT):
        if _health_responds():
            logger.info(
                f'start_runtime.py: port {PORT} already serving a healthy bridge — nothing to do'
            )
            return False
        pid, cmd = _port_owner(PORT)
        logger.error(
            f'start_runtime.py: port {PORT} is occupied by a non-bridge process '
            f'(pid={pid}, cmd={cmd!r}). Refusing to start. Investigate manually.'
        )
        return False

    # Write our PID to whichever lock path is writable.
    my_pid = os.getpid()
    if _try_write_lock(_LOCK_PATH, my_pid):
        _active_lock_path = _LOCK_PATH
    elif _try_write_lock(_FALLBACK_LOCK, my_pid):
        _active_lock_path = _FALLBACK_LOCK
        logger.warning(
            f'start_runtime.py: could not write primary lock ({_LOCK_PATH}) — '
            f'using fallback lock at {_FALLBACK_LOCK}'
        )
    else:
        # No writable lock path — proceed anyway since PID is confirmed
        # dead and port is free. Log it so the operator is aware.
        logger.warning(
            'start_runtime.py: could not write any lock file — '
            'proceeding without lock (single-instance guarantee degraded)'
        )
        _active_lock_path = _LOCK_PATH

    atexit.register(_release_lock)
    logger.info(f'start_runtime.py: single-instance lock acquired at {_active_lock_path} (pid={my_pid})')
    return True


def _release_lock() -> None:
    try:
        if _active_lock_path.exists() and _active_lock_path.read_text().strip() == str(os.getpid()):
            _active_lock_path.unlink()
    except Exception:
        pass


# ── Entry point ────────────────────────────────────────────────────────

def main() -> int:
    logger.info('start_runtime.py: AlgoSphere MT5 Bridge — user-session runtime starting')

    # Phase 2 gate: refuse to run in Session 0.
    _assert_interactive_session()

    # Dependency check (lenient — never blocks on optional deps).
    try:
        from dependency_guard import check_dependencies, log_report
        report = check_dependencies()
        log_report(report, logger)
        if report.fatal:
            logger.error(
                f'start_runtime.py: cannot start — required deps missing: {report.fatal}'
            )
            return 1
    except Exception as e:
        logger.warning(f'start_runtime.py: dependency_guard skipped ({e})')

    # Single-instance guard.
    if not _acquire_single_instance():
        return 0

    logger.info(
        f'start_runtime.py: launching uvicorn in-process on {HOST}:{PORT} '
        f'(NSSM-free, user-session only)'
    )
    import uvicorn
    import bridge as _bridge_module

    # In-process, single-worker — preserves the MT5 singleton guarantee
    # and stays in the user session where the terminal is running.
    uvicorn.run(
        _bridge_module.app,
        host=HOST,
        port=PORT,
        reload=False,
        log_level=os.environ.get('UVICORN_LOG_LEVEL', 'info'),
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
