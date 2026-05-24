"""
load_test.py — measure fan-out + claim throughput on the live queue.

A scaled-down load test that turns the 10k-follower architectural claim into
a real number. Seeds 1 leader + 1 strategy + N follower subscriptions,
inserts a single OPEN signal_event, then times the two hot operations:

  1. orchestrator._fan_out   — one batched-insert per chunk into copy_jobs
     (the moment a signal lands, fan-out latency dictates how fast the
     pipeline can prime executors).
  2. claim_copy_jobs RPC     — SKIP LOCKED claim of B jobs per call
     (the executor's hot path; throughput here × replicas = drain rate).

Reports per-op latency, throughput (jobs/sec), and a back-of-envelope
extrapolation to 10k followers. Bounded by COPY_LOAD_FOLLOWERS (default 10)
because creating auth users in the real DB is slow. Crank it up — but each
user is a network round-trip, so plan for ~2-5s/user wall time.

All seeded rows (users, strategy, subs, signal_event, copy_jobs) are torn
down in finally. No real orders placed (we don't process jobs, only fan
out + claim).

  python tools/load_test.py
  COPY_LOAD_FOLLOWERS=25 python tools/load_test.py
"""
from __future__ import annotations
import os
import sys
import uuid
import time
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from shared.config import load_settings, require
from shared.db import get_db
from shared.models import SignalEvent
import orchestrator

SYMBOL = 'EURUSD'
N = int(os.environ.get('COPY_LOAD_FOLLOWERS', '10'))
CHUNK = int(os.environ.get('COPY_FANOUT_CHUNK', '1000'))
BATCH = int(os.environ.get('COPY_CLAIM_BATCH', '25'))


