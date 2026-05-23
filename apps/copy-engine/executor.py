"""
copy-executor — the execution workhorse.

Claims batches of copy_jobs and runs each through the pipeline:
    claim → risk gate → allocation → route → persist
Horizontally scalable: run N replicas. SKIP LOCKED guarantees no two
replicas ever touch the same job.

For each job:
  1. load the originating signal_event + the follower's subscription
  2. build the risk context (broker state, open-copy counts) and run the
     copy-level gate — fail → job 'rejected' (terminal, journaled)
  3. size the lot via the Allocation Engine (live follower equity from the
     engine /positions, baseline fallback) — sub-min → 'skipped'
  4. route the order through the engine's /api/v1/execute (which applies
     the non-bypassable 12-gate); idempotent client_order_id = copy_<id>
  5. persist a copy_trades row + final job status; broker fill lands in
     execution_events (→ journal trigger 029, AI hooks)

No broker SDKs here — the engine is the single execution authority. The
loop never raises; every failure becomes a job status + last_error.
"""
from __future__ import annotations
import asyncio
import os
import time
from datetime import datetime, timezone, timedelta

from loguru import logger

from shared.config import load_settings, require
from shared.db import get_db
from shared.models import SignalEvent, Subscription, CopyJob
from shared.engine_client import EngineClient
from shared import allocation as alloc
from shared.risk_gate import copy_gate, GateContext
from shared.obs_logging import configure_logging
from shared.queue_bus import QueueBus
from shared import metrics
from shared import tracing

BASELINE_EQUITY = 10_000.0          # fallback when live equity is unavailable
OPEN_STATES = ('pending', 'mirrored', 'partial')


def _categorize_failure(error: str) -> str:
    """Map a broker/engine error string to a DLQ failure_category. The
    category set is fixed by the copy_jobs_dlq CHECK constraint; transient
    infra conditions (timeout, rate limit, open circuit) map to
    broker_timeout so they retry with backoff."""
    e = (error or '').lower()
    if 'timeout' in e or 'timed out' in e:           return 'broker_timeout'
    if 'rate_limited' in e or 'circuit_open' in e:   return 'broker_timeout'
    if 'broker_error' in e:                          return 'broker_timeout'
    if 'slippage' in e or 'rejected' in e or 'reject' in e: return 'broker_rejection'
    if 'decrypt' in e or 'vault' in e:               return 'decrypt_error'
    if 'engine' in e or '5' in e[:3]:                return 'engine_error'
    return 'unknown'


def _backoff_iso(attempts: int) -> str:
    """Exponential-ish backoff capped at 60s, as an ISO timestamp for
    copy_jobs.available_at."""
    delay = min(60, 5 * max(attempts, 1))
    return (datetime.now(timezone.utc) + timedelta(seconds=delay)) \
        .strftime('%Y-%m-%dT%H:%M:%SZ')


# ─── DB helpers (sync — run via to_thread) ──────────────────────────────

def _claim_batch(db, worker: str, limit: int) -> list[CopyJob]:
    res = db.rpc('claim_copy_jobs', {'p_worker': worker, 'p_limit': limit}).execute()
    return [CopyJob.from_row(r) for r in (res.data or [])]


def _load_event(db, event_id: str) -> SignalEvent | None:
    res = db.table('signal_events').select('*').eq('id', event_id).limit(1).execute()
    rows = res.data or []
    return SignalEvent.from_row(rows[0]) if rows else None


def _load_subscription(db, sub_id: str) -> Subscription | None:
    res = db.table('strategy_subscriptions').select('*').eq('id', sub_id).limit(1).execute()
    rows = res.data or []
    return Subscription.from_row(rows[0]) if rows else None


