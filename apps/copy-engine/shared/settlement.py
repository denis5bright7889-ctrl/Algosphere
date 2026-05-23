"""
copy-engine — settlement client.

Thin wrapper over accrue_copy_earnings() (migration 036). The PnL itself is
computed once at close time and stored on copy_trades.follower_pnl; this RPC
only splits that figure into creator/platform shares and accrues it,
idempotently (the earnings_settled flag guards against double-accrual). So
there is no money-math duplication here — just the call.
"""
from __future__ import annotations

from loguru import logger


def accrue_copy_earnings(db, copy_trade_id: str) -> float:
    """Accrue creator profit-share for a closed copy. Returns creator_usd
    (0 if loss/unprofitable, already settled, or no strategy). Never raises
    into the close path — a settlement hiccup must not undo a completed
    flatten."""
    try:
        res = db.rpc('accrue_copy_earnings', {'p_copy_trade_id': copy_trade_id}).execute()
        return float(res.data) if res.data is not None else 0.0
    except Exception as e:
        logger.warning(f'accrue_copy_earnings({copy_trade_id[:8]}) failed (non-fatal): {e}')
        return 0.0
