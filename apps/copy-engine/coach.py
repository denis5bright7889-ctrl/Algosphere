"""
coach — AI Trading Coach worker (analyze-only).

Periodically reads each active trader's recent realized journal_entries,
runs the deterministic behavioral analytics (shared/coaching.py), and
writes:
  • coach_state   — the rolling discipline scorecard
  • coach_alerts  — de-duplicated behavioral flags (one open per kind/user)
  • coach_reports — a daily PM-style summary (upsert per user/day)

It NEVER touches the execution path — it only reads journal_entries and
writes coach_* tables. If it's down, trading is unaffected; coaching just
pauses. Bounded per pass (MAX_USERS_SCAN) for fairness + cost.
"""
from __future__ import annotations
import os
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional

from loguru import logger

from shared.config import load_settings, require
from shared.db import get_db
from shared.obs_logging import configure_logging
from shared import metrics
from shared import coaching
from shared.coaching import Trade
from shared import journal_analytics
from shared.journal_analytics import JTrade

COACH_INTERVAL_S = 300        # 5 min
WINDOW_DAYS      = 30
MAX_USERS_SCAN   = 200


def _cutoff_iso(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')


def _recent_users(db, days: int, limit: int) -> list[str]:
    """Distinct users with realized (pnl-bearing) trades in the window. We
    over-select rows then dedupe in Python (PostgREST has no DISTINCT)."""
    res = (db.table('journal_entries')
           .select('user_id')
           .gte('created_at', _cutoff_iso(days))
           .not_.is_('pnl', 'null')
           .limit(limit * 50).execute())
    seen: list[str] = []
    s: set[str] = set()
    for r in res.data or []:
        uid = r['user_id']
        if uid and uid not in s:
            s.add(uid); seen.append(uid)
            if len(seen) >= limit:
                break
    return seen


def _load_rows(db, user_id: str, days: int) -> list[dict]:
    """One query feeds both the behavioral (coaching) and performance
    (journal_analytics) passes."""
    res = (db.table('journal_entries')
           .select('pnl,lot_size,pair,session,ai_tags,created_at')
           .eq('user_id', user_id)
           .gte('created_at', _cutoff_iso(days))
           .not_.is_('pnl', 'null')
           .order('created_at', desc=False).limit(1000).execute())
    return res.data or []


def _parse_ts(raw) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
    except Exception:
        return None


def _to_trades(rows: list[dict]) -> tuple[list[Trade], list[JTrade]]:
    behav: list[Trade] = []
    perf: list[JTrade] = []
    for r in rows:
        ts = _parse_ts(r.get('created_at'))
        if ts is None:
            continue
        pnl = float(r.get('pnl') or 0)
        behav.append(Trade(pnl=pnl, lot=float(r.get('lot_size') or 0), ts=ts))
        perf.append(JTrade(pnl=pnl, pair=r.get('pair') or 'unknown', ts=ts,
                           session=r.get('session'), tags=list(r.get('ai_tags') or [])))
    return behav, perf


def _upsert_state(db, user_id: str, r: coaching.CoachingResult) -> None:
    db.table('coach_state').upsert({
        'user_id': user_id, 'window_days': WINDOW_DAYS, 'trades': r.trades,
        'discipline_score': r.discipline_score, 'win_rate': r.win_rate,
        'win_rate_after_losses': r.win_rate_after_losses,
        'current_loss_streak': r.current_loss_streak,
        'max_loss_streak': r.max_loss_streak, 'revenge_events': r.revenge_events,
        'oversize_events': r.oversize_events,
        'trades_per_active_hour': r.trades_per_active_hour,
        'sizing_cv': r.sizing_cv, 'computed_at': 'now()',
    }, on_conflict='user_id').execute()


def _open_alert_kinds(db, user_id: str) -> set[str]:
    res = (db.table('coach_alerts').select('kind')
           .eq('user_id', user_id).eq('acknowledged', False).execute())
    return {r['kind'] for r in (res.data or [])}


def _insert_alerts(db, user_id: str, alerts) -> int:
    """Insert only kinds not already open for this user (no spam). For
    warn/critical findings, also drop an in-app notification into
    social_notifications (the web app already renders these) — the coach's
    'real-time coaching notification' last mile, DB-only. Returns the count
    newly raised."""
    open_kinds = _open_alert_kinds(db, user_id)
    new = [a for a in alerts if a.kind not in open_kinds]
    for a in new:
        db.table('coach_alerts').insert({
            'user_id': user_id, 'kind': a.kind, 'severity': a.severity,
            'title': a.title, 'payload': a.payload,
        }).execute()
        metrics.COACH_ALERTS.labels(kind=a.kind).inc()
        if a.severity in ('warn', 'critical'):
            try:
                db.table('social_notifications').insert({
                    'recipient_id': user_id, 'notif_type': 'coach_alert',
                    'entity_type': 'coach',
                    'message': f'Coach: {a.title}',
                }).execute()
            except Exception as e:
                logger.warning(f'coach notification skipped: {e}')
    return len(new)


# Per-scope window (days) for the report tiers.
_SCOPE_DAYS = {'daily': 1, 'weekly': 7, 'monthly': 30}


def _period_start(scope: str, today):
    if scope == 'daily':
        return today
    if scope == 'weekly':
        return today - timedelta(days=today.weekday())   # ISO week (Monday)
    return today.replace(day=1)                           # month start


def _write_reports(db, user_id: str, behav) -> None:
    """Write daily/weekly/monthly PM-style reports. Each is the coaching
    analysis over that scope's trade window; idempotent upsert per
    (user, scope, period_start) so the current period's report stays fresh."""
    today = datetime.now(timezone.utc).date()
    now = datetime.now(timezone.utc)
    for scope, days in _SCOPE_DAYS.items():
        cutoff = now - timedelta(days=days)
        subset = [t for t in behav if t.ts >= cutoff]
        r = coaching.analyze(subset)
        db.table('coach_reports').upsert({
            'user_id': user_id, 'scope': scope,
            'period_start': _period_start(scope, today).isoformat(),
            'period_end': today.isoformat(),
            'body_markdown': coaching.daily_report_markdown(user_id[:8], r),
            'metrics': {
                'discipline_score': r.discipline_score, 'trades': r.trades,
                'win_rate': r.win_rate, 'win_rate_after_losses': r.win_rate_after_losses,
                'current_loss_streak': r.current_loss_streak,
                'revenge_events': r.revenge_events, 'oversize_events': r.oversize_events,
            },
        }, on_conflict='user_id,scope,period_start').execute()


def _upsert_analytics(db, user_id: str, a: journal_analytics.Analytics) -> None:
    db.table('journal_analytics').upsert({
        'user_id': user_id, 'window_days': WINDOW_DAYS, 'trades': a.trades,
        'win_rate': a.win_rate, 'profit_factor': a.profit_factor,
        'expectancy': a.expectancy, 'gross_profit': a.gross_profit,
        'gross_loss': a.gross_loss, 'avg_win': a.avg_win, 'avg_loss': a.avg_loss,
        'reward_risk': a.reward_risk, 'net_pnl': a.net_pnl,
        'max_drawdown': a.max_drawdown, 'best_pair': a.best_pair,
        'worst_pair': a.worst_pair, 'best_session': a.best_session,
        'by_session': a.by_session, 'by_pair': a.by_pair,
        'by_tag': a.by_tag, 'by_hour': a.by_hour, 'computed_at': 'now()',
    }, on_conflict='user_id').execute()


def _process_user(db, user_id: str) -> tuple[bool, int]:
    rows = _load_rows(db, user_id, WINDOW_DAYS)
    if not rows:
        return False, 0
    behav, perf = _to_trades(rows)
    # Behavioral coaching.
    r = coaching.analyze(behav)
    _upsert_state(db, user_id, r)
    raised = _insert_alerts(db, user_id, r.alerts)
    _write_reports(db, user_id, behav)
    # Performance analytics (same trade load).
    _upsert_analytics(db, user_id, journal_analytics.compute(perf))
    return (r.discipline_score is not None), raised


async def run_once(db) -> dict:
    users = await asyncio.to_thread(_recent_users, db, WINDOW_DAYS, MAX_USERS_SCAN)
    scored, alerts, total_score, n_scored = 0, 0, 0.0, 0
    for uid in users:
        try:
            ok, raised = await asyncio.to_thread(_process_user, db, uid)
            alerts += raised
            if ok:
                scored += 1
        except Exception as e:
            logger.warning(f'coach: user {uid[:8]} skipped: {e}')
    # Publish avg discipline across scored users.
    try:
        rows = (db.table('coach_state').select('discipline_score')
                .not_.is_('discipline_score', 'null').limit(10000).execute().data or [])
        if rows:
            metrics.COACH_DISCIPLINE_AVG.set(
                sum(float(x['discipline_score']) for x in rows) / len(rows))
    except Exception:
        pass
    summary = {'users': len(users), 'scored': scored, 'alerts_raised': alerts}
    if users:
        logger.info(f'coach: {summary}')
    return summary


async def run() -> None:
    s = load_settings()
    require(s)
    configure_logging('coach')
    metrics.start_metrics_server('coach', s.worker_id,
                                 port=int(os.environ.get('METRICS_PORT', 9104)))
    db = get_db()
    logger.info(f'coach up (interval={COACH_INTERVAL_S}s, window={WINDOW_DAYS}d)')
    while True:
        try:
            await run_once(db)
        except Exception as e:
            logger.error(f'coach loop error (continuing): {e}')
        await asyncio.sleep(COACH_INTERVAL_S)


if __name__ == '__main__':
    asyncio.run(run())
