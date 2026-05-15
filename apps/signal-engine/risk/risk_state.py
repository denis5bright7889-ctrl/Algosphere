"""
AlgoSphere Quant — Persistent Risk State
JSON-backed dataclass that survives restarts, crashes, and broker disconnects.
Written atomically via temp-file + rename to prevent corruption.
"""
from __future__ import annotations
import json
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from loguru import logger


@dataclass
class TradeRecord:
    timestamp: str
    symbol: str
    was_win: bool
    pnl: float = 0.0


@dataclass
class RiskState:
    # ─── Account identity ──────────────────────────────────────────────────
    account_login: str = ''

    # ─── Equity tracking ───────────────────────────────────────────────────
    initial_equity:  float = 0.0
    peak_equity:     float = 0.0
    current_equity:  float = 0.0

    # ─── Daily baseline ────────────────────────────────────────────────────
    daily_baseline_equity: float = 0.0
    daily_baseline_date:   str = ''
    daily_pnl:             float = 0.0

    # ─── Weekly baseline ───────────────────────────────────────────────────
    weekly_baseline_equity:  float = 0.0
    weekly_baseline_iso_week: str = ''
    weekly_pnl:              float = 0.0

    # ─── Streaks ───────────────────────────────────────────────────────────
    consecutive_losses: int = 0
    consecutive_wins:   int = 0

    # ─── Cooldown / lock ───────────────────────────────────────────────────
    cooldown_until_iso: Optional[str] = None
    locked:             bool = False
    locked_reason:      str = ''
    locked_at_iso:      Optional[str] = None

    # ─── Exposure ──────────────────────────────────────────────────────────
    open_positions: int = 0

    # ─── Audit timestamps ──────────────────────────────────────────────────
    last_refreshed_iso:         str = ''
    last_equity_from_broker_iso: Optional[str] = None

    # ─── Trade history (capped at 50) ──────────────────────────────────────
    trade_history: list[TradeRecord] = field(default_factory=list)


class RiskStateStore:
    """JSON-backed persistent risk state. Atomic writes via temp + rename."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> Optional[RiskState]:
        if not self.path.exists():
            return None
        try:
            with self.path.open('r', encoding='utf-8') as f:
                raw = json.load(f)
            return self._from_dict(raw)
        except Exception as e:
            logger.error(f"Failed to load risk state from {self.path}: {e}")
            # Quarantine corrupt file so it's not silently overwritten
            try:
                quarantine = self.path.with_suffix(f'.corrupt.{int(datetime.now().timestamp())}')
                self.path.rename(quarantine)
                logger.warning(f"Quarantined corrupt state file → {quarantine.name}")
            except Exception:
                pass
            return None

    def save(self, state: RiskState) -> bool:
        try:
            tmp = self.path.with_suffix(self.path.suffix + '.tmp')
            with tmp.open('w', encoding='utf-8') as f:
                json.dump(self._to_dict(state), f, indent=2, default=str)
            os.replace(tmp, self.path)
            return True
        except Exception as e:
            logger.error(f"Failed to save risk state: {e}")
            return False

    @staticmethod
    def _to_dict(state: RiskState) -> dict:
        d = asdict(state)
        d['trade_history'] = [
            asdict(t) if not isinstance(t, dict) else t
            for t in state.trade_history
        ]
        return d

    @staticmethod
    def _from_dict(raw: dict) -> RiskState:
        history_raw = raw.pop('trade_history', []) or []
        history = []
        for t in history_raw:
            try:
                history.append(TradeRecord(**t))
            except TypeError:
                # Skip malformed records rather than fail entire load
                continue
        # Filter unknown fields for forward-compat
        allowed = RiskState.__dataclass_fields__.keys()
        clean = {k: v for k, v in raw.items() if k in allowed}
        state = RiskState(**clean)
        state.trade_history = history
        return state
