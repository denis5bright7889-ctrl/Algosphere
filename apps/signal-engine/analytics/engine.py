"""
AlgoSphere Analytics Engine
Confidence calibration: compares predicted confidence scores against actual outcomes.
Computes tier accuracy, per-symbol win rates, and calibration drift.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional
from loguru import logger


@dataclass
class TierStats:
    tier: str
    total: int
    wins: int
    losses: int
    win_rate: float
    avg_confidence: float


@dataclass
class CalibrationReport:
    generated_at: str
    total_signals: int
    closed_signals: int
    overall_win_rate: float
    by_tier: list[TierStats]
    by_symbol: dict[str, dict]
    calibration_error: float   # mean |predicted_win_prob - actual_win_rate|
    regime_performance: dict[str, dict]


CONFIDENCE_TO_EXPECTED_WIN = {
    # tier → expected win rate range (lower_bound)
    'blocked':     0.0,
    'normal':      0.40,
    'aggressive':  0.55,
    'exceptional': 0.70,
}


def _confidence_to_tier(score: int) -> str:
    if score < 50:   return 'blocked'
    if score < 65:   return 'normal'
    if score < 80:   return 'aggressive'
    return 'exceptional'


def _win_rate(wins: int, total: int) -> float:
    return round(wins / total, 4) if total else 0.0


async def compute_calibration(db, lookback_days: int = 30) -> Optional[CalibrationReport]:
    """
    Fetches closed engine signals from Supabase and computes calibration metrics.
    Returns None if insufficient data.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat()

    try:
        result = (
            db.table('signals')
            .select('id,pair,confidence_score,result,regime,lifecycle_state,published_at')
            .eq('engine_version', 'algo_v1')
            .in_('lifecycle_state', ['tp1_hit', 'tp2_hit', 'tp3_hit', 'stopped', 'breakeven'])
            .gte('published_at', cutoff)
            .execute()
        )
        rows = result.data or []
    except Exception as e:
        logger.error(f"Calibration fetch failed: {e}")
        return None

    if len(rows) < 5:
        logger.info(f"Calibration: only {len(rows)} closed signals — skipping")
        return None

    total = len(rows)
    wins = sum(1 for r in rows if r.get('result') == 'win')

    # By tier
    tier_buckets: dict[str, list] = {t: [] for t in ('blocked', 'normal', 'aggressive', 'exceptional')}
    for row in rows:
        score = row.get('confidence_score') or 0
        tier = _confidence_to_tier(score)
        tier_buckets[tier].append(row)

    by_tier: list[TierStats] = []
    calibration_errors: list[float] = []

    for tier_name, bucket in tier_buckets.items():
        if not bucket:
            continue
        t_wins = sum(1 for r in bucket if r.get('result') == 'win')
        t_total = len(bucket)
        avg_conf = sum(r.get('confidence_score') or 0 for r in bucket) / t_total
        wr = _win_rate(t_wins, t_total)

        # Calibration error: |expected - actual|
        expected = CONFIDENCE_TO_EXPECTED_WIN.get(tier_name, 0.5)
        calibration_errors.append(abs(expected - wr))

        by_tier.append(TierStats(
            tier=tier_name,
            total=t_total,
            wins=t_wins,
            losses=t_total - t_wins,
            win_rate=wr,
            avg_confidence=round(avg_conf, 1),
        ))

    # By symbol
    sym_buckets: dict[str, list] = {}
    for row in rows:
        sym = row.get('pair', 'unknown')
        sym_buckets.setdefault(sym, []).append(row)

    by_symbol: dict[str, dict] = {}
    for sym, bucket in sym_buckets.items():
        sym_wins = sum(1 for r in bucket if r.get('result') == 'win')
        by_symbol[sym] = {
            'total': len(bucket),
            'wins':  sym_wins,
            'win_rate': _win_rate(sym_wins, len(bucket)),
        }

    # By regime
    regime_buckets: dict[str, list] = {}
    for row in rows:
        reg = row.get('regime', 'unknown') or 'unknown'
        regime_buckets.setdefault(reg, []).append(row)

    regime_perf: dict[str, dict] = {}
    for reg, bucket in regime_buckets.items():
        reg_wins = sum(1 for r in bucket if r.get('result') == 'win')
        regime_perf[reg] = {
            'total': len(bucket),
            'wins':  reg_wins,
            'win_rate': _win_rate(reg_wins, len(bucket)),
        }

    mean_cal_error = round(sum(calibration_errors) / len(calibration_errors), 4) if calibration_errors else 0.0

    return CalibrationReport(
        generated_at=datetime.now(timezone.utc).isoformat(),
        total_signals=total,
        closed_signals=total,
        overall_win_rate=_win_rate(wins, total),
        by_tier=by_tier,
        by_symbol=by_symbol,
        calibration_error=mean_cal_error,
        regime_performance=regime_perf,
    )


async def save_analytics_snapshot(db, report: CalibrationReport) -> None:
    """Persist calibration snapshot to analytics_snapshots table."""
    try:
        db.table('analytics_snapshots').insert({
            'snapshot_type': 'confidence_calibration',
            'data': {
                'overall_win_rate': report.overall_win_rate,
                'total_signals':    report.total_signals,
                'calibration_error': report.calibration_error,
                'by_tier': [
                    {
                        'tier':           t.tier,
                        'total':          t.total,
                        'win_rate':       t.win_rate,
                        'avg_confidence': t.avg_confidence,
                    }
                    for t in report.by_tier
                ],
                'regime_performance': report.regime_performance,
            },
            'created_at': datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        logger.warning(f"Failed to save analytics snapshot: {e}")
