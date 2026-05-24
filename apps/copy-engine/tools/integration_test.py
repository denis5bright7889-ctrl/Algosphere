"""
integration_test.py — drive the REAL orchestrator + executor logic against
live Postgres, end to end, with the broker call stubbed to a paper fill.

This is the runtime-validation tier above validate_schema.py: it seeds a
throwaway fixture (2 users via the auth admin API → profiles auto-created,
a published strategy, an active full_auto subscription), then exercises the
actual worker code paths against the real database:

   OPEN signal_event → orchestrator fan-out → copy_jobs
   → executor: risk gate → allocation → (stub) fill → copy_trade mirrored
   CLOSE signal_event → orchestrator close fan-out → close job
   → executor close pipeline → (stub) reduce-only fill → copy_trade closed
   → accrue_copy_earnings → creator_earnings

Only the engine HTTP call is stubbed (so no real broker / running engine is
needed); every DB write, RPC, and piece of worker wiring runs for real. All
seeded rows are deleted in a finally, and the auth users removed last.

  python tools/integration_test.py        # needs SUPABASE_* (service role)
"""
from __future__ import annotations
import os
import sys
import uuid
import asyncio
import pathlib
from datetime import datetime, timezone, timedelta

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
import coach

_P, _F = '  ✓', '  ✗'
SYMBOL = 'EURUSD'


# ── Stub engine: simulates paper fills, no HTTP / no broker ─────────────
class StubEngine:
    def __init__(self):
        self.fill_price = 1.1000
        self.calls: list[dict] = []

    async def execute(self, *, broker, symbol, side, quantity, user_id,
                      client_order_id, stop_loss=None, take_profit=None,
                      max_slippage_pct=0.002, reduce_only=False) -> ExecResult:
        self.calls.append({'side': side, 'qty': quantity, 'reduce_only': reduce_only,
                           'coid': client_order_id})
        return ExecResult(ok=True, order_id=f'stub-{client_order_id}', status='FILLED',
                          filled_qty=quantity, avg_fill_price=self.fill_price,
                          slippage_pct=0.0, broker=broker, testnet=True, error=None)

    async def positions(self, *, user_id, broker):
        return {'equity': 10000.0, 'positions': []}


def _ok(cond: bool, label: str, fails: list) -> None:
    print(f'{_P if cond else _F} {label}')
    if not cond:
        fails.append(label)


