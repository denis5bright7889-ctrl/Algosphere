"""
chaos_test.py — drive the resilience layer against live Postgres.

Where integration_test.py covers the happy path, this covers the unhappy
ones — the parts whose whole purpose is to handle broker failure:

  • Scenario A — TRANSIENT broker failure → retry-with-backoff → recovery.
      Stub fails the first 2 attempts then succeeds; expect the executor to
      requeue twice and fill on the third claim.

  • Scenario B — EXHAUSTED retries → DLQ → idempotent REPLAY → recovery.
      Stub always fails; expect 3 failures → dead_letter_copy_job → replay_dlq_job
      re-queues the original job; with the broker recovered, it then fills.

The claim RPC is what bumps `attempts` (one per claim), so this test
faithfully exercises the production loop. Backoff is bypassed for speed by
resetting `available_at = NOW()` between claims (a no-op in the resilience
logic, only a fast-forward in time).

Same fixture seed/teardown discipline as integration_test.py: 2 throwaway
auth users + a strategy + an active sub, deleted in a finally.

  python tools/chaos_test.py        # needs SUPABASE_* (service role)
"""
from __future__ import annotations
import os
import sys
import uuid
import asyncio
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from shared.config import load_settings, require
from shared.db import get_db
from shared.models import SignalEvent, CopyJob
from shared.engine_client import ExecResult
import orchestrator
import executor

_P, _F = '  ✓', '  ✗'
SYMBOL = 'EURUSD'


class ChaosEngine:
    """Configurable stub. fail_count_remaining > 0 = next N execute() calls
    fail (then revert to mode); mode='fail' = always fail."""
    def __init__(self):
        self.mode = 'success'
        self.fail_count_remaining = 0
        self.calls = 0

    async def execute(self, *, broker, symbol, side, quantity, user_id,
                      client_order_id, stop_loss=None, take_profit=None,
                      max_slippage_pct=0.002, reduce_only=False) -> ExecResult:
        self.calls += 1
        fail = self.fail_count_remaining > 0 or self.mode == 'fail'
        if self.fail_count_remaining > 0:
            self.fail_count_remaining -= 1
        if fail:
            return ExecResult(ok=False, order_id=None, status=None,
                              filled_qty=0, avg_fill_price=0, slippage_pct=0,
                              broker=broker, testnet=True,
                              error='broker timeout: connection reset')
        return ExecResult(ok=True, order_id=f'chaos-{client_order_id}',
                          status='FILLED', filled_qty=quantity,
                          avg_fill_price=1.1000, slippage_pct=0.0,
                          broker=broker, testnet=True, error=None)

    async def positions(self, *, user_id, broker):
        return {'equity': 10000.0, 'positions': []}


def _ok(cond: bool, label: str, fails: list) -> None:
    print(f'{_P if cond else _F} {label}')
    if not cond:
        fails.append(label)


def _claim_one(db, worker: str) -> CopyJob | None:
    res = db.rpc('claim_copy_jobs', {'p_worker': worker, 'p_limit': 1}).execute()
    rows = res.data or []
    return CopyJob.from_row(rows[0]) if rows else None


def _reset_backoff(db, job_id: str) -> None:
    """Skip the executor's backoff delay (we're testing the logic, not the
    wall-clock). available_at = NOW() makes the row immediately re-claimable.
    Call AFTER _process_job so the requeue's available_at=NOW()+5s is undone."""
    db.table('copy_jobs').update({'available_at': 'now()'}).eq('id', job_id).execute()


def _job_status(db, job_id: str) -> dict:
    return (db.table('copy_jobs').select('status,attempts,last_error,copy_trade_id')
            .eq('id', job_id).execute().data or [{}])[0]


def _job_for_event(db, event_id: str) -> dict | None:
    """Find the (sole) job for a fan-out, robust across re-claims."""
    rows = (db.table('copy_jobs').select('*')
            .eq('signal_event_id', event_id).limit(1).execute().data or [])
    return rows[0] if rows else None


def _seed_open(db, leader_id: str, strategy_id: str, symbol: str = SYMBOL) -> tuple[str, SignalEvent]:
    row = (db.table('signal_events').insert({
        'leader_id': leader_id, 'strategy_id': strategy_id,
        'event_type': 'OPEN', 'symbol': symbol, 'direction': 'buy',
        'payload': {'entry': 1.1000, 'stop_loss': 1.0950,
                    'take_profit': 1.1100, 'lot': 0.10, 'leader_equity': 10000},
        'status': 'pending',
    }).select('*').execute().data[0])
    return row['id'], SignalEvent.from_row(row)


