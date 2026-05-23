"""
copy-engine — centralized risk-engine client (Phase 3).

Thin wrappers over the SQL RPCs from migration 034 (live_risk_engine). The
heavy lifting — exposure aggregation, limit evaluation — lives in Postgres
so it's atomic and consistent across all workers; these helpers just call
it. All functions are sync (run via asyncio.to_thread by callers) and
fail-OPEN on error EXCEPT the portfolio gate, which fails-CLOSED on an
explicit deny only (a transient RPC error allows, so a DB blip can't wedge
the whole pipeline — the engine's per-account 12-gate is still in force).
"""
from __future__ import annotations
from typing import Iterable

from loguru import logger


def evaluate_portfolio_risk(db, user_id: str, symbol: str,
                            notional_usd: float) -> tuple[bool, str]:
    """Pre-trade portfolio check. Returns (allow, reason). On RPC error we
    allow (fail-open) — the engine's inner risk gate still applies."""
    try:
        res = db.rpc('evaluate_portfolio_risk', {
            'p_user_id': user_id, 'p_symbol': symbol,
            'p_notional_usd': notional_usd,
        }).execute()
        d = res.data or {}
        if isinstance(d, dict):
            return bool(d.get('allow', True)), str(d.get('reason', 'ok'))
        return True, 'ok'
    except Exception as e:
        logger.warning(f'evaluate_portfolio_risk failed (fail-open): {e}')
        return True, 'risk_check_unavailable'


def is_kill_switch_active(db) -> bool:
    try:
        res = db.rpc('is_kill_switch_active', {}).execute()
        return bool(res.data)
    except Exception as e:
        logger.warning(f'is_kill_switch_active failed (fail-open): {e}')
        return False


def recompute_portfolio_exposure(db, user_id: str | None = None) -> int:
    res = db.rpc('recompute_portfolio_exposure',
                 {'p_user_id': user_id}).execute()
    return int(res.data) if isinstance(res.data, int) else (res.data or 0)


def auto_quarantine_breaching_strategies(db, window_hours: int = 24,
                                         loss_threshold: float = 2000) -> int:
    res = db.rpc('auto_quarantine_breaching_strategies', {
        'p_window_hours': window_hours, 'p_loss_threshold': loss_threshold,
    }).execute()
    return int(res.data) if isinstance(res.data, int) else (res.data or 0)


def inactive_strategy_ids(db, strategy_ids: Iterable[str]) -> set[str]:
    """Of the given strategies, which are quarantined/disabled (not active)?
    Used by the orchestrator to skip fan-out. Fail-open → empty set (treat
    all as active) so a risk-table outage never blocks legitimate copies."""
    ids = [s for s in {sid for sid in strategy_ids if sid}]
    if not ids:
        return set()
    try:
        res = (db.table('strategy_risk_state').select('strategy_id,status')
               .in_('strategy_id', ids).neq('status', 'active').execute())
        return {r['strategy_id'] for r in (res.data or [])}
    except Exception as e:
        logger.warning(f'inactive_strategy_ids failed (fail-open): {e}')
        return set()
