# AlgoSphere — Production Copy-Trading Infrastructure

> Event-driven, async, multi-tenant copy-trading platform designed to scale to
> 10,000+ followers per leader. This document is the build spec: architecture,
> service breakdown, schema, event flow, API contracts, and deployment.
>
> **Grounded in the deployed codebase** — it extends what already ships, it does
> not fork it. Read [PRODUCT_ARCHITECTURE.md](PRODUCT_ARCHITECTURE.md) §3.2 for
> the original copy-router sketch and [architecture.md](architecture.md) for the
> low-level map.

---

## 0. Reality check — what exists vs. what's net-new

| Layer | Exists today | Gap this spec closes |
|---|---|---|
| Strategy/signal generation | ✅ `apps/signal-engine/engine/*` | publish to a **bus**, never execute inline |
| Broker abstraction | ✅ `risk/adapters/` — `ExecutionAdapter` + 7 brokers + paper | add **FIX** adapter (future), nothing else |
| Per-user creds + factory | ✅ `risk/adapters/factory.py`, AES-256-GCM vault | reuse verbatim |
| 12-gate institutional risk | ✅ `apps/signal-engine/risk/` | add a **copy-level** pre-gate in front of it |
| Execution endpoint | ✅ `POST /api/v1/execute` | called by the **executor worker**, not the web request |
| Immutable event log | ✅ `execution_events` table | becomes the fill-side source of truth for reconciliation |
| Journaling hooks | ✅ trigger `auto_journal_from_event` (migration 029) | **free** — fills already auto-journal |
| Copy schema | ✅ `published_strategies`, `strategy_subscriptions`, `copy_trades`, `creator_earnings`, `shadow_executions` | add bus + queue + reconciliation tables |
| Fan-out | ⚠️ `lib/copy-relay.ts` — **synchronous in-request `Promise.all`** | **replace** with bus → queue → worker pool |
| PnL settlement | ✅ `lib/copy-settlement.ts` | keep; trigger it from the reconciliation/lifecycle path |
| Async queue | ❌ none | **net-new** — `copy_jobs` durable queue + Redis hot path |
| Reconciliation engine | ❌ none | **net-new** — `copy_reconciliation` + sync worker |
| Allocation models | ⚠️ one hard-coded `scaleLot` (risk-%) | **net-new** — 3 pluggable models |

**The single most important change:** strategies and the web request path stop
executing trades. Everything becomes: *append an event → return immediately*.
Work happens in horizontally-scalable workers behind a durable queue.

---

## 1. Architecture diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CONTROL PLANE (Supabase)                          │
│  profiles · published_strategies · strategy_subscriptions · broker_connections │
│  signal_events(bus) · copy_jobs(queue) · copy_trades · copy_reconciliation     │
│  execution_events(immutable) · shadow_executions · creator_earnings            │
│  RLS per user_id on every row · LISTEN/NOTIFY on signal_events + copy_jobs      │
└──────────────────────────────────────────────────────────────────────────────┘
        ▲              ▲                ▲              ▲              ▲
        │ writes       │ enqueue        │ claim        │ fills        │ desync
        │              │                │              │              │
