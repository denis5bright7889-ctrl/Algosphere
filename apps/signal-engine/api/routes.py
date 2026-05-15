"""
AlgoSphere Signal Engine — REST API Routes
Provides health, status, signal history, and regime snapshot endpoints.
All write operations require the internal X-Engine-Key header.
"""
from __future__ import annotations
import asyncio
import os
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel
from loguru import logger

router = APIRouter()


# ─── Auth dependency ──────────────────────────────────────────────────────────

def _verify_engine_key(x_engine_key: Optional[str] = Header(default=None)) -> None:
    expected = os.getenv('ENGINE_API_KEY', '')
    if not expected:
        return  # no key configured → open (dev mode)
    if x_engine_key != expected:
        raise HTTPException(status_code=401, detail="Invalid engine key")


def _worker():
    from worker.registry import get_worker
    w = get_worker()
    if w is None:
        raise HTTPException(status_code=503, detail="Worker not initialised")
    return w


# ─── Health ───────────────────────────────────────────────────────────────────

@router.get('/health')
async def health():
    return {
        'status': 'ok',
        'service': 'algosphere-signal-engine',
        'time': datetime.now(timezone.utc).isoformat(),
    }


# ─── Engine status ────────────────────────────────────────────────────────────

@router.get('/status')
async def engine_status():
    from config import get_settings
    from websocket.manager import ws_manager
    s = get_settings()
    return {
        'enabled':   s.signal_engine_enabled,
        'symbols':   s.symbol_list,
        'timeframe': s.timeframe,
        'provider':  'twelvedata' if s.twelve_data_api_key else ('alphavantage' if s.alpha_vantage_api_key else 'none'),
        'websocket': ws_manager.stats(),
        'time':      datetime.now(timezone.utc).isoformat(),
    }


# ─── Circuit breaker ─────────────────────────────────────────────────────────

@router.get('/circuit-breaker')
async def circuit_breaker_states():
    from config import get_settings
    from worker.registry import get_worker
    worker = get_worker()
    if not worker:
        return {}
    result = {}
    for sym in get_settings().symbol_list:
        state = worker._risk_engine.get_state(sym)
        result[sym] = {
            'is_open':            state.is_open,
            'reason':             state.reason,
            'consecutive_losses': state.consecutive_losses,
            'daily_losses':       state.daily_losses,
        }
    return result


@router.post('/circuit-breaker/{symbol}/reset', dependencies=[Depends(_verify_engine_key)])
async def reset_circuit_breaker(symbol: str):
    worker = _worker()
    worker._risk_engine.reset_symbol(symbol.upper())
    logger.info(f"Circuit breaker reset for {symbol} via API")
    return {'reset': symbol.upper()}


# ─── Regime snapshots ─────────────────────────────────────────────────────────

@router.get('/regime')
async def latest_regimes(
    symbols: Optional[str] = Query(default=None, description="Comma-separated symbols"),
):
    from config import get_settings
    from supabase import create_client
    s = get_settings()
    db = create_client(s.supabase_url, s.supabase_service_role_key)
    sym_list = [x.strip().upper() for x in symbols.split(',')] if symbols else s.symbol_list

    rows = []
    for sym in sym_list:
        try:
            result = (
                db.table('regime_snapshots')
                .select('*')
                .eq('symbol', sym)
                .order('scanned_at', desc=True)
                .limit(1)
                .execute()
            )
            if result.data:
                rows.append(result.data[0])
        except Exception as e:
            logger.warning(f"Regime query failed for {sym}: {e}")

    return {'regimes': rows}


# ─── Signal history (engine-sourced) ─────────────────────────────────────────

@router.get('/signals/recent')
async def recent_signals(
    limit: int = Query(default=20, ge=1, le=100),
    symbol: Optional[str] = Query(default=None),
):
    from config import get_settings
    from supabase import create_client
    s = get_settings()
    db = create_client(s.supabase_url, s.supabase_service_role_key)

    try:
        q = (
            db.table('signals')
            .select('id,pair,direction,entry_price,stop_loss,take_profit_1,risk_reward,'
                    'confidence_score,regime,tier_required,lifecycle_state,engine_version,'
                    'der_score,entropy_score,published_at')
            .eq('engine_version', 'algo_v1')
            .order('published_at', desc=True)
            .limit(limit)
        )
        if symbol:
            q = q.eq('pair', symbol.upper())
        result = q.execute()
        return {'signals': result.data or [], 'count': len(result.data or [])}
    except Exception as e:
        logger.error(f"Recent signals query failed: {e}")
        raise HTTPException(status_code=500, detail="Database query failed")


