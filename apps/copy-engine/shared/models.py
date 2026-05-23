"""
copy-engine — typed views over the control-plane rows.

Thin dataclasses constructed from the dict rows supabase-py returns.
They exist so worker logic reads against named fields (and so a schema
drift surfaces as an obvious KeyError at the boundary, not deep inside
the allocation math).
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, Any


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


@dataclass
class SignalEvent:
    id:          str
    leader_id:   str
    strategy_id: Optional[str]
    signal_id:   Optional[str]
    event_type:  str          # OPEN | CLOSE | MODIFY | CANCEL
    symbol:      str
    direction:   Optional[str]
    payload:     dict
    trace_id:    Optional[str] = None

    @classmethod
    def from_row(cls, r: dict) -> 'SignalEvent':
        return cls(
            id=r['id'], leader_id=r['leader_id'], strategy_id=r.get('strategy_id'),
            signal_id=r.get('signal_id'), event_type=r['event_type'],
            symbol=r['symbol'], direction=r.get('direction'),
            payload=r.get('payload') or {}, trace_id=r.get('trace_id'),
        )

    # Convenience accessors over the free-form payload --------------------
    @property
    def entry(self) -> Optional[float]:
        v = self.payload.get('entry') or self.payload.get('entry_price')
        return _f(v) if v is not None else None

    @property
    def stop_loss(self) -> Optional[float]:
        v = self.payload.get('stop_loss') or self.payload.get('sl')
        return _f(v) if v is not None else None

    @property
    def take_profit(self) -> Optional[float]:
        v = self.payload.get('take_profit') or self.payload.get('tp') \
            or self.payload.get('take_profit_1')
        return _f(v) if v is not None else None

    @property
    def leader_lot(self) -> float:
        return _f(self.payload.get('lot') or self.payload.get('leader_lot'), 0.0)

    @property
    def leader_equity(self) -> Optional[float]:
        v = self.payload.get('leader_equity')
        return _f(v) if v is not None else None


@dataclass
class Subscription:
    id:               str
    subscriber_id:    str
    strategy_id:      str
    copy_enabled:     bool
    copy_mode:        str
    status:           str
    allocation_model: str       # equity_ratio | fixed_ratio | risk_pct
    allocation_pct:   float
    fixed_scale:      float
    risk_pct:         float
    risk_multiplier:  float
    max_lot_size:     Optional[float]
    copy_sl:          bool
    copy_tp:          bool

    @classmethod
    def from_row(cls, r: dict) -> 'Subscription':
        return cls(
            id=r['id'], subscriber_id=r['subscriber_id'], strategy_id=r['strategy_id'],
            copy_enabled=bool(r.get('copy_enabled')), copy_mode=r.get('copy_mode', 'signal_only'),
            status=r.get('status', 'active'),
            allocation_model=r.get('allocation_model', 'risk_pct'),
            allocation_pct=_f(r.get('allocation_pct'), 5.0),
            fixed_scale=_f(r.get('fixed_scale'), 1.0),
            risk_pct=_f(r.get('risk_pct'), 1.0),
            risk_multiplier=_f(r.get('risk_multiplier'), 1.0),
            max_lot_size=(_f(r['max_lot_size']) if r.get('max_lot_size') is not None else None),
            copy_sl=bool(r.get('copy_sl', True)), copy_tp=bool(r.get('copy_tp', True)),
        )


@dataclass
class CopyJob:
    id:              str
    signal_event_id: str
    subscription_id: str
    follower_id:     str
    leader_id:       str
    broker:          Optional[str]
    status:          str
    attempts:        int
    max_attempts:    int
    computed_lot:    Optional[float]
    copy_trade_id:   Optional[str]
    trace_id:        Optional[str]

    @classmethod
    def from_row(cls, r: dict) -> 'CopyJob':
        return cls(
            id=r['id'], signal_event_id=r['signal_event_id'],
            subscription_id=r['subscription_id'], follower_id=r['follower_id'],
            leader_id=r['leader_id'], broker=r.get('broker'),
            status=r.get('status', 'claimed'), attempts=int(r.get('attempts', 0)),
            max_attempts=int(r.get('max_attempts', 3)),
            computed_lot=(_f(r['computed_lot']) if r.get('computed_lot') is not None else None),
            copy_trade_id=r.get('copy_trade_id'), trace_id=r.get('trace_id'),
        )
