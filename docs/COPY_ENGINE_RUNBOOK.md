# Copy-Engine — Deploy & Validation Runbook

How to apply migrations 030–034, bring up the workers, and **validate the
whole pipeline end-to-end before trusting it with real copies**. Follow it in
order; do not skip the validation step.

Components: [apps/copy-engine](../apps/copy-engine) (orchestrator / executor /
reconciler), the engine endpoints in [apps/signal-engine](../apps/signal-engine)
(`/api/v1/execute`, `/positions`, `/execute/guard`), and the observability
stack in [ops/observability](../ops/observability).

---

## 1. Apply migrations (in order)

```bash
# From repo root, against your Supabase project (or a branch first — recommended).
npx supabase db push          # applies pending migrations in timestamp order
```

Order and what each adds:

| # | File | Adds |
|---|---|---|
| 030 | `…_copy_trading_infrastructure.sql` | `signal_events` (bus), `copy_jobs` (queue), `copy_reconciliation`, allocation_model cols |
| 031 | `…_copy_jobs_claim_rpc.sql` | `claim_signal_event` / `claim_copy_jobs` / `reclaim_stale_copy_jobs` (SKIP LOCKED) |
| 032 | `…_observability_foundation.sql` | `trace_id` cols, `copy_jobs_dlq`, `dead_letter_copy_job` / `replay_dlq_job` |
| 033 | `…_copy_health.sql` | `copy_jobs.filled_at`, `copy_health`, `recompute_copy_health` |
| 034 | `…_live_risk_engine.sql` | `global_risk_state`, `risk_limits`, `portfolio_exposure`, `strategy_risk_state` + risk RPCs |

> **Branch first.** Apply to a Supabase branch, validate (step 3), then promote.
> All five are additive (`IF NOT EXISTS`); none drops or rewrites a trading
> table, so a forward-only apply is safe. There is no destructive rollback —
> to undo, drop the new objects manually (they are isolated from existing tables).

---

## 2. Configure + start the workers

```bash
cd apps/copy-engine
cp .env.example .env      # set SUPABASE_* , SIGNAL_ENGINE_URL , ENGINE_API_KEY
pip install -r requirements.txt

python orchestrator.py    # 1 process
python executor.py        # scale replicas to throughput (start with 1)
python reconciler.py      # 1 process
```

- `REDIS_URL` optional — without it, executors poll (durable queue unaffected).
- `METRICS_PORT` optional — exposes Prometheus (9101/9102/9103 by default).
- The executor routes through the engine's `/api/v1/execute`; the engine must
  be reachable at `SIGNAL_ENGINE_URL` with the matching `ENGINE_API_KEY`.

---

## 3. Validate (do this before real traffic)

### 3a. Schema + logic — read-only, no workers needed

```bash
cd apps/copy-engine
python tools/validate_schema.py
```

Checks every table/column from 030–034 exists, calls the read-only/refresh
RPCs, and runs the allocation self-test. **Expect `ALL GREEN`.** If a table or
RPC is missing, the matching migration didn't apply — re-run step 1.

### 3b. End-to-end smoke test — workers must be running

Prereqs: a test leader + follower + an **active, copy_enabled** subscription,
with the follower on the **paper** broker (zero-credential, safe to fill — if
the follower has no `broker_connections` row, fan-out defaults to `paper`).

```bash
cd apps/copy-engine
export SMOKE_LEADER_ID=<leader profile uuid>
export SMOKE_FOLLOWER_ID=<follower profile uuid>
export SMOKE_SUBSCRIPTION_ID=<strategy_subscriptions uuid>
python tools/smoke_test.py
```

It seeds one `signal_events` OPEN, follows fan-out → claim → risk → allocation
→ paper fill → `copy_trades` → auto-journal, prints the `trace_id`, and
**cleans up only what it created** (the signal_event cascades its copy_jobs;
the copy_trades it spawned are deleted). `SMOKE_KEEP=1` leaves rows for
inspection. **Expect `SMOKE TEST PASSED`.**

Trace one run by hand with the printed `trace_id`:

```sql
select 'event' src, status, created_at from signal_events where trace_id = '<t>'
union all
select 'job', status, created_at from copy_jobs where trace_id = '<t>'
order by created_at;
```

---

## 4. Operational checks

```bash
# DLQ — should be empty after a clean run
python dlq.py stats

# Risk engine — kill switch off, no quarantines, exposure recomputable
python risk_admin.py status
python risk_admin.py exposure

# Per-broker guard state (circuit breakers / rate buckets)
curl -H "X-Engine-Key: $ENGINE_API_KEY" $SIGNAL_ENGINE_URL/api/v1/execute/guard
```

Bring up the dashboards: `cd ops/observability && docker compose up -d`
(point `prometheus/prometheus.yml` at the worker hosts first). Grafana →
`http://localhost:3001`.

---

## 5. Break-glass

```bash
python risk_admin.py kill "reason"     # halt ALL execution platform-wide
python risk_admin.py resume            # clear it
```

The engine caches the kill flag for ~5s, so a kill propagates within seconds.
While active, `/execute` returns `kill_switch_active`; copy jobs retry (not
dead-lettered) until you resume.

---

## 6. Failure-mode reference

| Symptom | Where to look |
|---|---|
| No `copy_jobs` after seeding | orchestrator running? subscription active+copy_enabled? strategy not quarantined (`risk_admin.py status`)? |
| Jobs stuck `queued` | executor running? `algosphere_copy_queue_depth` rising? |
| Jobs `rejected` with `portfolio:…` | a risk limit hit — `risk_admin.py exposure` |
| Jobs `rejected` with `circuit_open`/`rate_limited` | broker guard — `/execute/guard` |
| Jobs in DLQ | `python dlq.py list`; fix cause; `python dlq.py replay-category <cat>` |
| Stuck `claimed` jobs | reconciler reclaims after `COPY_JOB_LEASE_S`; check it's running |