def _broker_conn(db, user_id: str, broker: str) -> dict | None:
    res = (
        db.table('broker_connections')
        .select('status, is_default')
        .eq('user_id', user_id).eq('broker', broker)
        .limit(1).execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _count_open_same(db, user_id: str, symbol: str, direction: str | None) -> int:
    q = (db.table('copy_trades').select('id', count='exact')
         .eq('follower_id', user_id).eq('symbol', symbol)
         .in_('status', list(OPEN_STATES)))
    if direction:
        q = q.eq('direction', direction)
    res = q.execute()
    return res.count or 0


def _count_today(db, user_id: str) -> int:
    start = datetime.now(timezone.utc).strftime('%Y-%m-%dT00:00:00Z')
    res = (db.table('copy_trades').select('id', count='exact')
           .eq('follower_id', user_id).gte('created_at', start).execute())
    return res.count or 0


def _set_job(db, job_id: str, **fields) -> None:
    db.table('copy_jobs').update(fields).eq('id', job_id).execute()


def _requeue(db, job_id: str, attempts: int, error: str) -> None:
    """Transient failure with retries left → back to the queue with backoff."""
    db.table('copy_jobs').update({
        'status': 'queued', 'claimed_by': None, 'claimed_at': None,
        'available_at': _backoff_iso(attempts), 'last_error': error[:500],
    }).eq('id', job_id).execute()


def _dead_letter(db, job_id: str, category: str, error: str) -> None:
    """Retry-exhausted / non-retryable → atomic move to the DLQ + mark failed."""
    db.rpc('dead_letter_copy_job', {
        'p_job_id': job_id, 'p_category': category, 'p_error': error[:1000],
    }).execute()


def _create_copy_trade(db, *, job: CopyJob, ev: SignalEvent, sub: Subscription,
                       lot: float) -> str | None:
    res = (db.table('copy_trades').insert({
        'subscription_id': sub.id,
        'leader_id':       ev.leader_id,
        'follower_id':     job.follower_id,
        'signal_id':       ev.signal_id,
        'symbol':          ev.symbol,
        'direction':       ev.direction,
        'leader_entry':    ev.entry,
        'leader_lot':      ev.leader_lot or None,
        'follower_lot':    lot,
        'scale_factor':    lot,
        'stop_loss':       ev.stop_loss if sub.copy_sl else None,
        'take_profit':     ev.take_profit if sub.copy_tp else None,
        'copy_mode':       sub.copy_mode,
        'broker':          job.broker,
        'status':          'pending',
    }).select('id').execute())
    rows = res.data or []
    return rows[0]['id'] if rows else None


TERMINAL = {'filled', 'partial', 'rejected', 'skipped', 'failed'}


# ─── Pipeline ───────────────────────────────────────────────────────────

async def _process_job(db, engine: EngineClient, worker: str, job: CopyJob) -> None:
    """Trace + time + meter wrapper around the pipeline. Establishes the
    trace context for the whole job so every log line and metric carries
    the trace_id, and turns an unexpected exception into a retry/DLQ
    decision so the loop never loses a job."""
    ctx = tracing.TraceContext(
        trace_id=job.trace_id or tracing.new_trace_id(), worker=worker,
        job_id=job.id, user_id=job.follower_id, broker=job.broker)
    started = time.perf_counter()
    with tracing.trace_scope(ctx):
        try:
            status = await _run_pipeline(db, engine, worker, job)
        except Exception as e:
            logger.error(f'job {job.id[:8]} pipeline crashed: {e}')
            status = await _handle_failure(db, worker, job, 'engine_error', str(e))
        finally:
            metrics.JOB_DURATION.labels(worker=worker).observe(time.perf_counter() - started)
        if status in TERMINAL:
            metrics.JOBS_COMPLETED.labels(worker=worker, status=status).inc()


async def _handle_failure(db, worker: str, job: CopyJob, category: str,
                          error: str) -> str:
    """Retry-with-backoff if attempts remain, else dead-letter. Returns the
    resulting status so the caller can meter it."""
    if job.attempts < job.max_attempts:
        await asyncio.to_thread(_requeue, db, job.id, job.attempts, error)
        metrics.RETRIES.labels(worker=worker, category=category).inc()
        logger.warning(f'job {job.id[:8]} retry {job.attempts}/{job.max_attempts} '
                       f'({category}): {error[:120]}')
        return 'queued'
    await asyncio.to_thread(_dead_letter, db, job.id, category, error)
    metrics.DLQ.labels(worker=worker, category=category).inc()
    logger.error(f'job {job.id[:8]} dead-lettered ({category}) after '
                 f'{job.attempts} attempts: {error[:160]}')
    return 'failed'


async def _run_pipeline(db, engine: EngineClient, worker: str, job: CopyJob) -> str:
    ev  = await asyncio.to_thread(_load_event, db, job.signal_event_id)
    sub = await asyncio.to_thread(_load_subscription, db, job.subscription_id)
    if ev is None or sub is None:
        # Missing parents are non-retryable — straight to DLQ.
        await asyncio.to_thread(_dead_letter, db, job.id, 'engine_error',
                                'missing signal_event or subscription')
        return 'failed'

    broker = job.broker or 'paper'

    # ── 2. Risk gate ────────────────────────────────────────────────
    await asyncio.to_thread(_set_job, db, job.id, status='risk_check')
    conn = await asyncio.to_thread(_broker_conn, db, job.follower_id, broker)
    open_same = await asyncio.to_thread(
        _count_open_same, db, job.follower_id, ev.symbol, ev.direction)
    daily = await asyncio.to_thread(_count_today, db, job.follower_id)
    ctx = GateContext(
        broker_connected = (broker == 'paper') or (conn is not None),
        broker_state     = 'CONNECTED' if broker == 'paper' else (conn or {}).get('status', 'UNKNOWN'),
        open_same_symbol = open_same,
        daily_copy_count = daily,
        follower_halted  = False,   # engine 12-gate enforces the live kill-switch
    )
    passed, reason = copy_gate(sub, ctx, symbol=ev.symbol)
    if not passed:
        # A rejection is a DECISION, not a failure — terminal, never retried.
        await asyncio.to_thread(_set_job, db, job.id, status='rejected',
                                risk_reason=reason)
        logger.info(f'job {job.id[:8]} rejected: {reason}')
        return 'rejected'
    await asyncio.to_thread(_set_job, db, job.id,
                            risk_passed_at='now()', status='allocating')

    # ── 3. Allocation ───────────────────────────────────────────────
    follower_equity = BASELINE_EQUITY
    pos = await engine.positions(user_id=job.follower_id, broker=broker)
    if pos and pos.get('equity'):
        follower_equity = float(pos['equity'])

    params = alloc.AllocationParams(
        fixed_scale=sub.fixed_scale, risk_pct=sub.risk_pct,
        risk_multiplier=sub.risk_multiplier, max_lot_size=sub.max_lot_size,
    )
    lot = alloc.compute_lot(
        sub.allocation_model, pair=ev.symbol, leader_lot=ev.leader_lot,
        leader_equity=ev.leader_equity, follower_equity=follower_equity,
        entry=ev.entry, stop_loss=ev.stop_loss,
        pip_value=alloc.DEFAULT_PIP_VALUE_USD, p=params,
    )
    if lot < params.min_lot:
        await asyncio.to_thread(_set_job, db, job.id, status='skipped',
                                allocation_model=sub.allocation_model,
                                computed_lot=lot,
                                last_error='sized lot below broker minimum')
        logger.info(f'job {job.id[:8]} skipped: lot {lot} < min')
        return 'skipped'

    if not ev.direction:
        # Non-retryable malformed event.
        await asyncio.to_thread(_dead_letter, db, job.id, 'engine_error',
                                'event missing direction')
        return 'failed'

    # ── 4. Route ─────────────────────────────────────────────────────
    # client_order_id is derived from the STABLE job id, so a retry reuses
    # it and the broker dedupes a possible prior fill. copy_trade is created
    # once and reused across retries (idempotent), keyed off the job.
    coid = f'copy_{job.id[:28]}'
    ct_id = job.copy_trade_id
    if not ct_id:
        ct_id = await asyncio.to_thread(_create_copy_trade, db, job=job, ev=ev, sub=sub, lot=lot)
    await asyncio.to_thread(_set_job, db, job.id, status='routing',
                            allocation_model=sub.allocation_model,
                            computed_lot=lot,
                            client_order_id=coid, copy_trade_id=ct_id)

    exec_started = time.perf_counter()
    result = await engine.execute(
        broker=broker, symbol=ev.symbol, side=ev.direction, quantity=lot,
        user_id=job.follower_id, client_order_id=coid,
        stop_loss=ev.stop_loss if sub.copy_sl else None,
        take_profit=ev.take_profit if sub.copy_tp else None,
    )
    metrics.EXEC_LATENCY.labels(worker=worker, broker=broker).observe(
        time.perf_counter() - exec_started)

    # ── 5. Persist ───────────────────────────────────────────────────
    if result.ok:
        final = 'partial' if (result.status or '').upper() == 'PARTIALLY_FILLED' else 'filled'
        tracing.bind(position_id=result.order_id)
        # Stamp filled_at so copy_health can compute accurate signal→fill lag.
        await asyncio.to_thread(_set_job, db, job.id, status=final, filled_at='now()')
        if ct_id:
            ct_status = 'partial' if final == 'partial' else 'mirrored'
            await asyncio.to_thread(lambda: db.table('copy_trades').update({
                'status':          ct_status,
                'broker':          result.broker,
                'broker_order_id': result.order_id,
                'follower_entry':  result.avg_fill_price,
                'slippage_pct':    result.slippage_pct,
                'opened_at':       'now()',
            }).eq('id', ct_id).execute())
        logger.info(f'job {job.id[:8]} {final}: {ev.symbol} {ev.direction} {lot} '
                    f'@ {result.avg_fill_price} ({result.broker})')
        return final

    # Broker/engine failure → retry-with-backoff or dead-letter.
    category = _categorize_failure(result.error or '')
    return await _handle_failure(db, worker, job, category, result.error or 'broker rejection')


async def run() -> None:
    s = load_settings()
    require(s)
    configure_logging('copy-executor')
    metrics.start_metrics_server('copy-executor', s.worker_id,
                                 port=int(os.environ.get('METRICS_PORT', 9102)))
    db = get_db()
    engine = EngineClient(s)
    bus = QueueBus(s.redis_url, s.redis_stream, s.redis_group,
                   consumer=f'exec-{s.worker_id}')
    await bus.connect()
    logger.info(f'copy-executor up (worker={s.worker_id}, batch={s.batch_size}, '
                f'redis={"on" if bus.enabled else "off"})')

    idle_ms = s.poll_interval_ms
    while True:
        try:
            jobs = await asyncio.to_thread(_claim_batch, db, s.worker_id, s.batch_size)
            if not jobs:
                # Block on a Redis wakeup (low latency); falls back to a
                # plain sleep of the same duration when Redis is off. Either
                # way we re-claim next — the durable queue is authoritative.
                await bus.wait_for_work(idle_ms)
                continue
            metrics.JOBS_CLAIMED.labels(worker=s.worker_id).inc(len(jobs))
            # Process the batch concurrently — each job is independent.
            await asyncio.gather(*(_process_job(db, engine, s.worker_id, j) for j in jobs),
                                 return_exceptions=True)
            # Loop straight back to claim again — drain fully before waiting.
        except Exception as e:
            logger.error(f'executor loop error (continuing): {e}')
            await asyncio.sleep(idle_ms / 1000.0)


if __name__ == '__main__':
    asyncio.run(run())
