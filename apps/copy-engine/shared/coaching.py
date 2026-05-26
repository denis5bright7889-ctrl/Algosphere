"""
copy-engine — AI Trading Coach behavioral analytics (pure, deterministic).

Given a user's recent trades (sorted oldest→newest) this computes the
behavioral metrics + discipline score and the discrete alerts a hedge-fund
PM would raise watching the book. NO I/O, NO LLM — every output is a
deterministic function of the trade sequence, so it is fully unit-testable
and cheap to run per user. The coach worker does the DB I/O around it.

Detections (Phase 4 #1-6, 8):
  • revenge        — size jumps sharply right after a loss
  • oversizing     — individual trades far above the user's own baseline
  • loss_streak    — current run of consecutive losers
  • overtrade      — too many trades per active hour
  • consistency_drift — erratic position sizing (high coeff. of variation)
  • winrate_drop   — win rate after 2+ consecutive losses materially below
                     the overall win rate ("you trade worse when tilted")
"""
from __future__ import annotations
import math
import statistics
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class Trade:
    pnl:  float
    lot:  float
    ts:   datetime           # entry time (journal_entries.created_at)


@dataclass
class Alert:
    kind:     str
    severity: str            # info | warn | critical
    title:    str
    payload:  dict = field(default_factory=dict)


@dataclass
class CoachingResult:
    trades:                 int
    discipline_score:       Optional[float]   # None when too few trades
    win_rate:               Optional[float]
    win_rate_after_losses:  Optional[float]
    current_loss_streak:    int
    max_loss_streak:        int
    revenge_events:         int
    oversize_events:        int
    trades_per_active_hour: Optional[float]
    sizing_cv:              Optional[float]
    alerts:                 list[Alert] = field(default_factory=list)


# ── Tunables ────────────────────────────────────────────────────────────
MIN_TRADES            = 5      # below this, scoring is statistically meaningless
REVENGE_SIZE_RATIO    = 1.5    # next lot ≥ 1.5× prior, immediately after a loss
OVERSIZE_SIGMA        = 2.0    # lot > mean + 2σ → outsized
LOSS_STREAK_ALERT     = 3
OVERTRADE_PER_HOUR    = 6.0    # > 6 trades/active-hour → likely overtrading
DRIFT_CV_THRESHOLD    = 0.6    # sizing coeff. of variation above this = erratic
WINRATE_DROP_DELTA    = 15.0   # pct points below overall to flag tilt


def _is_win(pnl: float) -> bool:
    return pnl > 0


