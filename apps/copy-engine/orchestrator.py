"""
copy-orchestrator — the fan-out planner.

Consumes the Signal Bus (signal_events) and turns each leader event into
one copy_jobs row per active follower-subscription. This is the ONLY
producer of copy_jobs.

Loop (durable poll; NOTIFY can layer on later for latency):
  1. claim_signal_event(worker)  → grabs ONE pending event (SKIP LOCKED),
                                    flips it to 'planning'. Concurrency-safe:
                                    two orchestrator replicas never grab the
                                    same event.
  2. load active copy subscriptions for that leader's strategies
  3. batch-INSERT copy_jobs (chunks of fanout_chunk), ON CONFLICT DO
     NOTHING → idempotent: re-planning the same event never double-orders.
  4. mark signal_events.status='fanned_out', jobs_created=N.

Crash safety: if the worker dies between (1) and (4), the event sits in
'planning'. A reconciler/janitor sweep (or a simple age check) returns
stale 'planning' events to 'pending'. The UNIQUE(signal_event_id,
subscription_id) constraint means re-fan-out is a no-op for jobs already
created, so partial fan-out heals cleanly.

Strategies never execute here — the orchestrator only writes copy_jobs.
"""
from __future__ import annotations
import asyncio
import os

from loguru import logger

from shared.config import load_settings, require
from shared.db import get_db
from shared.models import SignalEvent
from shared.obs_logging import configure_logging
from shared.queue_bus import QueueBus
from shared import metrics
from shared import risk_limits


def _claim_event(db, worker: str) -> SignalEvent | None:
    res = db.rpc('claim_signal_event', {'p_worker': worker}).execute()
    rows = res.data or []
    return SignalEvent.from_row(rows[0]) if rows else None


def _active_subscriptions(db, leader_id: str) -> list[dict]:
    """Active, copy-enabled, auto-mode subscriptions whose strategy belongs
    to this leader. signal_only subs are excluded — they get notified by the
    notifications fabric, not the execution queue."""
    res = (
        db.table('strategy_subscriptions')
        .select('id, subscriber_id, copy_mode, '
                'published_strategies!inner(creator_id, status)')
        .eq('copy_enabled', True)
        .eq('status', 'active')
        .in_('copy_mode', ['semi_auto', 'full_auto'])
        .eq('published_strategies.creator_id', leader_id)
        .eq('published_strategies.status', 'active')
        .execute()
    )
    return res.data or []


def _resolve_default_brokers(db, follower_ids: list[str]) -> dict[str, str]:
    """One query for every follower's default broker, so fan-out doesn't
    N+1. Followers with no default broker map to 'paper' — they still get a
    job; the risk gate decides whether it executes."""
    out: dict[str, str] = {}
    if not follower_ids:
        return out
    res = (
        db.table('broker_connections')
        .select('user_id, broker, is_default')
        .in_('user_id', follower_ids)
        .eq('is_default', True)
        .execute()
    )
    for row in res.data or []:
        out[row['user_id']] = row['broker']
    return out


def _fan_out(db, ev: SignalEvent, chunk: int) -> int:
    subs = _active_subscriptions(db, ev.leader_id)
    if not subs:
        return 0

    follower_ids = list({s['subscriber_id'] for s in subs})
    brokers = _resolve_default_brokers(db, follower_ids)

    rows = [
        {
            'signal_event_id': ev.id,
            'subscription_id': s['id'],
            'follower_id':     s['subscriber_id'],
            'leader_id':       ev.leader_id,
            'broker':          brokers.get(s['subscriber_id'], 'paper'),
            'trace_id':        ev.trace_id,   # propagate the trace onto every job
            'status':          'queued',
            'client_order_id': None,   # set by the executor from the job id
        }
        for s in subs
    ]

    inserted = 0
    for i in range(0, len(rows), chunk):
        batch = rows[i:i + chunk]
        # ON CONFLICT (signal_event_id, subscription_id) DO NOTHING via
        # upsert ignore_duplicates — idempotent re-fan-out.
        res = (
            db.table('copy_jobs')
            .upsert(batch, on_conflict='signal_event_id,subscription_id',
                    ignore_duplicates=True)
            .execute()
        )
        inserted += len(res.data or [])
    return inserted