def main() -> int:
    s = load_settings(); require(s)
    db = get_db()
    suffix = uuid.uuid4().hex[:10]
    fails: list[str] = []
    leader_id = follower_id = strategy_id = sub_id = None
    ev_ids: list[str] = []

    try:
        # ── Seed (same shape as integration_test) ────────────────────
        lead = db.auth.admin.create_user({
            'email': f'chaos-leader-{suffix}@example.com',
            'password': f'Pw!{suffix}aA1', 'email_confirm': True})
        foll = db.auth.admin.create_user({
            'email': f'chaos-follower-{suffix}@example.com',
            'password': f'Pw!{suffix}bB2', 'email_confirm': True})
        leader_id, follower_id = lead.user.id, foll.user.id

        strategy_id = (db.table('published_strategies').insert({
            'creator_id': leader_id, 'name': f'chaos {suffix}',
            'slug': f'chaos-{suffix}', 'status': 'active',
            'copy_enabled': True, 'copy_mode': 'full_auto', 'profit_share_pct': 20,
        }).select('id').execute().data[0]['id'])

        sub_id = (db.table('strategy_subscriptions').insert({
            'subscriber_id': follower_id, 'strategy_id': strategy_id,
            'status': 'active', 'copy_enabled': True, 'copy_mode': 'full_auto',
            'allocation_model': 'fixed_ratio', 'fixed_scale': 1.0,
            'copy_sl': True, 'copy_tp': True,
        }).select('id').execute().data[0]['id'])
        print(f'seeded leader={leader_id[:8]} follower={follower_id[:8]} '
              f'strategy={strategy_id[:8]} sub={sub_id[:8]}')

        engine = ChaosEngine()

        # ═════════════════════════════════════════════════════════════
        # SCENARIO A — transient failure → retry → recovery
        # ═════════════════════════════════════════════════════════════
        print('── Scenario A: transient broker failures (fail×2, then success) ──')
        ev_id, ev = _seed_open(db, leader_id, strategy_id)
        ev_ids.append(ev_id)
        n = orchestrator._fan_out(db, ev, 1000)
        _ok(n == 1, f'A: fan-out created {n} job', fails)

        engine.fail_count_remaining = 2
        engine.mode = 'success'
        engine.calls = 0
        a_job_id = (_job_for_event(db, ev_id) or {}).get('id')
        last_status = None
        for attempt in (1, 2, 3):
            job = _claim_one(db, 'chaos-A')
            _ok(job is not None and job.id == a_job_id, f'A.{attempt}: claimed our job', fails)
            if job is None:
                break
            asyncio.run(executor._process_job(db, engine, 'chaos-A', job))
            # Reset backoff AFTER process — _requeue just set available_at to
            # NOW+backoff; we fast-forward time so the next claim picks it up.
            _reset_backoff(db, job.id)
            st = _job_status(db, job.id)
            last_status = st['status']
            expected = 'queued' if attempt <= 2 else 'filled'
            _ok(st['status'] == expected,
                f'A.{attempt}: status={st["status"]} (expected {expected}); attempts={st["attempts"]}', fails)

        _ok(last_status == 'filled', f'A: ultimate status=filled', fails)
        _ok(engine.calls == 3, f'A: stub called exactly 3 times (got {engine.calls})', fails)

        # ═════════════════════════════════════════════════════════════
        # SCENARIO B — exhausted retries → DLQ → replay → recovery
        # ═════════════════════════════════════════════════════════════
        print('── Scenario B: always-fail → DLQ → replay → recovery ──')
        # Different symbol so A's successful mirrored copy doesn't trip the
        # correlation cap on B's job (real production behavior).
        ev_id, ev = _seed_open(db, leader_id, strategy_id, symbol='GBPUSD')
        ev_ids.append(ev_id)
        n = orchestrator._fan_out(db, ev, 1000)
        _ok(n == 1, f'B: fan-out created {n} job', fails)

        engine.mode = 'fail'
        engine.fail_count_remaining = 0
        engine.calls = 0
        b_job_id = (_job_for_event(db, ev_id) or {}).get('id')
        _ok(b_job_id is not None, f'B: located the queued job (id={b_job_id})', fails)
        for attempt in (1, 2, 3):
            job = _claim_one(db, 'chaos-B')
            if job is None or job.id != b_job_id:
                _ok(False, f'B.{attempt}: failed to claim our job (got {job.id if job else None})', fails)
                break
            asyncio.run(executor._process_job(db, engine, 'chaos-B', job))
            _reset_backoff(db, job.id)   # AFTER — _requeue's backoff was just applied

        st = _job_status(db, b_job_id)
        _ok(st['status'] == 'failed' and st['attempts'] == 3,
            f"B: after 3 failures status={st['status']} attempts={st['attempts']}", fails)

        dlq = (db.table('copy_jobs_dlq').select('id,failure_category,attempts,replayed_at,replay_job_id')
               .eq('original_job_id', b_job_id).execute().data or [])
        _ok(len(dlq) == 1, f'B: 1 DLQ row for the dead job (got {len(dlq)})', fails)
        if dlq:
            _ok(dlq[0]['failure_category'] == 'broker_timeout',
                f'B: failure_category=broker_timeout (got {dlq[0]["failure_category"]})', fails)
            _ok(dlq[0]['replayed_at'] is None, 'B: not yet replayed', fails)

            # Replay re-queues the ORIGINAL job (honors UNIQUE constraint).
            res = db.rpc('replay_dlq_job', {'p_dlq_id': dlq[0]['id']}).execute()
            _ok(res.data == b_job_id,
                f'B: replay returned the original job id (got {res.data})', fails)

            st2 = _job_status(db, b_job_id)
            _ok(st2['status'] == 'queued' and st2['attempts'] == 0,
                f"B: post-replay status={st2['status']} attempts={st2['attempts']}", fails)

            # Idempotency: 2nd replay must NOT re-enqueue.
            res2 = db.rpc('replay_dlq_job', {'p_dlq_id': dlq[0]['id']}).execute()
            _ok(res2.data == b_job_id, 'B: replay is idempotent (same job id)', fails)

        # Broker recovers; the replayed job fills.
        engine.mode = 'success'
        engine.fail_count_remaining = 0
        job_after = _claim_one(db, 'chaos-B')
        _ok(job_after is not None and job_after.id == b_job_id,
            'B: re-claimed the replayed job', fails)
        if job_after:
            asyncio.run(executor._process_job(db, engine, 'chaos-B', job_after))
            st3 = _job_status(db, b_job_id)
            _ok(st3['status'] == 'filled',
                f"B: recovered fill, status={st3['status']}", fails)
            if st3.get('copy_trade_id'):
                ct = (db.table('copy_trades').select('status').eq('id', st3['copy_trade_id'])
                      .execute().data or [{}])[0]
                _ok(ct.get('status') == 'mirrored',
                    f"B: copy_trade mirrored (got {ct.get('status')})", fails)

    finally:
        # ── Teardown (FK-safe; users last) ──────────────────────────
        print('── teardown ──')
        def _try(fn):
            try: fn()
            except Exception as e: print(f'  (cleanup) {str(e)[:80]}')
        if leader_id:
            _try(lambda: db.table('creator_earnings').delete().eq('creator_id', leader_id).execute())
        for uid in filter(None, [leader_id, follower_id]):
            _try(lambda u=uid: db.table('social_notifications').delete().eq('recipient_id', u).execute())
            _try(lambda u=uid: db.table('copy_trades').delete().eq('follower_id', u).execute())
            _try(lambda u=uid: db.table('coach_state').delete().eq('user_id', u).execute())
            _try(lambda u=uid: db.table('coach_alerts').delete().eq('user_id', u).execute())
            _try(lambda u=uid: db.table('coach_reports').delete().eq('user_id', u).execute())
            _try(lambda u=uid: db.table('journal_analytics').delete().eq('user_id', u).execute())
            _try(lambda u=uid: db.table('portfolio_exposure').delete().eq('user_id', u).execute())
            _try(lambda u=uid: db.table('copy_reconciliation').delete().eq('follower_id', u).execute())
            _try(lambda u=uid: db.table('journal_entries').delete().eq('user_id', u).execute())
            _try(lambda u=uid: db.table('copy_jobs_dlq').delete().eq('follower_id', u).execute())
        if sub_id:
            _try(lambda: db.table('copy_health').delete().eq('subscription_id', sub_id).execute())
        for ev in ev_ids:
            _try(lambda e=ev: db.table('signal_events').delete().eq('id', e).execute())
        if sub_id:
            _try(lambda: db.table('strategy_subscriptions').delete().eq('id', sub_id).execute())
        if strategy_id:
            _try(lambda: db.table('published_strategies').delete().eq('id', strategy_id).execute())
        for uid in filter(None, [leader_id, follower_id]):
            _try(lambda u=uid: db.auth.admin.delete_user(u))
        print('  cleanup done')

    print('────────────────────────────────────────────────')
    if fails:
        print(f'{len(fails)} CHECK(S) FAILED:')
        for f in fails:
            print(f'   ✗ {f}')
        return 1
    print('ALL GREEN — resilience layer validated: retry/backoff + DLQ + replay.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        import traceback; traceback.print_exc()
        print(f'chaos test error: {e}')
        sys.exit(2)
