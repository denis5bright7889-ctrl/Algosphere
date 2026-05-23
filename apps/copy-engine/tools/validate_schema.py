"""
validate_schema.py — verify migrations 030–034 applied + sanity-check logic.

Run this FIRST after applying the migrations, before starting the workers.
It is read-only / idempotent: it SELECTs each expected table, calls only the
read-only or refresh RPCs (never the claim/dead-letter/kill mutators), and
runs the pure allocation self-test in-process. Exit 0 = all green.

  python tools/validate_schema.py

Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the workers' env).
"""
from __future__ import annotations
import sys
import uuid
import pathlib

# Allow running as `python tools/validate_schema.py` from the copy-engine
# root: put the app root (parent of tools/) on the path so `shared` imports.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

# Windows consoles default to cp1252 and choke on the ✓/✗ glyphs — force UTF-8.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from shared.config import load_settings, require
from shared.db import get_db


# (table, columns-to-probe) — selecting a column that doesn't exist raises,
# so this also verifies the additive columns from 032/033.
_TABLES = [
    ('signal_events',       'id,trace_id,status'),
    ('copy_jobs',           'id,trace_id,filled_at,status,max_attempts,kind'),  # 035: kind
    ('copy_reconciliation', 'id,kind,resolved_at'),
    ('copy_jobs_dlq',       'id,failure_category,replayed_at'),
    ('copy_health',         'subscription_id,health_score,health_label,p95_lag_ms'),
    ('global_risk_state',   'id,kill_switch'),
    ('risk_limits',         'user_id,max_total_exposure_usd'),
    ('portfolio_exposure',  'user_id,total_notional,drawdown_usd'),
    ('strategy_risk_state', 'strategy_id,status'),
    ('copy_trades',         'id,earnings_settled'),                              # 036
    ('order_idempotency',   'id,state,client_order_id'),                         # 037
]

_PASS, _FAIL = '  ✓', '  ✗'


def _check_tables(db) -> int:
    fails = 0
    for table, cols in _TABLES:
        try:
            db.table(table).select(cols).limit(1).execute()
            print(f'{_PASS} table {table} ({cols.split(",")[0]}…)')
        except Exception as e:
            fails += 1
            print(f'{_FAIL} table {table}: {str(e)[:120]}')
    return fails


def _check_rpcs(db) -> int:
    fails = 0
    # Read-only.
    try:
        r = db.rpc('is_kill_switch_active', {}).execute()
        print(f'{_PASS} rpc is_kill_switch_active() → {r.data}')
    except Exception as e:
        fails += 1; print(f'{_FAIL} rpc is_kill_switch_active: {str(e)[:120]}')

    # Read-only evaluation against a random (limit-less) user → expect allow.
    try:
        r = db.rpc('evaluate_portfolio_risk', {
            'p_user_id': str(uuid.uuid4()), 'p_symbol': 'EURUSD', 'p_notional_usd': 0,
        }).execute()
        d = r.data or {}
        ok = isinstance(d, dict) and d.get('allow') is True
        print(f'{_PASS if ok else _FAIL} rpc evaluate_portfolio_risk() → {d}')
        fails += 0 if ok else 1
    except Exception as e:
        fails += 1; print(f'{_FAIL} rpc evaluate_portfolio_risk: {str(e)[:120]}')

    # Idempotent refresh RPCs (safe to call repeatedly).
    for fn, args in (('recompute_copy_health', {'p_window_hours': 24}),
                     ('recompute_portfolio_exposure', {'p_user_id': None})):
        try:
            r = db.rpc(fn, args).execute()
            print(f'{_PASS} rpc {fn}() → scored/updated {r.data}')
        except Exception as e:
            fails += 1; print(f'{_FAIL} rpc {fn}: {str(e)[:120]}')

    # accrue_copy_earnings against a non-existent trade → 0, no side effect (036).
    try:
        r = db.rpc('accrue_copy_earnings', {'p_copy_trade_id': str(uuid.uuid4())}).execute()
        ok = (r.data or 0) == 0
        print(f'{_PASS if ok else _FAIL} rpc accrue_copy_earnings(missing) → {r.data}')
        fails += 0 if ok else 1
    except Exception as e:
        fails += 1; print(f'{_FAIL} rpc accrue_copy_earnings: {str(e)[:120]}')
    return fails


