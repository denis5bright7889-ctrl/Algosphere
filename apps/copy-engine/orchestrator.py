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

    # OPEN events fan out into orders. CLOSE/MODIFY/CANCEL are handled by
    # the reconciler (which sizes reduce-only closes against actual open
    # positions, not subscription settings).
    if ev.event_type != 'OPEN':
        await asyncio.to_thread(_mark_done, db, ev.id, 0)
        logger.info(f'orchestrator: {ev.event_type} event {ev.id[:8]} → reconciler path')
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