┌───────┴───┐   ┌──────┴───────┐  ┌─────┴────────┐ ┌───┴─────────┐ ┌──┴────────────┐
│ STRATEGY  │   │ COPY         │  │ COPY         │ │ EXECUTION   │ │ SYNC + PnL    │
│ ENGINE    │   │ ORCHESTRATOR │  │ EXECUTOR     │ │ ROUTER      │ │ RECONCILER    │
│ (signal-  │   │ (worker)     │  │ POOL (N×)    │ │ (in-exec)   │ │ (worker)      │
│  engine)  │   │              │  │              │ │             │ │               │
│           │   │ 1 signal →   │  │ per job:     │ │ idempotent  │ │ poll broker   │
│ produce   │──▶│ N copy_jobs  │─▶│ ① risk gate  │─│ client_     │ │ positions vs  │
│ signal,   │ B │ (fan-out     │ Q│ ② allocation │ │ order_id    │ │ copy_trades;  │
│ NO exec   │ U │  planner)    │ U│ ③ route      │ │ = copy_<id> │ │ flag missed / │
│           │ S │              │ E│              │ │             │ │ partial /     │
└───────────┘   └──────────────┘  └──────┬───────┘ └──────┬──────┘ │ desync; settle│
                                         │                │        └───────────────┘
                       ┌─────────────────┴────────────────┴───────────┐
                       │           BROKER CONNECTORS (ExecutionAdapter)│
                       │  MT5(bridge) · Binance · Bybit · OKX · OANDA  │
                       │  Tradovate · Paper      [ FIX = future ]      │
                       └───────────────────────┬───────────────────────┘
                                                │
                                        ┌───────┴────────┐
                                        │ FOLLOWER       │
                                        │ ACCOUNTS (10k+)│
                                        └────────────────┘

   Redis (hot path): job dispatch streams · idempotency locks · per-broker rate
                     limiters · backpressure. Postgres copy_jobs = durable truth.

   Journaling hook:  execution_events INSERT ──trigger 029──▶ journal_entries
   AI analytics hook: signal_events / copy_jobs / execution_events → NOTIFY →
                      ai-coach + ai-tagger workers (read-only, never block exec)
```

**Strict invariants encoded in this topology**
1. **Strategies never execute** — the Strategy Engine's only write is an append to
   `signal_events`. It has no broker handle.
2. **Every trade passes the bus** — there is no code path from signal to broker
   that skips `signal_events → copy_jobs`.
3. **No blocking execution path** — the web request and the strategy loop both
   return after an append (single-row INSERT, <5ms). All broker I/O is in workers.
4. **Risk before execution** — a `copy_job` cannot reach the router without a
   `risk_decision` row; the router refuses jobs lacking `risk_passed_at`.
5. **Idempotent everywhere** — `(signal_id, subscriber_id)` is unique on
   `copy_jobs`; `client_order_id = copy_<job_id>` lets the broker dedupe too.

---

## 2. Service breakdown

| Service | Runtime / host | Role | Scaling |
|---|---|---|---|
| **signal-engine** (existing) | FastAPI · Railway | Strategy Engine. Produces signals → `POST /internal/signals/publish` appends to `signal_events`. Owns the existing `/api/v1/execute` (now called only by the executor). | vertical; 1–2 replicas |
| **copy-orchestrator** (NEW) | Python worker · Railway | Consumes `signal_events`, loads active copy subscriptions for the leader, fans out **one `copy_jobs` row per follower** (batched INSERT), enqueues to Redis. Partition by `hash(leader_id)` so multiple replicas never double-plan. | horizontal by leader hash |
| **copy-executor** (NEW) | Python worker pool · Railway | The workhorse. Claims `copy_jobs` (Redis stream + `FOR UPDATE SKIP LOCKED` fallback), runs **Risk Engine → Allocation Engine → Execution Router**, writes `copy_trades` + `execution_events`. | **horizontal, N replicas** — this is where 10k scales |
| **reconciler** (NEW) | Python worker · Railway | Sync + PnL Tracker. Periodically (and on close events) compares broker positions to `copy_trades`; writes `copy_reconciliation`; triggers `settleCopyTradesForSignal` on close. | 1 replica + leader election |
| **web** (existing) | Next.js · Vercel | UI + API contracts (subscribe, copy config, dashboards, leader publish proxy). **No inline fan-out** — `relayLeaderSignal` is retired in favor of an append to the bus. | serverless |
| **mt5-bridge** (existing) | FastAPI · Windows VPS | MT5 broker connector (singleton terminal, per-request login). | 1 instance (singleton) |
| **Redis** (NEW) | Upstash / Railway | Queue transport, idempotency locks, per-broker token-bucket rate limiters, backpressure signal. Durable truth stays in Postgres. | managed |

**Worker internals (copy-executor)** — pure functions, each independently testable:

```
risk/copy_gate.py        copy-level pre-gate (see §6)
alloc/models.py          equity_ratio | fixed_ratio | risk_pct (see §5)
router/execution.py      idempotent submit via factory.get_adapter_for_user
                         → reuses the LIVE adapter layer + engine 12-gate
