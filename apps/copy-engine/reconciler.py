"""
copy-reconciler — the Sync + PnL Tracker.

Three responsibilities, run on a slow loop (default every 30s):

  1. JANITOR — reclaim_stale_copy_jobs(): jobs whose executor died
     mid-flight (claim lease expired) go back to 'queued' for retry, or to
     'failed' once max_attempts is spent. Also rescues signal_events stuck
     in 'planning' (orchestrator died mid fan-out) by returning them to
     'pending' so fan-out re-runs (idempotent via the UNIQUE constraint).

  2. POSITION DIFF — for each follower with open (mirrored) copy_trades,
     read live broker positions via the engine /positions and compare:
        • open here, absent at broker      → 'desync_missing'
        • position at broker, none here     → 'orphan_position' (alert only;
                                              never auto-closes a user's trade)
     Each discrepancy is written once to copy_reconciliation (open rows are
     de-duplicated so a persistent desync doesn't spam the ledger).

  3. (hook) PnL settlement on CLOSE — left to the existing
     lib/copy-settlement.ts lifecycle path; the reconciler only flags state,
     it does not compute payouts (keeps money math in one place).

Read-only against brokers. It can flag, retry, and alert — it never
submits or closes orders, so it cannot disturb live execution.
"""
from __future__ import annotations
import asyncio
import os
from datetime import datetime, timezone, timedelta

from loguru import logger

from shared.config import load_settings, require
from shared.db import get_db
from shared.engine_client import EngineClient
from shared.obs_logging import configure_logging
from shared import metrics

RECON_INTERVAL_S    = 30
PLANNING_LEASE_S    = 120    # signal_events stuck in 'planning' beyond this → re-queue
MAX_FOLLOWERS_SCAN  = 200    # bound the position-diff per pass (fairness + cost)
OPEN_STATES         = ('mirrored', 'partial')
HEALTH_WINDOW_HOURS = 24     # rolling window for copy-health scoring
HEALTH_EVERY_N_PASSES = 4    # recompute health every Nth reconcile pass (~2 min)


# ─── 1. Janitor ─────────────────────────────────────────────────────────

def _reclaim_jobs(db, lease_s: int) -> int:
    res = db.rpc('reclaim_stale_copy_jobs', {'p_lease_seconds': lease_s}).execute()
    # RPC returns the integer row count.
    return int(res.data) if isinstance(res.data, int) else (res.data or 0)


def _rescue_planning_events(db) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=PLANNING_LEASE_S)) \
        .strftime('%Y-%m-%dT%H:%M:%SZ')
    res = (db.table('signal_events').update({'status': 'pending'})
           .eq('status', 'planning').lt('created_at', cutoff).execute())
    return len(res.data or [])


# ─── 2. Position diff ────────────────────────────────────────────────────

def _open_copy_trades(db, limit: int) -> list[dict]:
    res = (db.table('copy_trades')
           .select('id, follower_id, broker, symbol, direction, status')
           .in_('status', list(OPEN_STATES))
           .order('opened_at', desc=False)
           .limit(limit).execute())
    return res.data or []


def _has_open_recon(db, copy_trade_id: str, kind: str) -> bool:
    res = (db.table('copy_reconciliation').select('id')
           .eq('copy_trade_id', copy_trade_id).eq('kind', kind)
           .is_('resolved_at', 'null').limit(1).execute())
    return bool(res.data)


def _write_recon(db, *, follower_id: str, copy_trade_id: str | None, kind: str,
                 severity: str, expected: dict, observed: dict) -> None:
    db.table('copy_reconciliation').insert({
        'follower_id':   follower_id,
        'copy_trade_id': copy_trade_id,
        'kind':          kind,
        'severity':      severity,
        'expected':      expected,
        'observed':      observed,
        'resolution':    'manual_required',
    }).execute()


async def _diff_follower(db, engine: EngineClient, follower_id: str, broker: str,
                         trades: list[dict]) -> int:
    """Compare this follower's open copy_trades on one broker against live
    positions. Returns the number of new reconciliation rows written."""
    pos_resp = await engine.positions(user_id=follower_id, broker=broker)
    if pos_resp is None:
        return 0   # broker unreachable this pass — try again next loop

    live = pos_resp.get('positions') or []
    live_symbols = {p['symbol'].upper() for p in live}
    written = 0

    # open here, absent at broker → desync_missing
    for t in trades:
        sym = (t['symbol'] or '').upper()
        if sym and sym not in live_symbols:
            if not await asyncio.to_thread(_has_open_recon, db, t['id'], 'desync_missing'):
                await asyncio.to_thread(
                    _write_recon, db, follower_id=follower_id, copy_trade_id=t['id'],
                    kind='desync_missing', severity='critical',
                    expected={'symbol': sym, 'direction': t['direction'], 'status': t['status']},
                    observed={'broker_symbols': sorted(live_symbols)})
                metrics.RECON_FLAGGED.labels(worker='reconciler', kind='desync_missing').inc()
                written += 1

    # position at broker, none tracked here → orphan_position (alert only)
    tracked = {(t['symbol'] or '').upper() for t in trades}
    for p in live:
        sym = p['symbol'].upper()
        if sym not in tracked:
            # de-dupe orphan alerts per (follower, symbol) using a synthetic check
            existing = (db.table('copy_reconciliation').select('id')
                        .eq('follower_id', follower_id).eq('kind', 'orphan_position')
                        .is_('resolved_at', 'null')
                        .contains('observed', {'symbol': sym}).limit(1).execute())
            if not (existing.data or []):
                await asyncio.to_thread(
                    _write_recon, db, follower_id=follower_id, copy_trade_id=None,
                    kind='orphan_position', severity='warn',
                    expected={}, observed={'symbol': sym, 'qty': p.get('qty'),
                                           'side': p.get('side')})
                metrics.RECON_FLAGGED.labels(worker='reconciler', kind='orphan_position').inc()
                written += 1

    return written