def main() -> int:
    s = load_settings(); require(s)
    db = get_db()
    suffix = uuid.uuid4().hex[:10]
    fails: list[str] = []
    leader_id = follower_id = strategy_id = sub_id = None
    open_ev_id = close_ev_id = None

    try:
        # ── Seed ────────────────────────────────────────────────────
        lead = db.auth.admin.create_user({
            'email': f'itest-leader-{suffix}@example.com',
            'password': f'Pw!{suffix}aA1', 'email_confirm': True})
        foll = db.auth.admin.create_user({
            'email': f'itest-follower-{suffix}@example.com',
            'password': f'Pw!{suffix}bB2', 'email_confirm': True})
        leader_id = lead.user.id
        follower_id = foll.user.id
        print(f'seeded users leader={leader_id[:8]} follower={follower_id[:8]}')

        strategy_id = (db.table('published_strategies').insert({
            'creator_id': leader_id, 'name': f'itest {suffix}',
            'slug': f'itest-{suffix}', 'status': 'active',
            'copy_enabled': True, 'copy_mode': 'full_auto', 'profit_share_pct': 20,
        }).select('id').execute().data[0]['id'])

        sub_id = (db.table('strategy_subscriptions').insert({
            'subscriber_id': follower_id, 'strategy_id': strategy_id,
            'status': 'active', 'copy_enabled': True, 'copy_mode': 'full_auto',
            'allocation_model': 'fixed_ratio', 'fixed_scale': 1.0,
            'copy_sl': True, 'copy_tp': True,
        }).select('id').execute().data[0]['id'])
        print(f'seeded strategy={strategy_id[:8]} subscription={sub_id[:8]}')

        engine = StubEngine()

        # ── 1. OPEN: fan-out ────────────────────────────────────────
        open_row = (db.table('signal_events').insert({
            'leader_id': leader_id, 'strategy_id': strategy_id,
            'event_type': 'OPEN', 'symbol': SYMBOL, 'direction': 'buy',
            'payload': {'entry': 1.1000, 'stop_loss': 1.0950,
                        'take_profit': 1.1100, 'lot': 0.10, 'leader_equity': 10000},
            'status': 'pending',
        }).select('*').execute().data[0])
        open_ev_id = open_row['id']
        ev = SignalEvent.from_row(open_row)
        n = orchestrator._fan_out(db, ev, 1000)
        _ok(n >= 1, f'OPEN fan-out created {n} copy_job(s)', fails)

        jobs = (db.table('copy_jobs').select('*')
                .eq('signal_event_id', open_ev_id).execute().data or [])
        _ok(len(jobs) == 1 and jobs[0]['kind'] == 'open', 'one OPEN job, kind=open', fails)

        # ── 2. Executor pipeline on the OPEN job ────────────────────
        engine.fill_price = 1.1000
        job = CopyJob.from_row(jobs[0])
        asyncio.run(executor._process_job(db, engine, 'itest', job))
        j = (db.table('copy_jobs').select('status,computed_lot,copy_trade_id')
             .eq('id', job.id).execute().data[0])
        _ok(j['status'] == 'filled', f"OPEN job status=filled (got {j['status']})", fails)
        _ok(abs(float(j['computed_lot'] or 0) - 0.10) < 1e-9,
            f"allocation lot=0.10 (got {j['computed_lot']})", fails)
        ct_id = j['copy_trade_id']
        ct = (db.table('copy_trades').select('status,follower_lot')
              .eq('id', ct_id).execute().data[0]) if ct_id else {}
        _ok(ct.get('status') == 'mirrored', f"copy_trade mirrored (got {ct.get('status')})", fails)

        # ── 3. CLOSE: fan-out + flatten + settle ────────────────────
        close_row = (db.table('signal_events').insert({
            'leader_id': leader_id, 'strategy_id': strategy_id,
            'event_type': 'CLOSE', 'symbol': SYMBOL, 'direction': 'buy',
            'payload': {'smoke': True}, 'status': 'pending',
        }).select('*').execute().data[0])
        close_ev_id = close_row['id']
        cev = SignalEvent.from_row(close_row)
        cn = orchestrator._fan_out_close(db, cev, 1000)
        _ok(cn >= 1, f'CLOSE fan-out created {cn} close job(s)', fails)

        cjobs = (db.table('copy_jobs').select('*')
                 .eq('signal_event_id', close_ev_id).execute().data or [])
        _ok(len(cjobs) == 1 and cjobs[0]['kind'] == 'close', 'one CLOSE job, kind=close', fails)

        engine.fill_price = 1.1050   # +50 pips on a 0.10 lot buy → +$50
        cjob = CopyJob.from_row(cjobs[0])
        asyncio.run(executor._process_job(db, engine, 'itest', cjob))
        ct2 = (db.table('copy_trades').select('status,follower_pnl,earnings_settled')
               .eq('id', ct_id).execute().data[0])
        _ok(ct2['status'] == 'closed', f"copy_trade closed (got {ct2['status']})", fails)
        _ok(abs(float(ct2['follower_pnl'] or 0) - 50.0) < 1.0,
            f"follower_pnl≈50 (got {ct2['follower_pnl']})", fails)
        _ok(ct2['earnings_settled'] is True, 'earnings_settled=true', fails)

        earn = (db.table('creator_earnings').select('creator_usd,gross_usd')
                .eq('creator_id', leader_id).execute().data or [])
        _ok(len(earn) == 1 and abs(float(earn[0]['creator_usd']) - 10.0) < 1.0,
            f"creator_earnings accrued 20% = $10 (got {earn[0]['creator_usd'] if earn else 'none'})", fails)

        # ── 4. reduce-only on the close leg ─────────────────────────
        _ok(any(c['reduce_only'] and c['side'] == 'sell' for c in engine.calls),
            'close used reduce_only opposite-side order', fails)

        # ── 5. Coach: behavioral analytics + notification + reports ─
        # Seed a tilted journal: losses + revenge sizing → coach raises a
        # warn alert → social_notifications row written (the last mile).
        now_utc = datetime.now(timezone.utc)
        pnls  = [-50, -40, -60, -30,  20, -25]
        sizes = [0.1, 0.3, 0.8, 0.2, 0.1,  0.5]
        jrows = [{
            'user_id': follower_id, 'pair': SYMBOL, 'direction': 'buy',
            'pnl': p, 'lot_size': l, 'session': 'london', 'source': 'auto',
            'trade_date': now_utc.date().isoformat(),
            'created_at': (now_utc - timedelta(minutes=(len(pnls) - i) * 4)).isoformat(),
        } for i, (p, l) in enumerate(zip(pnls, sizes))]
        db.table('journal_entries').insert(jrows).execute()

        scored, raised = coach._process_user(db, follower_id)
        _ok(scored, 'coach scored the follower (discipline computed)', fails)
        _ok(raised >= 1, f'coach raised {raised} alert(s) (revenge sizing)', fails)

        cs = (db.table('coach_state').select('discipline_score,revenge_events')
              .eq('user_id', follower_id).execute().data or [])
        _ok(bool(cs) and cs[0]['discipline_score'] is not None,
            f"coach_state written (score={cs[0]['discipline_score'] if cs else 'none'})", fails)

        notif = (db.table('social_notifications').select('id,message')
                 .eq('recipient_id', follower_id).eq('notif_type', 'coach_alert')
                 .execute().data or [])
        _ok(len(notif) >= 1,
            f'coaching notification delivered ({len(notif)} social_notifications row)', fails)

        reps = (db.table('coach_reports').select('scope')
                .eq('user_id', follower_id).execute().data or [])
        scopes = {r['scope'] for r in reps}
        _ok({'daily', 'weekly', 'monthly'} <= scopes,
            f'daily/weekly/monthly reports written (got {sorted(scopes)})', fails)

        ja = (db.table('journal_analytics').select('trades,profit_factor,net_pnl')
              .eq('user_id', follower_id).execute().data or [])
        _ok(bool(ja) and ja[0]['trades'] == 6,
            f"journal_analytics computed ({ja[0]['trades'] if ja else 0}/6 trades)", fails)

    finally:
        # ── Teardown (FK-safe order; users last) ────────────────────
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
        if sub_id:
            _try(lambda: db.table('copy_health').delete().eq('subscription_id', sub_id).execute())
        for ev_id in filter(None, [open_ev_id, close_ev_id]):
            _try(lambda e=ev_id: db.table('signal_events').delete().eq('id', e).execute())  # cascades copy_jobs
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
    print('ALL GREEN — end-to-end worker pipeline validated against live Postgres.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        import traceback; traceback.print_exc()
        print(f'integration test error: {e}')
        sys.exit(2)
