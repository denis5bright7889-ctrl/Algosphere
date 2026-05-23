"""
risk_admin.py — centralized risk-engine operator CLI.

The break-glass tools for the live risk layer (migration 034). The kill
switch halts ALL execution platform-wide (engine /execute returns
kill_switch_active; copy jobs retry until it's cleared).

Usage:
  python risk_admin.py status
  python risk_admin.py kill   "reason"          # activate global kill switch
  python risk_admin.py resume                    # deactivate
  python risk_admin.py exposure [<user_id>]      # recompute + show exposure
  python risk_admin.py quarantine <strategy_id> "reason" [--disable]
  python risk_admin.py unquarantine <strategy_id>
"""
from __future__ import annotations
import sys
import argparse

from loguru import logger

from shared.config import load_settings, require
from shared.db import get_db
from shared import risk_limits


def _status(db) -> None:
    g = (db.table('global_risk_state').select('*').eq('id', True).limit(1).execute().data or [{}])[0]
    print(f"kill_switch: {'ACTIVE' if g.get('kill_switch') else 'off'}"
          + (f"  reason={g.get('reason')} by={g.get('activated_by')} at={g.get('activated_at')}"
             if g.get('kill_switch') else ''))
    q = (db.table('strategy_risk_state').select('strategy_id,status,reason')
         .neq('status', 'active').limit(50).execute().data or [])
    print(f"non-active strategies: {len(q)}")
    for r in q:
        print(f"  {r['strategy_id']}  {r['status']:<11} {(r.get('reason') or '')[:80]}")


def _kill(db, reason: str, active: bool) -> None:
    db.rpc('set_global_kill_switch', {
        'p_active': active, 'p_reason': reason, 'p_actor': 'risk_admin_cli',
    }).execute()
    print(f"global kill switch → {'ACTIVE' if active else 'OFF'}"
          + (f' ({reason})' if active else ''))


def _exposure(db, user_id: str | None) -> None:
    n = risk_limits.recompute_portfolio_exposure(db, user_id)
    print(f'recomputed exposure for {n} user(s)')
    q = db.table('portfolio_exposure').select(
        'user_id,total_notional,open_positions,largest_concentration_pct,'
        'daily_realized_pnl,drawdown_usd')
    if user_id:
        q = q.eq('user_id', user_id)
    for r in (q.order('total_notional', desc=True).limit(20).execute().data or []):
        print(f"  {r['user_id'][:8]}  notional={r['total_notional']}  "
              f"pos={r['open_positions']}  conc={r['largest_concentration_pct']}%  "
              f"dayPnL={r['daily_realized_pnl']}  dd={r['drawdown_usd']}")


def _quarantine(db, strategy_id: str, reason: str, disable: bool) -> None:
    res = db.rpc('quarantine_strategy', {
        'p_strategy_id': strategy_id, 'p_reason': reason, 'p_disable': disable,
    }).execute()
    print(f'strategy {strategy_id} → {res.data}')


def _unquarantine(db, strategy_id: str) -> None:
    db.table('strategy_risk_state').update({'status': 'active', 'reason': None}) \
        .eq('strategy_id', strategy_id).execute()
    print(f'strategy {strategy_id} → active')


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog='risk_admin.py')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('status')
    pk = sub.add_parser('kill'); pk.add_argument('reason')
    sub.add_parser('resume')
    pe = sub.add_parser('exposure'); pe.add_argument('user_id', nargs='?')
    pq = sub.add_parser('quarantine'); pq.add_argument('strategy_id'); \
        pq.add_argument('reason'); pq.add_argument('--disable', action='store_true')
    pu = sub.add_parser('unquarantine'); pu.add_argument('strategy_id')

    args = p.parse_args(argv)
    s = load_settings(); require(s)
    db = get_db()

    if args.cmd == 'status':        _status(db)
    elif args.cmd == 'kill':        _kill(db, args.reason, True)
    elif args.cmd == 'resume':      _kill(db, '', False)
    elif args.cmd == 'exposure':    _exposure(db, args.user_id)
    elif args.cmd == 'quarantine':  _quarantine(db, args.strategy_id, args.reason, args.disable)
    elif args.cmd == 'unquarantine':_unquarantine(db, args.strategy_id)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:
        logger.error(f'risk_admin error: {e}')
        sys.exit(1)
