"""
/api/v1/trading — per-user autonomous-execution control surface.

Spec: docs/architecture/algo-execution-spec.md sections 1, 10, 11, 14.

This is the engine-side counterpart to the web's /api/trading/* routes.
The web app handles auth + audit logging; this module owns the broker-
adapter side effects (position reads, flatten submissions) because those
are per-user and require the multi-broker adapter cache.

Endpoints:

  POST /trading/panic-close   — flatten every open position across every
                                connected broker for one user. Uses the
                                broker's reduce_only mechanism so the
                                global kill switch in /execute does not
                                block the close. Idempotent: zero
                                positions → returns positions_closed=0.

  GET  /trading/autotrade-check — read-only profile lookup so /execute
                                  can verify FULL_AUTOTRADE is on without
                                  carrying a Supabase client in the hot
                                  path. Cached short-window in the
                                  caller; never trust client-side claims.

Auth: X-Engine-Key (same as /brokers/test).
"""
from __future__ import annotations
import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from loguru import logger

from config import get_settings
from risk.adapters.base import (
    OrderRequest, OrderSide, OrderType, OrderRejected, SlippageExceeded,
)
from risk.adapters.factory import (
    get_adapter_for_user, BrokerNotConnected, BrokerDecryptError, BrokerDisabled,
)

router = APIRouter()


# ─── Auth ─────────────────────────────────────────────────────────────

def _verify_engine_key(x_engine_key: Optional[str] = Header(default=None)) -> None:
    expected = os.getenv('ENGINE_API_KEY', '')
    if not expected:
        return  # dev mode — no key configured
    if x_engine_key != expected:
        raise HTTPException(status_code=401, detail='Invalid engine key')


def _db():
    from supabase import create_client
    s = get_settings()
    if not s.has_supabase:
        return None
    return create_client(s.supabase_url, s.supabase_service_role_key)


# ─── /trading/autotrade-check ──────────────────────────────────────────
# Profile lookup the execute path uses. Service-role read; service-role
# write would let the engine flip flags on the user, which we never want.
# This is a READ.

class AutotradeCheck(BaseModel):
    user_id: str = Field(..., min_length=8, max_length=64)


class AutotradeCheckResult(BaseModel):
    autotrade_enabled:   bool
    trading_mode:        str
    consent_version:     int
    server_consent_version: int
    consent_up_to_date:  bool
    block_reason:        Optional[str] = None


# Deployed consent version. Must match the web side
# (apps/web/src/lib/autotrade.ts CONSENT_DOC_VERSION). Operator-tunable
# via env so a doc-version bump can ship without a code redeploy of the
# engine.
CONSENT_DOC_VERSION = int(os.getenv('AUTOTRADE_CONSENT_DOC_VERSION', '1'))


@router.post('/trading/autotrade-check',
             response_model=AutotradeCheckResult,
             dependencies=[Depends(_verify_engine_key)])
async def autotrade_check(body: AutotradeCheck) -> AutotradeCheckResult:
    db = _db()
    if db is None:
        # Fail-CLOSED: no Supabase → no autotrade. The engine never
        # invents an arming state.
        return AutotradeCheckResult(
            autotrade_enabled=False, trading_mode='manual',
            consent_version=0, server_consent_version=CONSENT_DOC_VERSION,
            consent_up_to_date=False,
            block_reason='supabase_unavailable',
        )

    try:
        res = await asyncio.to_thread(
            lambda: db.table('profiles')
            .select(
                'full_autotrade_enabled, trading_mode, autotrade_consent_version'
            )
            .eq('id', body.user_id)
            .single()
            .execute()
        )
        row = res.data or {}
    except Exception as e:
        logger.warning(f"autotrade_check db read failed for {body.user_id[:8]}: {e}")
        return AutotradeCheckResult(
            autotrade_enabled=False, trading_mode='manual',
            consent_version=0, server_consent_version=CONSENT_DOC_VERSION,
            consent_up_to_date=False, block_reason='profile_lookup_failed',
        )

    enabled  = bool(row.get('full_autotrade_enabled'))
    mode     = (row.get('trading_mode') or 'manual')
    cv       = int(row.get('autotrade_consent_version') or 0)
    up_to_date = cv >= CONSENT_DOC_VERSION

    reason: Optional[str] = None
    if not enabled:
        reason = 'autotrade_disabled'
    elif not up_to_date:
        reason = 'consent_stale'

    return AutotradeCheckResult(
        autotrade_enabled=enabled, trading_mode=mode,
        consent_version=cv, server_consent_version=CONSENT_DOC_VERSION,
        consent_up_to_date=up_to_date, block_reason=reason,
    )


# ─── /trading/panic-close ──────────────────────────────────────────────
# Iterate every connected broker for the user and submit a reduce_only
# market order of opposite side to flatten each open position. Uses
# adapter.submit_order with reduce_only=True so the open-side kill
# switch in /execute does NOT block these (risk-reducing orders are
# always allowed even during a halt).