def main() -> int:
    s = load_settings(); require(s)
    db = get_db()
    suffix = uuid.uuid4().hex[:8]
    leader_id = None
    follower_ids: list[str] = []
    strategy_id = None
    sub_ids: list[str] = []
    ev_id = None

    try:
        # ── Seed leader + strategy ─────────────────────────────────
        print(f'load test: N={N} followers, fanout_chunk={CHUNK}, claim_batch={BATCH}')
        t0 = time.perf_counter()
        lead = db.auth.admin.create_user({
            'email': f'load-leader-{suffix}@example.com',
            'password': f'Pw!{suffix}aA1', 'email_confirm': True})
        leader_id = lead.user.id
        strategy_id = (db.table('published_strategies').insert({
            'creator_id': leader_id, 'name': f'load {suffix}',
            'slug': f'load-{suffix}', 'status': 'active',
            'copy_enabled': True, 'copy_mode': 'full_auto', 'profit_share_pct': 20,
        }).select('id').execute().data[0]['id'])

        # ── Seed N followers + N subscriptions ─────────────────────
        t_seed_start = time.perf_counter()
        for i in range(N):
            f = db.auth.admin.create_user({
                'email': f'load-{suffix}-f{i}@example.com',
                'password': f'Pw!{suffix}f{i}A1', 'email_confirm': True})
            follower_ids.append(f.user.id)
        # Bulk-insert all subscriptions (single round trip).
        subs = [{
            'subscriber_id': fid, 'strategy_id': strategy_id,
            'status': 'active', 'copy_enabled': True, 'copy_mode': 'full_auto',
            'allocation_model': 'fixed_ratio', 'fixed_scale': 1.0,
            'copy_sl': True, 'copy_tp': True,
        } for fid in follower_ids]
        sub_ids = [r['id'] for r in (db.table('strategy_subscriptions')
                                     .insert(subs).select('id').execute().data or [])]
        seed_ms = int((time.perf_counter() - t_seed_start) * 1000)
        print(f'  seeded {N} followers + {len(sub_ids)} subs in {seed_ms}ms '
              f'({seed_ms/max(N,1):.1f}ms/user)')

        # ── Insert one OPEN ────────────────────────────────────────
        ev_row = (db.table('signal_events').insert({
            'leader_id': leader_id, 'strategy_id': strategy_id,
            'event_type': 'OPEN', 'symbol': SYMBOL, 'direction': 'buy',
            'payload': {'entry': 1.1, 'stop_loss': 1.095, 'take_profit': 1.11,
                        'lot': 0.10, 'leader_equity': 10000},
            'status': 'pending',
        }).select('*').execute().data[0])
        ev_id = ev_row['id']
        ev = SignalEvent.from_row(ev_row)

        # ── 1. Fan-out timing ──────────────────────────────────────
        t_fanout = time.perf_counter()
        n = orchestrator._fan_out(db, ev, CHUNK)
        fanout_ms = (time.perf_counter() - t_fanout) * 1000
        assert n == N, f'fan-out created {n}/{N} jobs'
        per_job_us = (fanout_ms * 1000) / max(n, 1)
        print(f'  ✓ fan-out: {n} jobs in {fanout_ms:.1f}ms ({per_job_us:.0f}µs/job)')
        # Extrapolate to 10k followers — fan-out is batched per CHUNK.
        chunks_10k = (10000 + CHUNK - 1) // CHUNK
        est_10k_ms = (fanout_ms / max(1, (n + CHUNK - 1) // CHUNK)) * chunks_10k
        print(f'  ≈ 10k followers fan-out projection: ~{est_10k_ms:.0f}ms '
              f'({chunks_10k} chunks of {CHUNK})')

        # ── 2. Claim throughput ────────────────────────────────────
        # Drain the queue in BATCH-sized claims, time each.
        claim_times: list[float] = []
        total_claimed = 0
        while True:
            t = time.perf_counter()
            res = db.rpc('claim_copy_jobs', {'p_worker': 'load', 'p_limit': BATCH}).execute()
            claim_times.append((time.perf_counter() - t) * 1000)
            got = len(res.data or [])
            total_claimed += got
            if got == 0:
                break
        # Discard the last call (the empty one — measures only the "no-work" probe).
        if claim_times and claim_times[-1] < 1000 and total_claimed > 0:
            empty_ms = claim_times.pop()
        else:
            empty_ms = 0.0
        avg_claim_ms = sum(claim_times) / max(len(claim_times), 1)
        total_claim_ms = sum(claim_times)
        per_job_claim_us = (total_claim_ms * 1000) / max(total_claimed, 1)
        throughput = total_claimed / max(total_claim_ms / 1000, 1e-9)
        print(f'  ✓ claim: drained {total_claimed} jobs in {len(claim_times)} calls, '
              f'{total_claim_ms:.1f}ms total ({avg_claim_ms:.1f}ms/call, '
              f'{per_job_claim_us:.0f}µs/job)')
        print(f'  ≈ executor throughput: ~{throughput:.0f} jobs/sec/replica '
              f'(empty-claim probe: {empty_ms:.1f}ms)')
        # Scale: how many replicas to drain 10k jobs in 60s.
        replicas_for_10k_in_60s = max(1, int((10000 / 60) / max(throughput, 1) + 0.999))
        print(f'  ≈ to drain a 10k fan-out in 60s: ~{replicas_for_10k_in_60s} '
              f'executor replica(s) at this batch size')

        total_ms = int((time.perf_counter() - t0) * 1000)
        print(f'── total wall time (incl. seeding): {total_ms}ms ──')
        return 0

    except AssertionError as e:
        print(f'  ✗ {e}')
        return 1
    finally:
        print('── teardown ──')
        def _try(fn):
            try: fn()
            except Exception as e: print(f'  (cleanup) {str(e)[:80]}')
        if ev_id:
            _try(lambda: db.table('signal_events').delete().eq('id', ev_id).execute())
        for sid in sub_ids:
            _try(lambda x=sid: db.table('strategy_subscriptions').delete().eq('id', x).execute())
        if strategy_id:
            _try(lambda: db.table('published_strategies').delete().eq('id', strategy_id).execute())
        # Users last (cascades).
        for uid in follower_ids + ([leader_id] if leader_id else []):
            _try(lambda u=uid: db.auth.admin.delete_user(u))
        print(f'  removed {len(follower_ids)} followers + leader')


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        import traceback; traceback.print_exc()
        print(f'load test error: {e}')
        sys.exit(2)