```

---

## 3. Database schema (net-new)

Migration `20240101000030_copy_trading_infrastructure.sql`. Additive only — every
statement is `IF NOT EXISTS`; nothing alters trading-critical tables destructively.

### 3.1 `signal_events` — the bus (append-only)

```sql
CREATE TABLE public.signal_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id     UUID NOT NULL REFERENCES profiles(id),
  strategy_id   UUID REFERENCES published_strategies(id),
  signal_id     UUID REFERENCES signals(id),       -- nullable: raw strategy event
  event_type    TEXT NOT NULL CHECK (event_type IN
                  ('OPEN','CLOSE','MODIFY','CANCEL')),
  symbol        TEXT NOT NULL,
  direction     TEXT CHECK (direction IN ('buy','sell')),
  payload       JSONB NOT NULL DEFAULT '{}',        -- entry/sl/tp/lot/rr/regime
  -- fan-out bookkeeping (so orchestrator is idempotent + observable)
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','planning','fanned_out','failed')),
  jobs_created  INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fanned_out_at TIMESTAMPTZ
);
CREATE INDEX idx_signal_events_pending ON signal_events (created_at)
  WHERE status = 'pending';
-- NOTIFY so the orchestrator wakes instantly instead of polling.
```

### 3.2 `copy_jobs` — the durable async queue

```sql
CREATE TABLE public.copy_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_event_id UUID NOT NULL REFERENCES signal_events(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES strategy_subscriptions(id) ON DELETE CASCADE,
  follower_id     UUID NOT NULL REFERENCES profiles(id),
  leader_id       UUID NOT NULL REFERENCES profiles(id),
  broker          TEXT,                              -- resolved follower default
  -- queue state machine
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                    'queued','claimed','risk_check','allocating','routing',
                    'submitted','filled','partial','rejected','failed','skipped'
                  )),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  claimed_by      TEXT,                              -- worker id (for SKIP LOCKED)
  claimed_at      TIMESTAMPTZ,
  -- risk + allocation results (audit trail)
  risk_passed_at  TIMESTAMPTZ,
  risk_reason     TEXT,
  allocation_model TEXT,
  computed_lot    NUMERIC(20,8),
  -- execution linkage
  copy_trade_id   UUID REFERENCES copy_trades(id),
  client_order_id TEXT,                              -- = 'copy_' || id
  last_error      TEXT,
  available_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),-- for backoff retries
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- IDEMPOTENCY: one job per (signal, follower). Re-fanout never double-orders.
  UNIQUE (signal_event_id, subscription_id)
);
-- The claim hot-path index — workers pull the oldest available queued jobs.
CREATE INDEX idx_copy_jobs_claimable ON copy_jobs (available_at)
  WHERE status = 'queued';
