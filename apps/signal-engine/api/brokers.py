"""
Broker connection test endpoint — synchronous handshake on demand.

The web app calls this immediately after a user saves credentials (and
again whenever they click "Retry connection") so they get an instant
verdict — CONNECTED / FAILED / DISABLED with a reason — instead of
waiting 10 minutes for the next BrokerHealthProbe cycle.

Authoritative DB writes happen here too: the response body and the
broker_connections.status row stay in sync. Telegram notification on
state transition is fired best-effort.

Auth: requires X-Engine-Key. The web /api/brokers/[id]/test route is
the only legitimate caller — it forwards the user's request with the
shared engine key so the engine can use the service-role DB client.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from loguru import logger

from config import get_settings
from risk.adapters.factory import (
    get_adapter_for_user, BrokerNotConnected, BrokerDecryptError,
    BrokerDisabled, drop_cache,
)
from risk.broker_state import BrokerState, disabled_reason_for

router = APIRouter()


# ─── Auth (same shape as api.routes._verify_engine_key) ────────────────

def _verify_engine_key(x_engine_key: Optional[str] = Header(default=None)) -> None:
    import os
    expected = os.getenv('ENGINE_API_KEY', '')
    if not expected:
        return  # no key configured → dev mode
    if x_engine_key != expected:
        raise HTTPException(status_code=401, detail='Invalid engine key')


# ─── Request / response models ─────────────────────────────────────────

PROBEABLE = {'binance', 'bybit', 'okx', 'mt5', 'paper', 'oanda', 'tradovate'}


class TestRequest(BaseModel):
    user_id: str = Field(..., min_length=8, max_length=64)
    broker:  str = Field(..., min_length=1, max_length=20)


class TestResponse(BaseModel):
    state:         str                # BrokerState constant
    reason:        Optional[str] = None
    equity_usd:    Optional[float] = None
    checked_at:    str
    latency_ms:    int


# ─── /brokers/test ─────────────────────────────────────────────────────

def _db():
    from supabase import create_client
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)


@router.post('/brokers/test', response_model=TestResponse, dependencies=[Depends(_verify_engine_key)])
async def test_connection(req: TestRequest) -> TestResponse:
    """
    Run a synchronous broker handshake and return the resolved state.

    Side effect: writes status + error_message + state_changed_at back
    to the matching broker_connections row.
    """
    started = datetime.now(timezone.utc)

    if req.broker not in PROBEABLE:
        raise HTTPException(
            status_code=400,
            detail=f'broker={req.broker!r} is not probeable. Supported: {sorted(PROBEABLE)}',
        )

    # Environment-level guard — answers MT5/Linux immediately without
    # touching the DB or attempting any network round-trip.
    env_disabled = disabled_reason_for(req.broker)
    if env_disabled is not None:
        await _writeback(req.user_id, req.broker, BrokerState.DISABLED, env_disabled)
        return _resp(BrokerState.DISABLED, env_disabled, started)

    # Attempt the real handshake.
    try:
        adapter = await get_adapter_for_user(_db(), req.user_id, req.broker)
        await adapter.refresh_state()
        if not adapter.is_connected():
            await _writeback(req.user_id, req.broker, BrokerState.FAILED,
                             'adapter reported not connected after refresh')
            return _resp(BrokerState.FAILED,
                         'adapter reported not connected after refresh', started)
        equity = adapter.get_equity()
        await _writeback(req.user_id, req.broker, BrokerState.CONNECTED, None,
                         equity=equity)
        return _resp(BrokerState.CONNECTED, None, started, equity=equity)
    except BrokerDisabled as e:
        await _writeback(req.user_id, req.broker, BrokerState.DISABLED, str(e))
        return _resp(BrokerState.DISABLED, str(e), started)
    except BrokerNotConnected as e:
        await _writeback(req.user_id, req.broker, BrokerState.FAILED, f'not connected: {e}')
        return _resp(BrokerState.FAILED, f'not connected: {e}', started)
    except BrokerDecryptError as e:
        await _writeback(req.user_id, req.broker, BrokerState.FAILED,
                         f'credential decrypt failed ({e}) — was CREDENTIAL_ENCRYPTION_KEY rotated?')
        await drop_cache(req.user_id, req.broker)
        return _resp(BrokerState.FAILED, f'decrypt failed: {e}', started)
    except Exception as e:
        msg = str(e)[:300]
        await _writeback(req.user_id, req.broker, BrokerState.FAILED, msg)
        await drop_cache(req.user_id, req.broker)
        return _resp(BrokerState.FAILED, msg, started)


# ─── Helpers ───────────────────────────────────────────────────────────

def _resp(state: str, reason: Optional[str], started: datetime, *, equity: Optional[float] = None) -> TestResponse:
    now = datetime.now(timezone.utc)
    return TestResponse(
        state      = state,
        reason     = reason,
        equity_usd = equity,
        checked_at = now.isoformat(),
        latency_ms = int((now - started).total_seconds() * 1000),
    )


async def _writeback(
    user_id: str,
    broker:  str,
    state:   str,
    reason:  Optional[str],
    *,
    equity:  Optional[float] = None,
) -> None:
    """Persist the test result. Same shape as broker_health._apply but
    addressed by (user_id, broker) since /test doesn't know the row id."""
    now = datetime.now(timezone.utc).isoformat()
    patch: dict = {
        'status':           state,
        'error_message':    reason,
        'last_synced_at':   now,
        'state_changed_at': now,
        'pending_cycles':   0,
    }
    if equity is not None:
        patch['equity_usd']        = equity
        patch['equity_updated_at'] = now

    try:
        # Update all matching rows (a user could have multiple accounts
        # on the same broker — they share credentials in this design).
        (
            _db().table('broker_connections')
            .update(patch)
            .eq('user_id', user_id)
            .eq('broker',  broker)
            .neq('status', BrokerState.REVOKED)
            .execute()
        )
    except Exception as e:
        logger.warning(f"/brokers/test writeback failed: {e}")
        return

    # Fire state-change notification on terminal outcomes only.
    if state in {BrokerState.CONNECTED, BrokerState.FAILED, BrokerState.DISABLED}:
        try:
            from notifier import dispatch_broker_state_change
            asyncio.create_task(dispatch_broker_state_change(
                user_id   = user_id,
                broker    = broker,
                new_state = state,
                reason    = reason,
            ))
        except Exception as e:
            logger.debug(f"/brokers/test telegram dispatch failed: {e}")