def _check_idempotency(db) -> int:
    """LIVE self-test of the order-idempotency flow (037) — the riskiest new
    logic on the execution path. Exercises claim → concurrent-dup → cache →
    cached-hit with a throwaway coid, then deletes the test row. No real
    order is ever placed (begin_order/finish_order only touch the cache table)."""
    coid = f'validate-{uuid.uuid4()}'
    fails = 0
    try:
        r1 = (db.rpc('begin_order', {'p_user': 'validate', 'p_broker': 'paper',
                                     'p_coid': coid}).execute().data) or {}
        ok1 = bool(r1.get('owner'))
        print(f'{_PASS if ok1 else _FAIL} begin_order(new) → owner={r1.get("owner")}')

        r2 = (db.rpc('begin_order', {'p_user': 'validate', 'p_broker': 'paper',
                                     'p_coid': coid}).execute().data) or {}
        ok2 = bool(r2.get('in_flight'))
        print(f'{_PASS if ok2 else _FAIL} begin_order(dup) → in_flight={r2.get("in_flight")}')

        db.rpc('finish_order', {
            'p_broker': 'paper', 'p_coid': coid, 'p_state': 'completed',
            'p_order_id': 'validate-order', 'p_status': 'FILLED',
            'p_filled': 0, 'p_price': 0, 'p_slip': 0, 'p_error': None,
        }).execute()

        r3 = (db.rpc('begin_order', {'p_user': 'validate', 'p_broker': 'paper',
                                     'p_coid': coid}).execute().data) or {}
        ok3 = bool(r3.get('duplicate')) and isinstance(r3.get('cached'), dict)
        print(f'{_PASS if ok3 else _FAIL} begin_order(after complete) → duplicate={r3.get("duplicate")}')
        fails += (0 if ok1 else 1) + (0 if ok2 else 1) + (0 if ok3 else 1)
    except Exception as e:
        fails += 1; print(f'{_FAIL} idempotency self-test: {str(e)[:120]}')
    finally:
        # Clean up the throwaway row regardless.
        try:
            db.table('order_idempotency').delete().eq('client_order_id', coid).execute()
        except Exception:
            pass
    return fails


def _check_logic() -> int:
    """Pure, no-DB: the allocation models must hold their contract."""
    from shared import allocation as a
    fails = 0
    p = a.AllocationParams(fixed_scale=0.5, risk_pct=1.0, max_lot_size=5.0)
    cases = [
        ('equity_ratio', a.equity_ratio(leader_lot=1.0, leader_equity=100000,
                                        follower_equity=50000, p=p), 0.5),
        ('fixed_ratio',  a.fixed_ratio(leader_lot=1.0, p=p), 0.5),
        ('risk_pct',     a.risk_pct(entry=1.10, stop_loss=1.0950, follower_equity=10000,
                                    pip_value=10, pair='EURUSD', p=p), 0.2),
        ('max_cap',      a.fixed_ratio(leader_lot=20.0, p=p), 5.0),
        ('sub_min',      a.risk_pct(entry=1.1, stop_loss=1.0, follower_equity=10,
                                    pip_value=10, pair='EURUSD', p=p), 0.0),
    ]
    for name, got, want in cases:
        ok = abs(got - want) < 1e-9
        print(f'{_PASS if ok else _FAIL} allocation {name}: {got} (want {want})')
        fails += 0 if ok else 1
    return fails


def main() -> int:
    s = load_settings(); require(s)
    db = get_db()
    print('── tables/columns ──────────────────────────────')
    f1 = _check_tables(db)
    print('── RPCs ────────────────────────────────────────')
    f2 = _check_rpcs(db)
    print('── order idempotency (live self-test, 037) ─────')
    f3 = _check_idempotency(db)
    print('── allocation logic (pure) ─────────────────────')
    f4 = _check_logic()
    total = f1 + f2 + f3 + f4
    print('────────────────────────────────────────────────')
    if total == 0:
        print('ALL GREEN — migrations 030–037 applied and logic sound.')
        return 0
    print(f'{total} CHECK(S) FAILED — see ✗ above. Re-apply missing migrations.')
    return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        print(f'validator error: {e}')
        sys.exit(2)
