"""
dlq.py — dead-letter queue operator CLI.

Inspect and replay dead-lettered copy jobs. Replay is idempotent and
replay-safe: it goes through the replay_dlq_job() RPC, which re-activates
the original job row (honoring the UNIQUE(signal_event_id, subscription_id)
constraint) and stamps the DLQ row replayed_at — calling it twice never
double-enqueues.

Usage:
  python dlq.py list [--category C] [--limit N] [--all]
  python dlq.py stats
  python dlq.py replay <dlq_id>
  python dlq.py replay-category <category> [--limit N]

Categories: broker_rejection broker_timeout engine_error decrypt_error
            allocation_error retry_exhausted unknown
"""
from __future__ import annotations
import sys
import argparse

from loguru import logger

from shared.config import load_settings, require
from shared.db import get_db


def _list(db, category: str | None, limit: int, include_replayed: bool) -> None:
    q = (db.table('copy_jobs_dlq')
         .select('id, original_job_id, follower_id, broker, failure_category, '
                 'attempts, last_error, trace_id, replayed_at, created_at')
         .order('created_at', desc=True).limit(limit))
    if category:
        q = q.eq('failure_category', category)
    if not include_replayed:
        q = q.is_('replayed_at', 'null')
    for r in (q.execute().data or []):
        flag = 'REPLAYED' if r.get('replayed_at') else 'OPEN'
        print(f"{r['id']}  [{flag}]  {r['failure_category']:<16} "
              f"broker={r.get('broker')}  attempts={r['attempts']}  "
              f"trace={r.get('trace_id')}\n    {(r.get('last_error') or '')[:140]}")


def _stats(db) -> None:
    rows = (db.table('copy_jobs_dlq')
            .select('failure_category, replayed_at').limit(10000).execute().data or [])
    open_by: dict[str, int] = {}
    replayed = 0
    for r in rows:
        if r.get('replayed_at'):
            replayed += 1
        else:
            open_by[r['failure_category']] = open_by.get(r['failure_category'], 0) + 1
    print(f'DLQ total={len(rows)}  replayed={replayed}  open={sum(open_by.values())}')
    for cat, n in sorted(open_by.items(), key=lambda x: -x[1]):
        print(f'  {cat:<18} {n}')


def _replay_one(db, dlq_id: str) -> None:
    res = db.rpc('replay_dlq_job', {'p_dlq_id': dlq_id}).execute()
    job_id = res.data
    if job_id:
        print(f'replayed {dlq_id} → copy_job {job_id} (queued)')
    else:
        print(f'no-op for {dlq_id} (not found or already replayed with no job)')


def _replay_category(db, category: str, limit: int) -> None:
    rows = (db.table('copy_jobs_dlq').select('id')
            .eq('failure_category', category).is_('replayed_at', 'null')
            .order('created_at', desc=False).limit(limit).execute().data or [])
    if not rows:
        print(f'no open DLQ entries in category {category}')
        return
    for r in rows:
        _replay_one(db, r['id'])
    print(f'replayed {len(rows)} job(s) from category {category}')


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog='dlq.py')
    sub = p.add_subparsers(dest='cmd', required=True)

    pl = sub.add_parser('list'); pl.add_argument('--category'); \
        pl.add_argument('--limit', type=int, default=50); \
        pl.add_argument('--all', action='store_true')
    sub.add_parser('stats')
    pr = sub.add_parser('replay'); pr.add_argument('dlq_id')
    pc = sub.add_parser('replay-category'); pc.add_argument('category'); \
        pc.add_argument('--limit', type=int, default=100)

    args = p.parse_args(argv)
    s = load_settings(); require(s)
    db = get_db()

    if args.cmd == 'list':
        _list(db, args.category, args.limit, args.all)
    elif args.cmd == 'stats':
        _stats(db)
    elif args.cmd == 'replay':
        _replay_one(db, args.dlq_id)
    elif args.cmd == 'replay-category':
        _replay_category(db, args.category, args.limit)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:
        logger.error(f'dlq tool error: {e}')
        sys.exit(1)
