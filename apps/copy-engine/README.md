# copy-engine

Event-driven copy-trading workers for AlgoSphere. Implements the production
core (items 2–4) of [docs/COPY_TRADING_INFRASTRUCTURE.md](../../docs/COPY_TRADING_INFRASTRUCTURE.md).

```
Signal Bus (signal_events)
   └─ orchestrator.py  → fans out one copy_jobs row per active follower
copy_jobs (durable queue, SKIP LOCKED)
   └─ executor.py      → claim → risk gate → allocation → route → persist  [scale N×]
broker fills (execution_events → journal trigger 029)
   └─ reconciler.py    → stale-job janitor + position diff → copy_reconciliation
```

## Design rules

- **Strategies never execute** — they only append to `signal_events`. The
  orchestrator is the sole producer of `copy_jobs`.
- **The engine is the single execution authority** — workers carry no broker
  SDKs; every order goes through the signal-engine's `/api/v1/execute`, which
  applies the non-bypassable 12-gate risk stack. Workers need only
  `supabase` + `httpx`.
- **Idempotent + crash-safe** — `UNIQUE(signal_event_id, subscription_id)` makes
  fan-out replay a no-op; `client_order_id = copy_<job_id>` dedupes at the
  broker; orphaned claims are reclaimed by lease expiry. No trade is lost or
  double-sent on a worker crash.
- **No blocking paths** — the leader/web request returns after a single INSERT
  into the bus; all broker I/O happens in these workers.

## Components

| File | Service | Role |
|---|---|---|
| `orchestrator.py` | copy-orchestrator | bus → fan-out → `copy_jobs` (1 replica; partition by leader if scaled) |
| `executor.py` | copy-executor | claim → `copy_gate` → `allocation` → engine route → persist (**scale replicas here**) |
| `reconciler.py` | copy-reconciler | reclaim stale jobs, rescue stuck events, position diff → `copy_reconciliation` (1 replica) |
| `shared/allocation.py` | — | `equity_ratio` / `fixed_ratio` / `risk_pct` (pure, unit-testable) |
| `shared/risk_gate.py` | — | copy-level pre-gate (cheap reject before a broker round-trip) |
| `shared/engine_client.py` | — | typed HTTP client for `/execute` + `/positions` |

## Run

```bash
cd apps/copy-engine
pip install -r requirements.txt
cp .env.example .env   # fill in SUPABASE_* + SIGNAL_ENGINE_URL + ENGINE_API_KEY

python orchestrator.py   # one process
python executor.py       # run as many as throughput needs
python reconciler.py     # one process
```

Requires migrations `…_copy_trading_infrastructure.sql` (030) and
`…_copy_jobs_claim_rpc.sql` (031) applied.

## Deploy (Railway)

Three services off this one directory, each with a different start command
(see `Procfile`). Scale `copy-executor` horizontally; keep orchestrator and
reconciler at one replica each (add leader-election before scaling those).

## Observability & durability (Phase 1 — shipped)

- **Distributed tracing** — `trace_id` minted on `signal_events` (DB default),
  propagated by the orchestrator onto every `copy_jobs` row, bound by the
  executor for the life of a job via `shared/tracing.py` (contextvars). Every
  log line + metric carries it. End-to-end join: `signal_events.trace_id` →
  `copy_jobs.trace_id` → `execution_events` via `client_order_id = copy_<job>`.
- **Structured logging** — `shared/obs_logging.py` emits one JSON object per
  line with `trace_id / job_id / user_id / broker / position_id` auto-merged.
  `ALGOSPHERE_LOG_PRETTY=1` for colored dev logs.
- **Metrics** — `shared/metrics.py` exposes Prometheus on `METRICS_PORT`
  (orchestrator 9101 / executor 9102 / reconciler 9103): jobs claimed/completed
  by status, fan-out count, retries + DLQ by category, job duration + engine
  `/execute` latency histograms, queue depth + worker-up gauges. Degrades to
  no-ops if `prometheus_client` is absent (never blocks execution).
- **Dead-letter queue** — `copy_jobs_dlq` (migration 032). The executor
  retries transient broker/engine failures with exponential backoff
  (`5→10→…→60s`, capped) up to `max_attempts`, then dead-letters via the
  `dead_letter_copy_job()` RPC with a failure category + job snapshot. Risk
  rejections are terminal decisions, never dead-lettered.
- **Replay** — `python dlq.py {list|stats|replay <id>|replay-category <cat>}`.
  Replay is idempotent + replay-safe via `replay_dlq_job()`: it re-activates the
  original job row (honoring the unique key) and stamps `replayed_at`, so a
  double-replay never double-enqueues.

## Scale & health (Phase 6 — shipped)

- **Redis Streams hot path** — `shared/queue_bus.py`. The orchestrator XADDs a
  tiny wakeup per fan-out; executors `XREADGROUP`-block on it and react in
  milliseconds instead of waiting out the poll interval. Redis is an
  optimization, **not** a source of truth: the message carries no job state, so
  a lost message / Redis outage / unset `REDIS_URL` just falls back to interval
  polling — the durable `SKIP LOCKED` claim still finds every queued row.
  Set `REDIS_URL` (+ optional `COPY_REDIS_STREAM` / `COPY_REDIS_GROUP`).
- **Follower lag** — the executor stamps `copy_jobs.filled_at`; lag =
  `filled_at − signal_events.created_at` (full signal→fill latency).
- **Copy-health scoring** — `recompute_copy_health()` (migration 033) scores
  each subscription over a rolling 24h window: fill rate, avg/p95 lag, open
  desyncs, failure rate → composite 0–100 `health_score` + label
  (`excellent/good/degraded/poor/idle`). The reconciler recomputes every ~2 min
  and publishes `algosphere_copy_health_*` gauges; the web app reads
  `copy_health` for the follower widget + leader per-follower sync table.

## Not yet wired (next slices)

- **CLOSE → settlement** — the reconciler flags state only; PnL payout stays in
  `lib/copy-settlement.ts`. Wire the engine to emit `CLOSE` signal_events and
  have the reconciler enqueue reduce-only close jobs.
- **Web** — retire `lib/copy-relay.ts`'s inline fan-out in favour of a single
  INSERT into `signal_events`; add the `allocation_model` config UI + the
  copy-health widget.
