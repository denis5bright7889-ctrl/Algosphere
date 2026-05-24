"""
dependency_guard — boot-time dependency gate for the MT5 bridge.

Design goals (fixes the "false degraded" noise):
  • Distinguish REQUIRED deps (the process literally can't serve) from
    OPTIONAL ones (degrade gracefully, keep /health up).
  • Compatibility = MAJOR version match only. A patch/minor delta
    (httpx 0.27 vs 0.26, pydantic 2.10 vs 2.9) is NOT a problem and
    must never trip a degraded state.
  • NEVER raise for an optional dependency. NEVER block FastAPI from
    booting. The worst this does for a missing optional dep is log a
    warning and mark that capability unavailable.
  • python-dotenv missing is NOT degraded — OS env vars still work.

Returns a structured report the caller can log + expose on /health.
"""
from __future__ import annotations
import importlib
import importlib.metadata as md
import platform
import sys
import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class DepResult:
    name:        str
    required:    bool
    present:     bool
    version:     Optional[str]
    want_major:  Optional[int]
    ok:          bool
    note:        str = ''


@dataclass
class GuardReport:
    results:    list[DepResult] = field(default_factory=list)
    degraded:   bool = False          # True only if a capability is reduced
    fatal:      list[str] = field(default_factory=list)   # required deps missing
    capabilities: dict[str, bool] = field(default_factory=dict)
    runtime:    dict = field(default_factory=dict)   # python/platform diagnostics
    checked_at: float = 0.0           # epoch seconds of the check

    def as_dict(self) -> dict:
        return {
            'degraded':     self.degraded,
            'fatal':        self.fatal,
            'capabilities': self.capabilities,
            'runtime':      self.runtime,
            'checked_at':   self.checked_at,
            'deps': [
                {'name': r.name, 'required': r.required, 'present': r.present,
                 'version': r.version, 'ok': r.ok, 'note': r.note}
                for r in self.results
            ],
        }


# (import_name, dist_name, required, want_major_or_None, capability_label)
# want_major=None → presence-only check (any version is fine).
_SPEC = [
    ('fastapi',      'fastapi',        True,  0,    'api'),
    ('uvicorn',      'uvicorn',        True,  0,    'server'),
    ('pydantic',     'pydantic',       True,  2,    'api'),
    ('httpx',        'httpx',          True,  0,    'http_client'),
    ('loguru',       'loguru',         True,  0,    'logging'),
    # Optional — degrade, never fatal:
    ('MetaTrader5',  'MetaTrader5',    False, None, 'mt5_execution'),
    ('psutil',       'psutil',         False, None, 'process_monitor'),
    ('dotenv',       'python-dotenv',  False, None, 'dotenv_files'),
]


def _installed_version(dist_name: str) -> Optional[str]:
    try:
        return md.version(dist_name)
    except Exception:
        return None


def _major(version: Optional[str]) -> Optional[int]:
    if not version:
        return None
    try:
        return int(version.split('.')[0])
    except (ValueError, IndexError):
        return None


# Cached at first run — dependency state can't change within a process, so
# /health and runtime diagnostics reuse the boot result instead of
# re-importing every probe. Pass force=True to recompute.
_CACHE: Optional[GuardReport] = None


def snapshot() -> dict[str, Optional[str]]:
    """Installed versions of every tracked distribution — for drift
    diagnostics. Cheap, no imports; reads installed metadata only."""
    return {dist: _installed_version(dist) for _, dist, *_ in _SPEC}


def check_dependencies(force: bool = False) -> GuardReport:
    global _CACHE
    if _CACHE is not None and not force:
        return _CACHE

    report = GuardReport(
        runtime={
            'python':         sys.version.split()[0],
            'implementation': platform.python_implementation(),
            'platform':       platform.platform(),
        },
        checked_at=time.time(),
    )
    for import_name, dist_name, required, want_major, capability in _SPEC:
        present = False
        try:
            importlib.import_module(import_name)
            present = True
        except Exception:
            present = False

        version = _installed_version(dist_name) if present else None
        ok = present

        note = ''
        if present and want_major is not None and want_major > 0:
            have_major = _major(version)
            if have_major is not None and have_major != want_major:
                # Major mismatch is the ONLY version condition we flag.
                ok = False
                note = f'major version {have_major} != expected {want_major}'

        report.results.append(DepResult(
            name=import_name, required=required, present=present,
            version=version, want_major=want_major, ok=ok, note=note,
        ))

        # Capability availability + degraded/fatal accounting.
        report.capabilities[capability] = report.capabilities.get(capability, True) and ok
        if not ok:
            if required:
                report.fatal.append(import_name)
            else:
                # Optional missing/mismatch → degraded capability, never fatal.
                report.degraded = True

    _CACHE = report
    return report


def log_report(report: GuardReport, logger) -> None:
    """Emit a single clear summary. Optional-dep issues are warnings,
    not errors — they must not read as a broken system."""
    if report.fatal:
        logger.error(f'dependency_guard: FATAL — required deps unusable: {report.fatal}')
    for r in report.results:
        if r.ok:
            continue
        level = logger.error if r.required else logger.warning
        if not r.present:
            level(f'dependency_guard: {r.name} not installed'
                  + ('' if r.required else ' (optional — capability disabled, API still up)'))
        elif r.note:
            level(f'dependency_guard: {r.name} {r.version} — {r.note}')
    if not report.fatal:
        if report.degraded:
            logger.info('dependency_guard: running in DEGRADED mode (optional capability missing); API fully up')
        else:
            logger.info('dependency_guard: all dependencies OK')
