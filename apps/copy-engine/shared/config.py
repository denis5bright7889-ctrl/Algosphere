"""
copy-engine — shared configuration.

One settings object, loaded once from the environment. python-dotenv
fills gaps from a local .env (handy for dev / VPS); real deployments set
process env on Railway. OS env always wins over .env.

Required:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   — control-plane access
  SIGNAL_ENGINE_URL, ENGINE_API_KEY         — the executor calls /api/v1/execute
                                              and /api/v1/positions on the engine

Tunables (all have sane defaults):
  COPY_POLL_INTERVAL_MS   — base loop cadence when the queue is empty
  COPY_BATCH_SIZE         — jobs an executor claims per pass
  COPY_JOB_LEASE_S        — after this, a claimed job is presumed orphaned
  COPY_WORKER_ID          — stable id stamped into claimed_by (defaults to host+pid)
"""
from __future__ import annotations
import os
import socket
import pathlib
from dataclasses import dataclass

from dotenv import load_dotenv

# Load .env sitting next to the copy-engine app (parent of this file's dir).
_ENV_PATH = pathlib.Path(__file__).resolve().parent.parent / '.env'
if _ENV_PATH.exists():
    load_dotenv(_ENV_PATH)


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    supabase_url:           str
    supabase_service_key:   str
    engine_url:             str
    engine_api_key:         str
    poll_interval_ms:       int
    batch_size:             int
    job_lease_s:            int
    worker_id:              str
    fanout_chunk:           int   # rows per batch INSERT during fan-out
    # Redis Streams dispatch (optional — empty url ⇒ polling-only fallback).
    redis_url:              str
    redis_stream:           str
    redis_group:            str

    @property
    def engine_base(self) -> str:
        return self.engine_url.rstrip('/')

    @property
    def has_redis(self) -> bool:
        return bool(self.redis_url)


def load_settings() -> Settings:
    return Settings(
        supabase_url         = os.environ.get('SUPABASE_URL', '').strip(),
        supabase_service_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip(),
        engine_url           = os.environ.get('SIGNAL_ENGINE_URL', '').strip(),
        engine_api_key       = os.environ.get('ENGINE_API_KEY', '').strip(),
        poll_interval_ms     = _int('COPY_POLL_INTERVAL_MS', 1000),
        batch_size           = _int('COPY_BATCH_SIZE', 25),
        job_lease_s          = _int('COPY_JOB_LEASE_S', 120),
        worker_id            = os.environ.get('COPY_WORKER_ID', f'{socket.gethostname()}-{os.getpid()}'),
        fanout_chunk         = _int('COPY_FANOUT_CHUNK', 1000),
        redis_url            = os.environ.get('REDIS_URL', '').strip(),
        redis_stream         = os.environ.get('COPY_REDIS_STREAM', 'algosphere:copy_jobs').strip(),
        redis_group          = os.environ.get('COPY_REDIS_GROUP', 'copy-executors').strip(),
    )


def require(settings: Settings) -> None:
    """Fail loud at boot if the control-plane creds are missing — a worker
    with no DB is useless and silent-degrading would hide the misconfig."""
    missing = [
        n for n, v in (
            ('SUPABASE_URL', settings.supabase_url),
            ('SUPABASE_SERVICE_ROLE_KEY', settings.supabase_service_key),
        ) if not v
    ]
    if missing:
        raise RuntimeError(f'copy-engine: missing required env: {missing}')
