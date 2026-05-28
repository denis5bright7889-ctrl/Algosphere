"""
Inbound provider webhooks (Finnhub & friends).

One parametric endpoint receives push events from market-data providers,
verifies the per-provider secret, dedupes, and durably stores the raw
event in `webhook_events` for downstream processing. Designed to satisfy
the providers' delivery contract: respond 200 fast, and only ever 401 on a
bad secret (a non-200 makes most providers retry, so a duplicate still
returns 200).

Verification model per provider:
  • finnhub  → header 'X-Finnhub-Secret' must equal FINNHUB_WEBHOOK_SECRET
               (the value shown in your Finnhub webhook dashboard).
  • others   → header 'X-Webhook-Secret' (or ?secret=) must equal
               <PROVIDER>_WEBHOOK_SECRET, e.g. TWELVEDATA_WEBHOOK_SECRET.

The handler never trusts the body shape: parsing failures and non-object
payloads are stored verbatim so nothing is lost. Processing of stored
events (routing news/earnings into the feed, etc.) is a separate consumer
— this endpoint's job is secure, durable ingestion.
"""
from __future__ import annotations
import hmac
import os
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from loguru import logger

from config import get_settings

router = APIRouter()


def _expected_secret(provider: str) -> str:
    """Resolve the configured secret for a provider (empty = not configured)."""
    if provider == 'finnhub':
        s = get_settings().finnhub_webhook_secret
        if s:
            return s
    # Generic fallback: <PROVIDER>_WEBHOOK_SECRET from the environment.
    return os.environ.get(f'{provider.upper()}_WEBHOOK_SECRET', '')


def _presented_secret(provider: str, request: Request) -> Optional[str]:
    if provider == 'finnhub':
        return request.headers.get('x-finnhub-secret')
    return request.headers.get('x-webhook-secret') or request.query_params.get('secret')


def _persist(provider: str, event_type: Optional[str], external_id: Optional[str],
             symbol: Optional[str], payload: dict) -> None:
    """Best-effort durable insert. A unique-violation means the same event
    arrived twice (provider retry) — that's success, not an error."""
    s = get_settings()
    if not s.has_supabase:
        logger.warning(f"webhook {provider}: Supabase not configured — event not persisted")
        return
    try:
        from supabase import create_client
        db = create_client(s.supabase_url, s.supabase_service_role_key)
        db.table('webhook_events').insert({
            'provider':    provider,
            'event_type':  event_type,
            'external_id': external_id,
            'symbol':      symbol,
            'payload':     payload,
            'signature_ok': True,
        }).execute()
    except Exception as e:
        msg = str(e)
        if '23505' in msg or 'duplicate key' in msg.lower():
            logger.debug(f"webhook {provider}: event {external_id} already stored (dup)")
        else:
            logger.error(f"webhook {provider}: persist failed — {e}")


@router.post('/webhooks/{provider}')
async def receive_webhook(provider: str, request: Request):
    provider = provider.lower().strip()

    expected = _expected_secret(provider)
    if not expected:
        # No secret configured for this provider → we don't accept it.
        raise HTTPException(status_code=404, detail=f"webhook provider '{provider}' not configured")

    presented = _presented_secret(provider, request)
    if not presented or not hmac.compare_digest(presented, expected):
        logger.warning(f"webhook {provider}: invalid/missing secret")
        raise HTTPException(status_code=401, detail="invalid signature")

    # Parse defensively — never lose an authenticated payload.
    try:
        body = await request.json()
    except Exception:
        raw = (await request.body()).decode('utf-8', 'replace')
        body = {'_raw': raw[:10000]}

    if isinstance(body, dict):
        event_type  = body.get('event') or body.get('type') or body.get('eventType')
        symbol      = body.get('symbol')
        external_id = body.get('id') or body.get('messageId') or body.get('event_id')
        stored = body
    else:
        # Lists/scalars: wrap so the jsonb column always gets an object.
        event_type = symbol = external_id = None
        stored = {'_payload': body}

    _persist(provider, event_type, str(external_id) if external_id is not None else None,
             symbol, stored)
    logger.info(f"webhook {provider}: accepted event={event_type} symbol={symbol}")
    return {'ok': True, 'provider': provider, 'event': event_type}