async def _position_diff(db, engine: EngineClient) -> dict:
    rows = await asyncio.to_thread(_open_copy_trades, db, MAX_FOLLOWERS_SCAN)
    # group by (follower, broker)
    groups: dict[tuple[str, str], list[dict]] = {}
    for t in rows:
        key = (t['follower_id'], t.get('broker') or 'paper')
        groups.setdefault(key, []).append(t)

    flagged = 0
    for (follower_id, broker), trades in groups.items():
        try:
            n = await _diff_follower(db, engine, follower_id, broker, trades)
            flagged += n
        except Exception as e:
            logger.warning(f'reconcile diff failed for {follower_id[:8]}/{broker}: {e}')
    return {'followers_checked': len(groups), 'flagged': flagged}


def _queue_depth(db) -> int:
    res = (db.table('copy_jobs').select('id', count='exact')
           .eq('status', 'queued').limit(1).execute())
    return res.count or 0


# ─── Copy-health scoring ─────────────────────────────────────────────────

def _recompute_health(db, window_hours: int) -> int:
    res = db.rpc('recompute_copy_health', {'p_window_hours': window_hours}).execute()
    return int(res.data) if isinstance(res.data, int) else (res.data or 0)


def _publish_health_gauges(db) -> None:
    """Read back the scored rows and expose aggregates for Grafana."""
    rows = (db.table('copy_health')
            .select('health_score, health_label, p95_lag_ms')
            .limit(10000).execute().data or [])
    scored = [r for r in rows if r.get('health_score') is not None]
    if scored:
        metrics.COPY_HEALTH_AVG.set(
            sum(float(r['health_score']) for r in scored) / len(scored))
        p95s = [float(r['p95_lag_ms']) for r in scored if r.get('p95_lag_ms') is not None]
        if p95s:
            metrics.COPY_LAG_P95_AVG.set(sum(p95s) / len(p95s))
    by_label: dict[str, int] = {}
    for r in rows:
        lbl = r.get('health_label') or 'idle'
        by_label[lbl] = by_label.get(lbl, 0) + 1
    for lbl in ('excellent', 'good', 'degraded', 'poor', 'idle'):
        metrics.COPY_HEALTH_SUBS.labels(label=lbl).set(by_label.get(lbl, 0))


# ─── Loop ─────────────────────────────────────────────────────────────────

async def run_once(db, engine: EngineClient, lease_s: int, do_health: bool) -> dict:
    reclaimed = await asyncio.to_thread(_reclaim_jobs, db, lease_s)
    rescued   = await asyncio.to_thread(_rescue_planning_events, db)
    diff      = await _position_diff(db, engine)
    # Publish queue depth so Grafana can alert on a backing-up pipeline.
    try:
        metrics.QUEUE_DEPTH.set(await asyncio.to_thread(_queue_depth, db))
    except Exception:
        pass
    scored = 0
    if do_health:
        try:
            scored = await asyncio.to_thread(_recompute_health, db, HEALTH_WINDOW_HOURS)
            await asyncio.to_thread(_publish_health_gauges, db)
        except Exception as e:
            logger.warning(f'copy-health recompute skipped: {e}')
    summary = {'reclaimed_jobs': reclaimed, 'rescued_events': rescued,
               'health_scored': scored, **diff}
    if reclaimed or rescued or diff['flagged'] or scored:
        logger.info(f'reconcile: {summary}')
    return summary


async def run() -> None:
    s = load_settings()
    require(s)
    configure_logging('copy-reconciler')
    metrics.start_metrics_server('copy-reconciler', s.worker_id,
                                 port=int(os.environ.get('METRICS_PORT', 9103)))
    db = get_db()
    engine = EngineClient(s)
    logger.info(f'copy-reconciler up (interval={RECON_INTERVAL_S}s, lease={s.job_lease_s}s)')

    tick = 0
    while True:
        try:
            tick += 1
            await run_once(db, engine, s.job_lease_s,
                           do_health=(tick % HEALTH_EVERY_N_PASSES == 0))
        except Exception as e:
            logger.error(f'reconciler loop error (continuing): {e}')
        await asyncio.sleep(RECON_INTERVAL_S)


if __name__ == '__main__':
    asyncio.run(run())