CREATE INDEX idx_copy_jobs_follower ON copy_jobs (follower_id, created_at DESC);
```

**Claim query (the SKIP LOCKED pattern — no Redis required to be correct):**

```sql
UPDATE copy_jobs SET status='claimed', claimed_by=$1, claimed_at=NOW(), attempts=attempts+1
WHERE id IN (
  SELECT id FROM copy_jobs
  WHERE status='queued' AND available_at <= NOW()
  ORDER BY available_at
  FOR UPDATE SKIP LOCKED
  LIMIT $2
)
RETURNING *;
```

Redis Streams sit *in front* of this for low-latency dispatch; the SKIP LOCKED
query is the durable fallback and the recovery path after a worker crash.

### 3.3 `copy_reconciliation` — desync ledger

```sql
CREATE TABLE public.copy_reconciliation (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id   UUID NOT NULL REFERENCES profiles(id),
  copy_job_id   UUID REFERENCES copy_jobs(id),
  copy_trade_id UUID REFERENCES copy_trades(id),
  kind          TEXT NOT NULL CHECK (kind IN (
                  'missed_trade','partial_fill','desync_qty','desync_missing',
                  'orphan_position','price_drift')),
  severity      TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','critical')),
  expected      JSONB,                  -- {lot, side, symbol, entry}
  observed      JSONB,                  -- broker truth at detection
  resolution    TEXT CHECK (resolution IN
                  ('auto_corrected','manual_required','accepted','expired')),
  resolved_at   TIMESTAMPTZ,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_recon_open ON copy_reconciliation (follower_id, detected_at DESC)
  WHERE resolved_at IS NULL;
```

### 3.4 Extend `strategy_subscriptions` with the allocation model

```sql
ALTER TABLE public.strategy_subscriptions
  ADD COLUMN IF NOT EXISTS allocation_model TEXT NOT NULL DEFAULT 'risk_pct'
    CHECK (allocation_model IN ('equity_ratio','fixed_ratio','risk_pct')),
  ADD COLUMN IF NOT EXISTS fixed_scale NUMERIC(10,4) DEFAULT 1.0,  -- for fixed_ratio
  ADD COLUMN IF NOT EXISTS risk_pct    NUMERIC(5,2)  DEFAULT 1.0;  -- for risk_pct
-- allocation_pct, risk_multiplier, max_lot_size, hwm_basis ALREADY EXIST.
```

All net-new tables get RLS: followers/leaders see their own rows
(`follower_id = auth.uid() OR leader_id = auth.uid()`); only `service_role`
writes (workers use the service key). Same pattern as `copy_trades`.

---

## 4. Event flow (end-to-end, one leader signal → 10k followers)

```
1. Strategy Engine decides to open XAUUSD buy.
      └─▶ POST /internal/signals/publish        (engine → its own DB writer)
          INSERT signal_events(status='pending')  ← single row, returns <5ms
          pg_notify('signal_events','<id>')

2. Orchestrator (woken by NOTIFY) claims the event (status→'planning'):
      • SELECT active subs for leader where copy_enabled, status='active'
      • Batch-INSERT copy_jobs  (one per follower, status='queued')
        — 10k rows in chunked inserts of ~1k; ON CONFLICT DO NOTHING (idempotent)
      • signal_events.status='fanned_out', jobs_created=N
      • XADD copy_jobs stream  (Redis) for hot dispatch

3. Executor pool (N replicas) each claim batches:
      a. CLAIM  : SKIP LOCKED grabs up to LIMIT jobs → status='claimed'
      b. RISK   : copy_gate(job)  → status='risk_check'
                  pass → set risk_passed_at; fail → status='rejected'(+reason), journaled
      c. ALLOC  : models.compute_lot(job, follower_equity) → computed_lot
                  if lot < min → status='skipped'
      d. ROUTE  : client_order_id='copy_'||job.id   (idempotent)
                  adapter = factory.get_adapter_for_user(follower, broker)
                  result = POST /api/v1/execute  (reuses engine 12-gate)
      e. PERSIST: INSERT/UPDATE copy_trades; status='filled'|'partial'|'failed'
                  broker fill → execution_events(immutable)

4. execution_events INSERT  ──trigger 029──▶  journal_entries(source='auto')
      └─▶ pg_notify → ai-tagger + ai-coach (read-only, async, never block)

5. Reconciler (loop + on CLOSE event):
      • get_positions() per active follower broker
      • diff vs open copy_trades:
          missing on broker but open here → 'desync_missing' / 'missed_trade'
          qty mismatch                    → 'desync_qty' (auto-resize if within tol)
          partial fill stuck              → 'partial_fill' (retry remainder or accept)
          position on broker, none here   → 'orphan_position' (alert, never auto-close)
      • on leader CLOSE → enqueue close copy_jobs (reduce_only) → settle PnL
        via settleCopyTradesForSignal()  → creator_earnings accrual (HWM)

   Backpressure: if Redis stream depth > threshold or broker rate-limiter trips,
   executor sets job.available_at = NOW() + backoff and releases the claim —
   the queue absorbs the spike; nothing blocks, nothing is lost.
```

**Failure semantics (no trade silently lost):**
- Worker crash mid-job → claim lease expires (claimed_at + lease < NOW()) →
  another worker re-claims. `attempts` caps runaway retries → `failed` + recon row.
- Broker 5xx/timeout → exponential backoff via `available_at`, up to `max_attempts`.
- Duplicate fan-out → `UNIQUE(signal_event_id, subscription_id)` no-ops.
- Duplicate submit → same `client_order_id`; broker dedupes; router checks
  `copy_trades.broker_order_id` before re-submitting.

---

## 5. Allocation models

`alloc/models.py` — one pure function per model, selected by
`strategy_subscriptions.allocation_model`. All outputs clamped by
`min_lot` (broker `volume_min`), `max_lot_size`, broker `volume_step`, and a
hard notional ceiling.

```python
def compute_lot(model, *, leader_lot, leader_equity, follower_equity,
                entry, stop_loss, pip_value, pip_size, params) -> float:
    if model == 'equity_ratio':
        # mirror the leader, scaled by relative account size
        ratio = follower_equity / max(leader_equity, 1e-9)
        return leader_lot * ratio * params.risk_multiplier

    if model == 'fixed_ratio':
        # simple deterministic multiple of the leader's lot
        return leader_lot * params.fixed_scale

    if model == 'risk_pct':
        # size so the SL distance risks exactly risk_pct% of follower equity
        sl_pips = abs(entry - stop_loss) / pip_size
        if sl_pips <= 0:
            return 0.0
        risk_usd = follower_equity * (params.risk_pct / 100.0)
        return risk_usd / (sl_pips * pip_value)
```

| Model | Formula | Use case |
|---|---|---|
| **equity_ratio** | `leader_lot × (follower_eq / leader_eq) × risk_mult` | true mirror; follower P&L tracks leader proportionally |
| **fixed_ratio** | `leader_lot × fixed_scale` | predictable, ignores equity; good for similar-size accounts |
| **risk_pct** | `(follower_eq × risk_pct%) / (sl_pips × pip_value)` | risk-parity; every copy risks the same % regardless of leader sizing (current `scaleLot` behaviour, now selectable) |

Follower equity comes from `adapter.get_equity()` (live broker), cached briefly
per reconciler pass; paper followers use the `paper_state` balance.

---

## 6. Risk Engine (copy-level pre-gate)

The engine's **12-gate institutional risk stack still runs inside `/api/v1/execute`**
(non-bypassable). The copy gate is an *additional, cheaper* pre-filter so we don't
waste a broker round-trip on jobs that will obviously fail:

```
copy_gate(job) → (passed: bool, reason: str)
  1. subscription still active + copy_enabled
  2. follower broker connected + state machine = CONNECTED (broker_state.py)
  3. follower daily copy count < cap; not in cooldown
  4. symbol allowed for follower's broker (dynamic symbol cache)
  5. computed notional ≤ follower max exposure; ≤ max_lot_size
  6. follower not in kill-switch / HALTED state
  7. correlation cap: not already N open copies on same symbol/direction
  8. min equity floor (published_strategies.min_copy_capital)
```

Fail → `copy_jobs.status='rejected'`, `risk_reason` set, journaled, follower
notified. The job is terminal — never retried (a rejection is a decision, not a
transient error).

---

## 7. API contracts

### Internal (service-to-service, `X-Engine-Key` / service role)

```
POST /internal/signals/publish            (engine → bus; the ONLY way to emit)
  body: { leader_id, strategy_id?, signal_id?, event_type, symbol,
          direction?, payload }
  → 202 { signal_event_id }                # returns immediately; no execution

POST /api/v1/execute                       (executor worker → engine; EXISTS)
  body: { broker, symbol, side, order_type, quantity, stop_loss?, take_profit?,
          client_order_id, max_slippage_pct, user_id }
  → 200 ExecuteOut { ok, order_id, status, filled_qty, avg_fill_price, slippage_pct }

POST /internal/copy/reconcile/run          (cron/manual trigger for reconciler)
  → 200 { checked, missed, partial, desync, resolved }
```

### Public (web app, Supabase JWT + RLS)

```
POST   /api/copy/subscribe
  body: { strategy_id, copy_mode, allocation_model, allocation_pct?,
          fixed_scale?, risk_pct?, risk_multiplier?, max_lot_size?,
          copy_sl, copy_tp, broker? }
  → 201 { subscription_id }

PATCH  /api/copy/subscriptions/:id         # change model / pause / risk params
DELETE /api/copy/subscriptions/:id         # cancel (open copies flatten or detach)

GET    /api/copy/jobs?status=&limit=       # follower's queue/exec history
GET    /api/copy/trades?range=30d          # follower copy_trades + PnL
GET    /api/copy/reconciliation?open=1     # follower's open desync issues
POST   /api/copy/reconciliation/:id/ack    # acknowledge / accept a desync

# Leader side
POST   /api/strategies/:id/publish-signal  # proxy → /internal/signals/publish
GET    /api/strategies/:id/copy-stats       # followers, AUM, fan-out latency
GET    /api/creator/earnings                # creator_earnings (HWM accruals)
```

All public routes call `supabase.auth.getUser()` and rely on RLS — the same
contract every existing route follows.

---

## 8. Deployment structure

```
Vercel
  └─ apps/web                    Next.js — UI + public API + leader publish proxy

Railway (project: Algosphere)
  ├─ signal-engine               FastAPI — Strategy Engine + /api/v1/execute
  ├─ copy-orchestrator   (NEW)   worker — bus consumer + fan-out planner
  ├─ copy-executor       (NEW)   worker POOL — risk→alloc→route   [scale replicas]
  ├─ reconciler          (NEW)   worker — sync + PnL tracker (1 + leader election)
  └─ telegram-bot                worker — alerts (existing)

Windows VPS + Cloudflare Tunnel
  └─ mt5-bridge                  MT5 broker connector (singleton terminal)

Managed
  ├─ Supabase                    Postgres + RLS + LISTEN/NOTIFY (control plane)
  └─ Redis (Upstash)     (NEW)   queue transport · idempotency · rate limiters
```

**Scaling path to 10,000+ followers per leader**
- Fan-out: chunked batch INSERT (≈1k rows/insert) → 10k jobs in ~10 inserts, sub-second.
- Dispatch: Redis Streams + consumer groups; `copy-executor` replicas scale linearly.
  Each replica claims small batches via SKIP LOCKED so no two touch the same job.
- Broker limits: per-broker token-bucket rate limiter in Redis (e.g. Binance
  1200 req/min) — executor blocks on the bucket, never on the user request.
- Postgres: `copy_jobs` partitioned by `created_at` (monthly) once volume warrants;
  the claimable partial index keeps the hot set tiny.
- The web request that triggered everything returned after step 1 (one INSERT).

**Capacity sketch:** 10k jobs ÷ (say 8 executor replicas × 20 jobs/s/replica)
≈ 62s to drain a full 10k fan-out — bounded by broker rate limits, not by us, and
fully decoupled from the leader's or follower's HTTP latency.

---

## 9. What to build, in order (each independently shippable)

1. **Migration 030** — `signal_events`, `copy_jobs`, `copy_reconciliation`,
   `allocation_model` columns + RLS + NOTIFY triggers. *(load-bearing — ship first)*
2. **copy-orchestrator** worker — bus → fan-out → `copy_jobs`. Retire
   `relayLeaderSignal`'s fan-out; the publish proxy writes the bus instead.
3. **copy-executor** worker — claim loop + `copy_gate` + `alloc/models` + router
   (reuses `factory.get_adapter_for_user` + `/api/v1/execute`).
4. **reconciler** worker — position diff + `copy_reconciliation` + settlement hook.
5. **Web** — subscribe/config UI for `allocation_model`; jobs + reconciliation
   dashboards; leader copy-stats.
6. **Redis hot path** — Streams + rate limiters (correctness holds without it via
   SKIP LOCKED; add it for latency at scale).
7. **FIX adapter** — new `risk/adapters/fix_adapter.py` conforming to
   `ExecutionAdapter`; no orchestration changes.

Items 1–4 are the production core. 5–7 are scale/UX layers on top.
```