def _fan_out_close(db, ev: SignalEvent, chunk: int) -> int:
    """A leader CLOSE → one close job per subscription that currently holds an
    open copy on this symbol. The executor flattens that follower's open
    copies (reduce-only) within the job. Idempotent via the existing
    UNIQUE(signal_event_id, subscription_id)."""
    res = (
        db.table('copy_trades')
        .select('subscription_id, follower_id, broker')
        .eq('leader_id', ev.leader_id).eq('symbol', ev.symbol)
        .in_('status', ['mirrored', 'partial'])
        .execute()
    )
    open_trades = res.data or []
    if not open_trades:
        return 0
    # Distinct subscription → one close job each (executor flattens all of
    # that follower's open copies on the symbol within the job).
    seen: dict[str, dict] = {}
    for t in open_trades:
        seen.setdefault(t['subscription_id'], t)

    rows = [
        {
            'signal_event_id': ev.id,
            'subscription_id': sub_id,
            'follower_id':     t['follower_id'],
            'leader_id':       ev.leader_id,
            'broker':          t.get('broker') or 'paper',
            'trace_id':        ev.trace_id,
            'kind':            'close',
            'status':          'queued',
        }
        for sub_id, t in seen.items()
    ]
    inserted = 0
    for i in range(0, len(rows), chunk):
        batch = rows[i:i + chunk]
        r = (db.table('copy_jobs')
             .upsert(batch, on_conflict='signal_event_id,subscription_id',
                     ignore_duplicates=True)
             .execute())
        inserted += len(r.data or [])
    return inserted


def _mark_done(db, event_id: str, jobs: int) -> None:
    db.table('signal_events').update({
        'status': 'fanned_out',
        'jobs_created': jobs,
        'fanned_out_at': 'now()',
    }).eq('id', event_id).execute()


def _mark_failed(db, event_id: str, err: str) -> None:
    db.table('signal_events').update({
        'status': 'failed', 'fanout_error': err[:500],
    }).eq('id', event_id).execute()


async def _process_one(db, worker: str, chunk: int):
    """Returns the number of copy_jobs created (>=0) when an event was
    processed, or None when there was no pending event (caller sleeps)."""
    ev = await asyncio.to_thread(_claim_event, db, worker)
    if ev is None:
        return None

    # CLOSE → fan out reduce-only close jobs against the followers' open
    # copies. MODIFY/CANCEL remain deferred (no-op fan-out for now).
    if ev.event_type == 'CLOSE':
        n = await asyncio.to_thread(_fan_out_close, db, ev, chunk)
        await asyncio.to_thread(_mark_done, db, ev.id, n)
        metrics.FANOUT_JOBS.labels(worker='orchestrator').inc(n)
        logger.bind(trace_id=ev.trace_id, leader_id=ev.leader_id).info(
            f'orchestrator: CLOSE {ev.id[:8]} {ev.symbol} → {n} close jobs')
        return n
    if ev.event_type != 'OPEN':
        await asyncio.to_thread(_mark_done, db, ev.id, 0)
        logger.info(f'orchestrator: {ev.event_type} event {ev.id[:8]} → deferred (no fan-out)')
        return 0

    # Strategy risk gate: a quarantined/disabled strategy does not fan out.
    # (Auto-set by the reconciler when a strategy's realized loss breaches
    # policy, or manually via quarantine_strategy.) Fail-open if unknown.
    if ev.strategy_id:
        inactive = await asyncio.to_thread(
            risk_limits.inactive_strategy_ids, db, [ev.strategy_id])
        if ev.strategy_id in inactive:
            await asyncio.to_thread(_mark_done, db, ev.id, 0)
            logger.warning(f'orchestrator: strategy {ev.strategy_id[:8]} not active — '
                           f'event {ev.id[:8]} skipped (no fan-out)')
            return 0

    try:
        n = await asyncio.to_thread(_fan_out, db, ev, chunk)
        await asyncio.to_thread(_mark_done, db, ev.id, n)
        metrics.FANOUT_JOBS.labels(worker='orchestrator').inc(n)
        logger.bind(trace_id=ev.trace_id, leader_id=ev.leader_id).info(
            f'orchestrator: event {ev.id[:8]} {ev.symbol} → {n} copy_jobs')
        return n
    except Exception as e:
        logger.error(f'orchestrator: fan-out failed for {ev.id[:8]}: {e}')
        await asyncio.to_thread(_mark_failed, db, ev.id, str(e))
        return 0


async def run() -> None:
    s = load_settings()
    require(s)
    configure_logging('copy-orchestrator')
    metrics.start_metrics_server('copy-orchestrator', s.worker_id,
                                 port=int(os.environ.get('METRICS_PORT', 9101)))
    db = get_db()
    bus = QueueBus(s.redis_url, s.redis_stream, s.redis_group,
                   consumer=f'orch-{s.worker_id}')
    await bus.connect()
    logger.info(f'copy-orchestrator up (worker={s.worker_id}, chunk={s.fanout_chunk}, '
                f'redis={"on" if bus.enabled else "off"})')

    idle = s.poll_interval_ms / 1000.0
    while True:
        try:
            result = await _process_one(db, s.worker_id, s.fanout_chunk)
            if result is None:
                await asyncio.sleep(idle)        # no event pending
            elif result > 0:
                await bus.publish(result)        # nudge executors to drain
        except Exception as e:
            logger.error(f'orchestrator loop error (continuing): {e}')
            await asyncio.sleep(idle)


if __name__ == '__main__':
    asyncio.run(run())