def analyze(trades: list[Trade]) -> CoachingResult:
    n = len(trades)
    if n == 0:
        return CoachingResult(0, None, None, None, 0, 0, 0, 0, None, None)

    trades = sorted(trades, key=lambda t: t.ts)
    lots = [max(t.lot, 0.0) for t in trades]
    wins = sum(1 for t in trades if _is_win(t.pnl))
    win_rate = round(100.0 * wins / n, 2)

    # streaks
    cur = max_streak = 0
    for t in trades:
        if not _is_win(t.pnl):
            cur += 1
            max_streak = max(max_streak, cur)
        else:
            cur = 0
    current_loss_streak = cur

    # revenge: a loss immediately followed by a >=ratio larger lot
    revenge = 0
    for i in range(1, n):
        prev = trades[i - 1]
        if not _is_win(prev.pnl) and prev.lot > 0 and trades[i].lot >= prev.lot * REVENGE_SIZE_RATIO:
            revenge += 1

    # oversizing: trades beyond mean + Nσ of the user's own sizing
    mean_lot = statistics.fmean(lots) if lots else 0.0
    std_lot = statistics.pstdev(lots) if n > 1 else 0.0
    oversize = sum(1 for L in lots if std_lot > 0 and L > mean_lot + OVERSIZE_SIGMA * std_lot)
    sizing_cv = round(std_lot / mean_lot, 4) if mean_lot > 0 else None

    # win rate after 2+ consecutive losses (tilt)
    after, after_wins = 0, 0
    run = 0
    for i, t in enumerate(trades):
        if i > 0 and run >= 2:
            after += 1
            if _is_win(t.pnl):
                after_wins += 1
        run = run + 1 if not _is_win(t.pnl) else 0
    win_rate_after_losses = round(100.0 * after_wins / after, 2) if after > 0 else None

    # win rate after 2+ consecutive WINS — the mirror of tilt. A sharp drop
    # here means the trader gives back gains after a hot streak (classic
    # overconfidence / oversizing-after-wins). Awareness-only: it does NOT
    # feed the discipline score, so persisted scores are unchanged.
    aw_after, aw_wins, wrun = 0, 0, 0
    for i, t in enumerate(trades):
        if i > 0 and wrun >= 2:
            aw_after += 1
            if _is_win(t.pnl):
                aw_wins += 1
        wrun = wrun + 1 if _is_win(t.pnl) else 0
    win_rate_after_wins = round(100.0 * aw_wins / aw_after, 2) if aw_after > 0 else None

    # trades per active hour (span between first and last trade)
    span_h = (trades[-1].ts - trades[0].ts).total_seconds() / 3600.0
    tph = round(n / span_h, 2) if span_h > 0 else None

    # ── discipline score: start 100, subtract bounded penalties ──────
    score: Optional[float] = None
    alerts: list[Alert] = []
    if n >= MIN_TRADES:
        s = 100.0
        s -= min(25, revenge * 8)                                  # revenge is worst
        s -= min(20, oversize * 6)                                 # oversizing
        s -= min(15, max(0, current_loss_streak - 2) * 5)          # active drawdown run
        if tph is not None and tph > OVERTRADE_PER_HOUR:
            s -= min(15, (tph - OVERTRADE_PER_HOUR) * 2)
        if sizing_cv is not None and sizing_cv > DRIFT_CV_THRESHOLD:
            s -= min(15, (sizing_cv - DRIFT_CV_THRESHOLD) * 20)
        if (win_rate_after_losses is not None
                and (win_rate - win_rate_after_losses) >= WINRATE_DROP_DELTA):
            s -= 10
        score = round(max(0.0, min(100.0, s)), 2)

        # ── alerts (only when there's enough history) ────────────────
        if revenge > 0:
            alerts.append(Alert('revenge', 'critical' if revenge >= 3 else 'warn',
                'Sizing spikes after losses',
                {'events': revenge, 'ratio_threshold': REVENGE_SIZE_RATIO}))
        if oversize > 0:
            alerts.append(Alert('oversizing', 'warn',
                'Position sizes beyond your usual range',
                {'events': oversize, 'mean_lot': round(mean_lot, 4),
                 'sigma': OVERSIZE_SIGMA}))
        if current_loss_streak >= LOSS_STREAK_ALERT:
            alerts.append(Alert('loss_streak', 'critical' if current_loss_streak >= 5 else 'warn',
                f'{current_loss_streak} losing trades in a row',
                {'streak': current_loss_streak}))
        if tph is not None and tph > OVERTRADE_PER_HOUR:
            alerts.append(Alert('overtrade', 'warn',
                'Trading frequency above your norm',
                {'trades_per_active_hour': tph, 'threshold': OVERTRADE_PER_HOUR}))
        if sizing_cv is not None and sizing_cv > DRIFT_CV_THRESHOLD:
            alerts.append(Alert('consistency_drift', 'info',
                'Inconsistent position sizing',
                {'sizing_cv': sizing_cv, 'threshold': DRIFT_CV_THRESHOLD}))
        if (win_rate_after_losses is not None
                and (win_rate - win_rate_after_losses) >= WINRATE_DROP_DELTA):
            alerts.append(Alert('winrate_drop', 'warn',
                'Win rate drops sharply after consecutive losses',
                {'win_rate': win_rate, 'after_losses': win_rate_after_losses}))
        if (win_rate_after_wins is not None
                and (win_rate - win_rate_after_wins) >= WINRATE_DROP_DELTA):
            alerts.append(Alert('overconfidence', 'info',
                'Win rate drops after winning streaks — watch for overconfidence',
                {'win_rate': win_rate, 'after_wins': win_rate_after_wins}))

    return CoachingResult(
        trades=n, discipline_score=score, win_rate=win_rate,
        win_rate_after_losses=win_rate_after_losses,
        current_loss_streak=current_loss_streak, max_loss_streak=max_streak,
        revenge_events=revenge, oversize_events=oversize,
        trades_per_active_hour=tph, sizing_cv=sizing_cv, alerts=alerts,
    )


def daily_report_markdown(handle: str, r: CoachingResult) -> str:
    """Deterministic PM-style end-of-day summary from the metrics."""
    grade = ('—' if r.discipline_score is None else
             'A' if r.discipline_score >= 85 else 'B' if r.discipline_score >= 70 else
             'C' if r.discipline_score >= 50 else 'D')
    lines = [
        f'## Daily review',
        f'**Discipline:** {r.discipline_score if r.discipline_score is not None else "n/a"} '
        f'({grade}) · **Trades:** {r.trades} · **Win rate:** '
        f'{r.win_rate if r.win_rate is not None else "n/a"}%',
    ]
    if r.win_rate_after_losses is not None:
        lines.append(f'- Win rate after 2+ losses: **{r.win_rate_after_losses}%** '
                     f'(overall {r.win_rate}%)')
    if r.current_loss_streak:
        lines.append(f'- Current loss streak: **{r.current_loss_streak}** '
                     f'(max {r.max_loss_streak})')
    if r.revenge_events:
        lines.append(f'- ⚠️ Revenge-sizing events: **{r.revenge_events}**')
    if r.oversize_events:
        lines.append(f'- ⚠️ Outsized positions: **{r.oversize_events}**')
    if not r.alerts:
        lines.append('- ✅ No behavioral flags today — disciplined session.')
    else:
        lines.append('')
        lines.append('**Flags:** ' + ', '.join(sorted({a.kind for a in r.alerts})))
    return '\n'.join(lines)
