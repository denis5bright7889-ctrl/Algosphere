"""
smoke_test.py — end-to-end pipeline validation against a live deployment.

Seeds ONE signal_events row and follows the whole cascade:
    signal_events → orchestrator fan-out → copy_jobs → executor
    (risk → allocation → route via engine /execute on PAPER) → copy_trades
    → execution_events → journal_entries (auto) .

Requires: the workers (orchestrator + executor) RUNNING against the same
Supabase, and a test subscription that is active + copy_enabled with the
follower routed to the PAPER broker (zero-credential, safe to fill).

Env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY    (workers' env)
  SMOKE_LEADER_ID        leader/profile id that owns the strategy
  SMOKE_FOLLOWER_ID      follower/profile id with the active subscription
  SMOKE_SUBSCRIPTION_ID  the strategy_subscriptions row to copy through
  SMOKE_TIMEOUT_S        max wait for a terminal job state (default 45)
  SMOKE_KEEP=1           skip cleanup (leave seeded rows for inspection)

Cleanup is PRECISE: it deletes only the signal_event it inserted (which
cascades its copy_jobs) and the copy_trades those jobs created. It never
touches pre-existing data. execution_events/journal rows are append-only
audit — left in place; the printed trace_id locates them.

  python tools/smoke_test.py
"""
from __future__ import annotations
import os
import sys
import time

from shared.config import load_settings, require
from shared.db import get_db

SYMBOL = 'EURUSD'
TERMINAL = {'filled', 'partial', 'rejected', 'skipped', 'failed'}


def _env(name: str) -> str:
    v = os.environ.get(name, '').strip()
    if not v:
        print(f'missing required env {name}'); sys.exit(2)
    return v


def _preflight(db, sub_id: str, follower_id: str) -> dict:
    rows = (db.table('strategy_subscriptions')
            .select('id,subscriber_id,strategy_id,status,copy_enabled,copy_mode')
            .eq('id', sub_id).limit(1).execute().data or [])
    if not rows:
        print(f'✗ subscription {sub_id} not found'); sys.exit(2)
    sub = rows[0]
    issues = []
    if sub['subscriber_id'] != follower_id:
        issues.append(f"subscriber_id {sub['subscriber_id']} != SMOKE_FOLLOWER_ID")
    if sub['status'] != 'active':         issues.append(f"status={sub['status']} (need active)")
    if not sub['copy_enabled']:           issues.append('copy_enabled=false')
    if sub['copy_mode'] == 'signal_only': issues.append('copy_mode=signal_only (no execution)')
    if issues:
        print('✗ preflight failed:'); [print(f'    - {i}') for i in issues]; sys.exit(2)
    print(f"✓ preflight: subscription {sub_id[:8]} active, copy_mode={sub['copy_mode']}")
    return sub


def _seed(db, leader_id: str, strategy_id: str | None) -> dict:
    payload = {'entry': 1.1000, 'stop_loss': 1.0950, 'take_profit': 1.1100,
               'lot': 0.10, 'leader_equity': 10000, 'smoke_test': True}
    row = (db.table('signal_events').insert({
        'leader_id': leader_id, 'strategy_id': strategy_id,
        'event_type': 'OPEN', 'symbol': SYMBOL, 'direction': 'buy',
        'payload': payload, 'status': 'pending',
    }).select('id,trace_id').execute().data or [])[0]
    print(f"✓ seeded signal_event {row['id'][:8]} trace={row['trace_id']}")
    return row


def _poll(db, signal_event_id: str, timeout_s: int) -> list[dict]:
    deadline = time.time() + timeout_s
    last = []
    while time.time() < deadline:
        jobs = (db.table('copy_jobs')
                .select('id,status,computed_lot,client_order_id,copy_trade_id,risk_reason,last_error')
                .eq('signal_event_id', signal_event_id).execute().data or [])
        last = jobs
        if jobs and all(j['status'] in TERMINAL for j in jobs):
            return jobs
        time.sleep(1.0)
    return last


def _report(db, jobs: list[dict], follower_id: str) -> bool:
    if not jobs:
        print('✗ no copy_jobs created — is the orchestrator running? is the '
              'subscription active+copy_enabled for this leader strategy?')
        return False
    ok = False
    for j in jobs:
        print(f"  job {j['id'][:8]} status={j['status']} lot={j.get('computed_lot')} "
              f"coid={j.get('client_order_id')} "
              + (f"reason={j.get('risk_reason')}" if j.get('risk_reason') else '')
              + (f" err={j.get('last_error')}" if j.get('last_error') else ''))
        if j['status'] in ('filled', 'partial'):
            ok = True
            ct = (db.table('copy_trades').select('id,status,broker,broker_order_id,follower_entry')
                  .eq('id', j['copy_trade_id']).limit(1).execute().data or []) if j.get('copy_trade_id') else []
            if ct:
                print(f"    ✓ copy_trade {ct[0]['id'][:8]} {ct[0]['status']} "
                      f"broker={ct[0]['broker']} order={ct[0].get('broker_order_id')}")
            # journal auto-row check (best-effort — trigger fires on execution_events)
            jr = (db.table('journal_entries').select('id,source,pair')
                  .eq('user_id', follower_id).eq('source', 'auto').eq('pair', SYMBOL)
                  .order('created_at', desc=True).limit(1).execute().data or [])
            print(f"    {'✓' if jr else '·'} auto journal row "
                  f"{'present' if jr else 'not seen yet (trigger/async)'}")
    print(f"{'✓' if ok else '✗'} terminal outcome: "
          f"{'at least one fill' if ok else 'no fills (see statuses above)'}")
    return ok


def _cleanup(db, signal_event_id: str, jobs: list[dict]) -> None:
    ct_ids = [j['copy_trade_id'] for j in jobs if j.get('copy_trade_id')]
    for ctid in ct_ids:
        try: db.table('copy_trades').delete().eq('id', ctid).execute()
        except Exception: pass
    # Deleting the signal_event cascades its copy_jobs (FK ON DELETE CASCADE).
    try: db.table('signal_events').delete().eq('id', signal_event_id).execute()
    except Exception: pass
    print(f'✓ cleaned up signal_event + {len(ct_ids)} copy_trade(s) '
          '(execution_events/journal left as audit)')


def main() -> int:
    s = load_settings(); require(s)
    db = get_db()
    leader   = _env('SMOKE_LEADER_ID')
    follower = _env('SMOKE_FOLLOWER_ID')
    sub_id   = _env('SMOKE_SUBSCRIPTION_ID')
    timeout  = int(os.environ.get('SMOKE_TIMEOUT_S', '45'))

    sub = _preflight(db, sub_id, follower)
    seeded = _seed(db, leader, sub.get('strategy_id'))
    print(f'… waiting up to {timeout}s for the cascade …')
    jobs = _poll(db, seeded['id'], timeout)
    ok = _report(db, jobs, follower)

    if os.environ.get('SMOKE_KEEP', '').strip() not in ('1', 'true', 'yes'):
        _cleanup(db, seeded['id'], jobs)
    else:
        print(f"SMOKE_KEEP set — leaving signal_event {seeded['id']} for inspection")

    print('────────────────────────────────────────────────')
    print('SMOKE TEST PASSED' if ok else 'SMOKE TEST FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        print(f'smoke test error: {e}')
        sys.exit(2)
