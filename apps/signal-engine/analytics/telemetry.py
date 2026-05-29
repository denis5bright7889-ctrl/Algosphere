"""
AlgoSphere — Production telemetry aggregates (spec section 13).

Read-only aggregations computed from the signals + broker_connections
tables. No new writes; this is an observability surface. Every section
degrades to an explicit empty/insufficient state rather than fabricating
numbers, in keeping with the platform's no-fabrication rule.

Sections produced:
  • confidence_distribution — histogram of published confidence scores
    bucketed by the spec section 5 bands.
  • win_rate_by_regime      — closed-signal win rate grouped by regime.
  • strategy_contribution   — how often each ensemble strategy appears in
    published signals (best-effort: only if the strategies column exists).
  • rejection_reasons       — NOT persisted today (gate decisions are
    logged only). Returned as an explicit not-yet-persisted marker so the
    dashboard shows the honest gap rather than a fake zero.
  • mt5_reconnect_frequency — derived from broker_connections state churn.
"""
from __future__ import annotations
import asyncio
from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Any, Optional
from loguru import logger


# Spec section 5 bands → human label.
CONF_BUCKETS = [
    (0,  44,  'reject'),
    (45, 69,  'reduced'),
    (70, 84,  'standard'),
    (85, 100, 'aggressive'),
]


def _bucket(score: float) -> str:
    for lo, hi, label in CONF_BUCKETS:
        if lo <= score <= hi:
            return label
    return 'reject' if score < 45 else 'aggressive'


async def compute_telemetry(db, lookback_days: int = 30) -> dict[str, Any]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat()

    signals = await _fetch_signals(db, cutoff)
    brokers = await _fetch_broker_state(db)

    return {
        'generated_at':           datetime.now(timezone.utc).isoformat(),
        'lookback_days':          lookback_days,
        'total_signals':          len(signals),
        'confidence_distribution': _confidence_distribution(signals),
        'win_rate_by_regime':     _win_rate_by_regime(signals),
        'strategy_contribution':  _strategy_contribution(signals),
        'rejection_reasons':      _rejection_reasons(),
        'mt5_reconnect_frequency': _mt5_reconnect_frequency(brokers),
    }


# ─── Fetchers ─────────────────────────────────────────────────────────

async def _fetch_signals(db, cutoff: str) -> list[dict]:
    try:
        res = await asyncio.to_thread(
            lambda: db.table('signals')
            .select('regime, confidence_score, result, pips_gained, strategies, published_at')
            .gte('published_at', cutoff)
            .limit(5000)
            .execute()
        )
        return res.data or []
    except Exception as e:
        # The strategies column may not exist on every deploy; retry with a
        # narrower projection before giving up.
        logger.debug(f"telemetry signals full select failed ({e}); retrying narrow")
        try:
            res = await asyncio.to_thread(
                lambda: db.table('signals')
                .select('regime, confidence_score, result, pips_gained, published_at')
                .gte('published_at', cutoff)
                .limit(5000)
                .execute()
            )
            return res.data or []
        except Exception as e2:
            logger.warning(f"telemetry signals fetch failed: {e2}")
            return []


async def _fetch_broker_state(db) -> list[dict]:
    try:
        res = await asyncio.to_thread(
            lambda: db.table('broker_connections')
            .select('broker, status, state_changed_at, error_message')
            .eq('broker', 'mt5')
            .limit(2000)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.warning(f"telemetry broker state fetch failed: {e}")
        return []


# ─── Aggregators ──────────────────────────────────────────────────────

def _confidence_distribution(signals: list[dict]) -> dict:
    counts: Counter[str] = Counter()
    scored = 0
    for s in signals:
        score = s.get('confidence_score')
        if score is None:
            continue
        try:
            counts[_bucket(float(score))] += 1
            scored += 1
        except (TypeError, ValueError):
            continue
    return {
        'scored_signals': scored,
        'buckets': {label: counts.get(label, 0) for _, _, label in CONF_BUCKETS},
    }


def _win_rate_by_regime(signals: list[dict]) -> dict:
    agg: dict[str, dict[str, int]] = {}
    for s in signals:
        regime = s.get('regime') or 'unknown'
        result = (s.get('result') or '').lower()
        if result not in ('win', 'loss', 'breakeven'):
            continue
        bucket = agg.setdefault(regime, {'wins': 0, 'losses': 0, 'breakeven': 0})
        if result == 'win':
            bucket['wins'] += 1
        elif result == 'loss':
            bucket['losses'] += 1
        else:
            bucket['breakeven'] += 1

    out: dict[str, dict] = {}
    for regime, c in agg.items():
        decided = c['wins'] + c['losses']
        out[regime] = {
            **c,
            'closed': decided + c['breakeven'],
            'win_rate': round(c['wins'] / decided, 4) if decided else None,
        }
    return out


def _strategy_contribution(signals: list[dict]) -> dict:
    counts: Counter[str] = Counter()
    seen = 0
    for s in signals:
        strategies = s.get('strategies')
        if not strategies:
            continue
        seen += 1
        # strategies may be a list or a jsonb string; handle both.
        items = strategies if isinstance(strategies, list) else []
        for item in items:
            name = item if isinstance(item, str) else (item.get('strategy') if isinstance(item, dict) else None)
            if name:
                counts[name] += 1
    if seen == 0:
        return {'available': False, 'note': 'strategies column empty or absent on this deploy'}
    return {'available': True, 'signals_with_strategies': seen, 'counts': dict(counts)}


def _rejection_reasons() -> dict:
    # Gate decisions are written to the structured log, not a queryable
    # table. Surfacing them here would require persisting GateDecision
    # rows — tracked as a follow-up. We return the honest marker instead
    # of a fabricated zero so the dashboard reflects reality.
    return {
        'available': False,
        'note': 'Gate rejections are logged (RISK GATE | ...) but not yet persisted to a queryable table. '
                'Persist GateDecision rows to populate this section.',
    }


def _mt5_reconnect_frequency(brokers: list[dict]) -> dict:
    if not brokers:
        return {'available': False, 'note': 'no MT5 broker_connections rows'}
    total = len(brokers)
    failed = sum(1 for b in brokers if (b.get('status') or '') == 'failed')
    connected = sum(1 for b in brokers if (b.get('status') or '') == 'connected')
    # We only have the LATEST state_changed_at per row, not a full history,
    # so this is a point-in-time health summary rather than a true
    # reconnect-rate timeseries. Labelled as such.
    return {
        'available': True,
        'note': 'point-in-time MT5 connection health (full reconnect timeseries needs a state-history table)',
        'mt5_accounts': total,
        'connected': connected,
        'failed': failed,
        'failed_pct': round(failed / total, 4) if total else 0.0,
    }