# ─── Trigger manual scan ─────────────────────────────────────────────────────

class ScanRequest(BaseModel):
    symbols: Optional[list[str]] = None


@router.post('/scan', dependencies=[Depends(_verify_engine_key)])
async def trigger_scan(body: ScanRequest):
    from config import get_settings
    worker = _worker()
    s = get_settings()
    symbols = [sym.upper() for sym in body.symbols] if body.symbols else s.symbol_list
    asyncio.create_task(_run_scan(worker, symbols))
    return {'queued': symbols, 'time': datetime.now(timezone.utc).isoformat()}


async def _run_scan(worker, symbols: list[str]) -> None:
    tasks = [worker.scan_symbol(sym) for sym in symbols]
    await asyncio.gather(*tasks, return_exceptions=True)


# ─── Calibration analytics ───────────────────────────────────────────────────

@router.get('/analytics/calibration')
async def get_calibration(lookback_days: int = Query(default=30, ge=7, le=90)):
    from config import get_settings
    from supabase import create_client
    from analytics.engine import compute_calibration
    s = get_settings()
    db = create_client(s.supabase_url, s.supabase_service_role_key)
    report = await compute_calibration(db, lookback_days=lookback_days)
    if not report:
        return {'message': 'Insufficient data for calibration report', 'lookback_days': lookback_days}
    return {
        'generated_at':     report.generated_at,
        'total_signals':    report.total_signals,
        'overall_win_rate': report.overall_win_rate,
        'calibration_error': report.calibration_error,
        'by_tier':          [t.__dict__ for t in report.by_tier],
        'by_symbol':        report.by_symbol,
        'regime_performance': report.regime_performance,
    }


# ─── Institutional risk engine ───────────────────────────────────────────────

@router.get('/risk/telemetry')
async def risk_telemetry():
    """Public read-only telemetry for dashboard."""
    worker = _worker()
    risk = worker.capital_risk()
    if risk is None:
        raise HTTPException(status_code=503, detail="Risk subsystem unavailable")
    # Refresh to ensure fresh equity/DD numbers
    try:
        risk.refresh()
    except Exception as e:
        logger.warning(f"risk.refresh during telemetry call failed: {e}")
    return risk.telemetry()


class OperatorAction(BaseModel):
    operator: str
    confirm:  bool = False


@router.post('/risk/reset-lock', dependencies=[Depends(_verify_engine_key)])
async def risk_reset_lock(body: OperatorAction):
    """Manual operator unlock. Requires engine key + confirmation flag."""
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true required")
    worker = _worker()
    risk = worker.capital_risk()
    if risk is None:
        raise HTTPException(status_code=503, detail="Risk subsystem unavailable")
    ok = risk.reset_lock(body.operator)
    return {'reset': ok, 'operator': body.operator, 'state': risk.telemetry()['state']}


@router.post('/risk/emergency-flatten', dependencies=[Depends(_verify_engine_key)])
async def risk_emergency_flatten(body: OperatorAction):
    """Operator-triggered emergency flatten — closes all positions, fires kill switch."""
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true required")
    worker = _worker()
    risk = worker.capital_risk()
    if risk is None:
        raise HTTPException(status_code=503, detail="Risk subsystem unavailable")
    risk._fire_kill(f"Manual emergency flatten by operator={body.operator}")
    return {'flattened': True, 'operator': body.operator, 'state': risk.telemetry()['state']}


# ─── Outcome recording ───────────────────────────────────────────────────────

class OutcomePayload(BaseModel):
    symbol: str
    was_win: bool
    pnl: float = 0.0


@router.post('/outcome', dependencies=[Depends(_verify_engine_key)])
async def record_outcome(body: OutcomePayload):
    worker = _worker()
    worker.record_outcome(body.symbol.upper(), body.was_win, body.pnl)
    return {'recorded': body.symbol.upper(), 'was_win': body.was_win, 'pnl': body.pnl}
