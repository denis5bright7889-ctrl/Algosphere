"""
copy-engine — Supabase client factory.

Workers authenticate with the SERVICE ROLE key: they run trusted,
server-side, and must read/write rows across all users (fan-out touches
every follower). RLS is bypassed by the service role by design — the
same trust model the signal-engine's /execute path already uses.

The client is sync (supabase-py); workers call it inside asyncio via
asyncio.to_thread so a slow query never blocks the event loop.
"""
from __future__ import annotations
from functools import lru_cache

from supabase import create_client, Client

from shared.config import load_settings


@lru_cache(maxsize=1)
def get_db() -> Client:
    s = load_settings()
    return create_client(s.supabase_url, s.supabase_service_key)
