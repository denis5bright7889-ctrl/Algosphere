"""
copy-engine — Journal performance analytics (pure, deterministic).

Tradezella-grade performance stats computed from a user's realized trades:
win rate, profit factor, expectancy, reward/risk, drawdown, and best/worst
breakdowns by session, pair, setup tag, and hour-of-day. NO I/O, NO LLM —
a pure function of the trade list, so it is fully unit-testable. The coach
worker does the DB I/O around it.

Distinct from coaching.py: that scores *behavior* (discipline); this
measures *performance* (what's working). They run off the same trade load.
"""
from __future__ import annotations
import statistics
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class JTrade:
    pnl:     float
    pair:    str
    ts:      datetime
    session: Optional[str] = None
    tags:    list[str] = field(default_factory=list)


@dataclass
class Bucket:
    trades: int = 0
    wins:   int = 0
    pnl:    float = 0.0

    def add(self, pnl: float) -> None:
        self.trades += 1
        self.pnl += pnl
        if pnl > 0:
            self.wins += 1

    def as_dict(self) -> dict:
        return {
            'trades': self.trades,
            'win_rate': round(100.0 * self.wins / self.trades, 2) if self.trades else 0.0,
            'pnl': round(self.pnl, 2),
        }


@dataclass
class Analytics:
    trades:        int
    win_rate:      Optional[float]
    profit_factor: Optional[float]   # gross profit / gross loss; None if no losses
    expectancy:    Optional[float]   # mean pnl per trade
    gross_profit:  float
    gross_loss:    float
    avg_win:       Optional[float]
    avg_loss:      Optional[float]
    reward_risk:   Optional[float]   # avg_win / |avg_loss|
    net_pnl:       float
    max_drawdown:  float             # peak-to-trough on the realized equity curve
    best_pair:     Optional[str]
    worst_pair:    Optional[str]
    best_session:  Optional[str]
    by_session:    dict = field(default_factory=dict)
    by_pair:       dict = field(default_factory=dict)
    by_tag:        dict = field(default_factory=dict)
    by_hour:       dict = field(default_factory=dict)


def compute(trades: list[JTrade]) -> Analytics:
    n = len(trades)
    if n == 0:
        return Analytics(0, None, None, None, 0.0, 0.0, None, None, None,
                         0.0, 0.0, None, None, None)

    trades = sorted(trades, key=lambda t: t.ts)
    wins = [t.pnl for t in trades if t.pnl > 0]
    losses = [t.pnl for t in trades if t.pnl < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    net = sum(t.pnl for t in trades)

    win_rate = round(100.0 * len(wins) / n, 2)
    profit_factor = round(gross_profit / gross_loss, 4) if gross_loss > 0 else None
    expectancy = round(net / n, 4)
    avg_win = round(statistics.fmean(wins), 4) if wins else None
    avg_loss = round(statistics.fmean(losses), 4) if losses else None
    reward_risk = (round(avg_win / abs(avg_loss), 4)
                   if (avg_win is not None and avg_loss not in (None, 0)) else None)

    # realized equity curve → max drawdown
    run = peak = 0.0
    max_dd = 0.0
    for t in trades:
        run += t.pnl
        peak = max(peak, run)
        max_dd = max(max_dd, peak - run)

    by_session: dict[str, Bucket] = {}
    by_pair:    dict[str, Bucket] = {}
    by_tag:     dict[str, Bucket] = {}
    by_hour:    dict[str, Bucket] = {}
    for t in trades:
        by_session.setdefault(t.session or 'unknown', Bucket()).add(t.pnl)
        by_pair.setdefault(t.pair or 'unknown', Bucket()).add(t.pnl)
        by_hour.setdefault(f'{t.ts.hour:02d}', Bucket()).add(t.pnl)
        for tag in (t.tags or []):
            by_tag.setdefault(tag, Bucket()).add(t.pnl)

    def _best(buckets: dict[str, Bucket], reverse: bool) -> Optional[str]:
        # Rank by pnl; require >=2 trades so a single fluke doesn't win.
        eligible = {k: b for k, b in buckets.items() if b.trades >= 2}
        pool = eligible or buckets
        if not pool:
            return None
        return (max if reverse else min)(pool, key=lambda k: pool[k].pnl)

    best_pair = _best(by_pair, reverse=True)
    worst_pair = _best(by_pair, reverse=False)
    best_session = _best(by_session, reverse=True)

    return Analytics(
        trades=n, win_rate=win_rate, profit_factor=profit_factor,
        expectancy=expectancy, gross_profit=round(gross_profit, 2),
        gross_loss=round(gross_loss, 2), avg_win=avg_win, avg_loss=avg_loss,
        reward_risk=reward_risk, net_pnl=round(net, 2), max_drawdown=round(max_dd, 2),
        best_pair=best_pair, worst_pair=worst_pair, best_session=best_session,
        by_session={k: b.as_dict() for k, b in by_session.items()},
        by_pair={k: b.as_dict() for k, b in by_pair.items()},
        by_tag={k: b.as_dict() for k, b in by_tag.items()},
        by_hour={k: b.as_dict() for k, b in by_hour.items()},
    )