class PanicCloseBody(BaseModel):
    user_id: str = Field(..., min_length=8, max_length=64)
    reason:  Optional[str] = Field(None, max_length=240)


class PanicClosePosition(BaseModel):
    broker:        str
    symbol:        str
    side:          str
    qty:           float
    order_id:      Optional[str] = None
    closed:        bool
    error:         Optional[str] = None


class PanicCloseResult(BaseModel):
    ok:                bool
    user_id:           str
    triggered_at:      str
    brokers_attempted: list[str]
    positions_closed:  int
    positions_failed:  int
    details:           list[PanicClosePosition]


# Brokers we know how to address per-user. paper is included because
# users can run shadow / paper accounts they may also want to flatten.
PANIC_BROKERS = ('mt5', 'binance', 'bybit', 'okx', 'oanda', 'tradovate', 'paper')


@router.post('/trading/panic-close',
             response_model=PanicCloseResult,
             dependencies=[Depends(_verify_engine_key)])
async def panic_close(body: PanicCloseBody) -> PanicCloseResult:
    started = datetime.now(timezone.utc).isoformat()
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail='supabase_unavailable')

    # Find which brokers this user has actually connected (status=connected).
    # We restrict to live + testnet 'connected' rows so we don't try to
    # contact a disabled / failed broker and burn the circuit breaker.
    try:
        cres = await asyncio.to_thread(
            lambda: db.table('broker_connections')
            .select('broker, status')
            .eq('user_id', body.user_id)
            .eq('status', 'connected')
            .execute()
        )
        rows = cres.data or []
    except Exception as e:
        logger.error(f"panic-close: could not list brokers for {body.user_id[:8]}: {e}")
        raise HTTPException(status_code=502, detail=f'broker_list_failed: {e}')

    brokers = sorted({r['broker'] for r in rows if r.get('broker') in PANIC_BROKERS})
    if not brokers:
        return PanicCloseResult(
            ok=True, user_id=body.user_id, triggered_at=started,
            brokers_attempted=[], positions_closed=0, positions_failed=0, details=[],
        )

    details: list[PanicClosePosition] = []
    closed = failed = 0

    for broker in brokers:
        try:
            adapter = await get_adapter_for_user(db, body.user_id, broker)
            await adapter.refresh_state()
            try:
                positions = await adapter.get_positions()
            except Exception as e:
                logger.warning(f"panic-close: {broker} get_positions failed: {e}")
                details.append(PanicClosePosition(
                    broker=broker, symbol='?', side='?', qty=0,
                    closed=False, error=f'get_positions_failed: {e}',
                ))
                failed += 1
                continue

            for p in positions:
                # Flatten by submitting an opposite-side reduce_only market.
                # MT5 / FX adapters interpret reduce_only at the broker
                # level; for crypto venues the qty is the full position.
                opposite = 'sell' if p.side == 'long' else 'buy'
                req = OrderRequest(
                    symbol           = p.symbol,
                    side             = OrderSide(opposite),
                    order_type       = OrderType('market'),
                    quantity         = abs(p.qty),
                    max_slippage_pct = 0.01,   # 1% — flattening should accept worse fills
                    reduce_only      = True,
                )
                try:
                    result = await adapter.submit_order(req)
                    details.append(PanicClosePosition(
                        broker=broker, symbol=p.symbol, side=p.side, qty=p.qty,
                        order_id=result.order_id, closed=True,
                    ))
                    closed += 1
                except (OrderRejected, SlippageExceeded, Exception) as e:
                    logger.warning(f"panic-close: {broker} {p.symbol} close failed: {e}")
                    details.append(PanicClosePosition(
                        broker=broker, symbol=p.symbol, side=p.side, qty=p.qty,
                        closed=False, error=f'{type(e).__name__}: {e}',
                    ))
                    failed += 1
        except BrokerNotConnected:
            continue
        except (BrokerDecryptError, BrokerDisabled) as e:
            logger.warning(f"panic-close: {broker} adapter unavailable: {e}")
            details.append(PanicClosePosition(
                broker=broker, symbol='?', side='?', qty=0,
                closed=False, error=f'{type(e).__name__}: {e}',
            ))
            failed += 1
        except Exception as e:
            logger.error(f"panic-close: {broker} unexpected error: {e}")
            details.append(PanicClosePosition(
                broker=broker, symbol='?', side='?', qty=0,
                closed=False, error=f'unexpected: {e}',
            ))
            failed += 1

    logger.warning(
        f"PANIC-CLOSE user={body.user_id[:8]} brokers={brokers} "
        f"closed={closed} failed={failed} reason={body.reason!r}"
    )

    return PanicCloseResult(
        ok=True, user_id=body.user_id, triggered_at=started,
        brokers_attempted=brokers,
        positions_closed=closed, positions_failed=failed,
        details=details,
    )
