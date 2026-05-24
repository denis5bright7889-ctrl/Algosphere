"""
live_pipeline_check.py — observe the DEPLOYED workers process a real signal.

Unlike integration_test.py (which drives the worker functions locally with a
stub broker), this seeds a fixture and just WATCHES the Railway-deployed
copy-orchestrator + copy-executor process the event end-to-end. Validates
that the bus → fan-out → claim → risk → allocation → engine /execute →
copy_trade chain works in actual production.

Workers must be running and pointed at the same Supabase. The follower has
no broker_connections, so the orchestrator defaults broker='paper' — the
engine's PaperBroker fills it, no real money moves.

  python tools/live_pipeline_check.py

Polls up to LIVE_TIMEOUT_S (default 60). Cleans up the test rows in finally
(auth users last, so cascades fire).
"""
from __future__ import annotations
import os
import sys
import time
import uuid
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from shared.config import load_settings, require
from shared.db import get_db

SYMBOL = 'EURUSD'
TIMEOUT = int(os.environ.get('LIVE_TIMEOUT_S', '90'))
_P, _F = '  ✓', '  ✗'


def _wait_for(predicate, timeout_s: int, interval_s: float = 1.0):
    """Poll predicate() every interval until truthy or timeout. Returns the
    last value (truthy or last falsy)."""
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        last = predicate()
        if last:
            return last
        time.sleep(interval_s)
    return last


def main() -> int:
    s = load_settings(); require(s)
    db = get_db()
    suffix = uuid.uuid4().hex[:8]
    fails: list[str] = []
    leader_id = follower_id = strategy_id = sub_id = ev_id = None

    try:
        # ── Seed ────────────────────────────────────────────────────
        lead = db.auth.admin.create_user({
            'email': f'live-leader-{suffix}@example.com',
            'password': f'Pw!{suffix}aA1', 'email_confirm': True})
        foll = db.auth.admin.create_user({
            'email': f'live-follower-{suffix}@example.com',
            'password': f'Pw!{suffix}bB2', 'email_confirm': True})
        leader_id, follower_id = lead.user.id, foll.user.id
        strategy_id = (db.table('published_strategies').insert({
            'creator_id': leader_id, 'name': f'live {suffix}',
            'slug': f'live-{suffix}', 'status': 'active',
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

        # ── Publish OPEN to the bus ─────────────────────────────────
        t0 = time.time()
        ev_row = (db.table('signal_events').insert({
            'leader_id': leader_id, 'strategy_id': strategy_id,
            'event_type': 'OPEN', 'symbol': SYMBOL, 'direction': 'buy',
            'payload': {'entry': 1.1000, 'stop_loss': 1.0950,
                        'take_profit': 1.1100, 'lot': 0.10,
                        'leader_equity': 10000},
            'status': 'pending',
        }).select('id,trace_id').execute().data[0])
        ev_id = ev_row['id']
        print(f'published signal_event id={ev_id[:8]} trace={ev_row["trace_id"]}')
        print(f'… waiting up to {TIMEOUT}s for Railway workers to process …')

        # ── Wait for orchestrator to fan out ────────────────────────
        fanned = _wait_for(lambda: (db.table('signal_events')
            .select('status,jobs_created,fanned_out_at')
            .eq('id', ev_id).limit(1).execute().data or [{}])[0]
            if (db.table('signal_events').select('status').eq('id', ev_id)
                .limit(1).execute().data[0]['status']) == 'fanned_out' else None,
            timeout_s=TIMEOUT)
        if fanned:
            t_fan = time.time() - t0
            _ok = (fanned.get('jobs_created') or 0) >= 1
            print(f'{_P if _ok else _F} orchestrator fanned out in {t_fan:.2f}s '
                  f'(jobs_created={fanned.get("jobs_created")})')
            if not _ok:
                fails.append('orchestrator created 0 jobs')
        else:
            fails.append('orchestrator never fanned out (timeout)')
            print(f'{_F} orchestrator never picked up the event in {TIMEOUT}s')
            return 1

        # ── Wait for executor to fill ───────────────────────────────
        terminal = {'filled', 'partial', 'rejected', 'skipped', 'failed'}
        job = _wait_for(lambda: (lambda r: r[0] if r and r[0].get('status') in terminal else None)(
            (db.table('copy_jobs').select('id,status,attempts,risk_reason,last_error,copy_trade_id')
             .eq('signal_event_id', ev_id).limit(1).execute().data or [{}])),
            timeout_s=TIMEOUT)
        if job:
            t_exec = time.time() - t0
            print(f'  executor reached terminal status in {t_exec:.2f}s: '
                  f'{job["status"]}  attempts={job.get("attempts")}  '
                  + (f'reason={job.get("risk_reason")}' if job.get('risk_reason') else '')
                  + (f' err={job.get("last_error")[:120]}' if job.get('last_error') else ''))
            ok = job['status'] in ('filled', 'partial')
            print(f'{_P if ok else _F} job terminal status (got {job["status"]})')
            if not ok:
                fails.append(f"job status={job['status']}")
            elif job.get('copy_trade_id'):
                ct = (db.table('copy_trades').select('status,broker,follower_lot,broker_order_id')
                      .eq('id', job['copy_trade_id']).limit(1).execute().data or [{}])[0]
                print(f'  copy_trade: status={ct.get("status")} broker={ct.get("broker")} '
                      f'lot={ct.get("follower_lot")} order={ct.get("broker_order_id")}')
                _ok2 = ct.get('status') in ('mirrored', 'partial')
                print(f'{_P if _ok2 else _F} copy_trade mirrored (got {ct.get("status")})')
                if not _ok2:
                    fails.append(f"copy_trade status={ct.get('status')}")
        else:
            fails.append('executor never reached terminal status (timeout)')
            j = (db.table('copy_jobs').select('status,attempts,last_error')
                 .eq('signal_event_id', ev_id).limit(1).execute().data or [{}])[0]
            print(f'{_F} executor stuck — last job state: {j}')

    finally:
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
        if ev_id:
            _try(lambda: db.table('signal_events').delete().eq('id', ev_id).execute())
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
    print('ALL GREEN — Railway workers processed the signal end-to-end against live infra.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        import traceback; traceback.print_exc()
        sys.exit(2)
