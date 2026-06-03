"""
Supabase Storage wrapper for the asset-worker.

Bucket convention: `growth-assets` (auto-created on first upload if
absent — see ensure_bucket). Path scheme:

    growth-assets/<content_item_id>/<asset_kind>.<ext>

Every uploaded path is publicly readable. We rely on a bucket-level
RLS policy that allows anon SELECT (set in Supabase Dashboard once;
service-role writes are unrestricted).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from loguru import logger
from supabase import create_client, Client


_BUCKET = 'growth-assets'
_client: Optional[Client] = None


def db() -> Client:
    """Service-role client. Used by both storage AND row-update calls."""
    global _client
    if _client is not None:
        return _client
    url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise RuntimeError('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
    _client = create_client(url, key)
    return _client


def ensure_bucket_exists() -> None:
    """One-shot bucket bootstrap. No-op if already present."""
    try:
        buckets = db().storage.list_buckets()
        if any(getattr(b, 'name', None) == _BUCKET for b in buckets):
            return
        db().storage.create_bucket(_BUCKET, {'public': True})
        logger.info(f"storage: created bucket {_BUCKET!r} (public)")
    except Exception as e:
        # Already-exists race or permission issue — log and continue.
        # If the bucket genuinely can't be created, upload below will
        # fail loudly with a real error class.
        logger.debug(f"storage: ensure_bucket warning — {e}")


def upload(local_path: Path, content_item_id: str, asset_kind: str,
           ext: str = 'png') -> tuple[Optional[str], Optional[str], Optional[int]]:
    """
    Upload one local file to growth-assets/<id>/<kind>.<ext>.

    Returns: (public_url, storage_path, bytes) or (None, None, None) on failure.
    Never raises — the caller decides whether to mark the row failed.
    """
    storage_path = f"{content_item_id}/{asset_kind}.{ext}"
    try:
        size = local_path.stat().st_size
    except FileNotFoundError:
        logger.error(f"storage: local file missing — {local_path}")
        return None, None, None

    try:
        with local_path.open('rb') as fh:
            data = fh.read()
        # Use upsert=True so a retry overwrites a partial upload from a
        # previous attempt rather than 409-ing.
        content_type = {
            'png':  'image/png',
            'jpg':  'image/jpeg',
            'jpeg': 'image/jpeg',
            'mp4':  'video/mp4',
            'pdf':  'application/pdf',
        }.get(ext.lower(), 'application/octet-stream')
        db().storage.from_(_BUCKET).upload(
            path=storage_path,
            file=data,
            file_options={'content-type': content_type, 'upsert': 'true'},
        )
        public = db().storage.from_(_BUCKET).get_public_url(storage_path)
        return public, storage_path, size
    except Exception as e:
        logger.error(f"storage: upload failed kind={asset_kind} path={storage_path} err={e}")
        return None, None, None


def log_attempt(*, content_item_id: str, asset_kind: str, ok: bool,
                url: Optional[str] = None, storage_path: Optional[str] = None,
                bytes_: Optional[int] = None, duration_ms: Optional[int] = None,
                error: Optional[str] = None, worker_id: Optional[str] = None) -> None:
    """Append a row to growth_asset_attempts. The system_event_log
    mirror trigger fires on insert (migration 20240101000066)."""
    try:
        db().table('growth_asset_attempts').insert({
            'content_item_id': content_item_id,
            'asset_kind':      asset_kind,
            'ok':              ok,
            'url':             url,
            'storage_path':    storage_path,
            'bytes':           bytes_,
            'duration_ms':     duration_ms,
            'error':           (error or '')[:500] or None,
            'worker_id':       worker_id,
        }).execute()
    except Exception as e:
        logger.warning(f"storage: log_attempt failed — {e}")


def worker_id() -> str:
    """Hint for which Railway instance produced the asset.
    Useful when scaling beyond one replica."""
    return os.environ.get('RAILWAY_REPLICA_ID') or f'asset-worker-{uuid.uuid4().hex[:8]}'
