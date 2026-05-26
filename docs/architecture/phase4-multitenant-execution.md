# Phase 4 — Multi-Tenant Execution (design-first)

Status: **DESIGN**. No execution-kernel code is changed by this document.
It specifies the target, the migration, and — critically — the invariants
that must NOT be broken. Implementation lands in flagged, additive slices,
each preserving the current execution path as the default.

---

## 1. Current state (grounded in the code, not aspiration)

The platform is **already multi-tenant-safe at most layers**. Verified:

| Concern | Mechanism | File |
|---|---|---|
| No double-execution across N workers | `claim_copy_jobs` RPC, `FOR UPDATE SKIP LOCKED` | `copy-engine/executor.py:73`, migr. `031` |
| No duplicate orders on retry | idempotent `client_order_id = copy_<job_id>` + `order_idempotency` | `executor.py:15`, migr. `037` |
| Per-user credential isolation | adapter factory builds a per-user adapter; executor never imports broker SDKs | `engine_client.py:4`, `risk/adapters/factory.py` |
| Cross-account exposure cap | centralized portfolio risk gate | `executor.py:278` |
| Single execution authority | all orders route through engine `/api/v1/execute` (12-gate, non-bypassable) | `engine_client.py:46` |
| Durable, low-latency dispatch | Redis wakeup + durable `copy_jobs` queue as authority | `executor.py:444` |

**Conclusion:** the *order pipeline* (orchestrator → queue → executor →
engine /execute) is horizontally scalable today. The bottleneck is **one
layer down**.

## 2. The actual gap

The **MT5 bridge is a single process with a single MT5 terminal**, accessed
by per-request re-login. That gives three institutional-grade problems:

1. **Throughput ceiling** — every MT5 order for every tenant serializes
   through one terminal (login → trade → logout).
2. **Single point of failure** — bridge down ⇒ all MT5 execution down.
3. **No account-scoped lock** — concurrency is controlled per *job* (claim)
   and incidentally by the bridge serializing; there is no explicit
   at-most-one-in-flight-order-**per-broker-account** guarantee that holds
   once execution is parallelized across multiple bridges.

(Binance/Bybit/OKX/OANDA/Tradovate adapters are HTTP/stateless per-request
and already isolate cleanly — the gap is MT5-specific.)

## 3. The invariant that constrains the solution

> The `MetaTrader5` Python binding is **one-login-per-process**. You cannot
> hold N isolated concurrent MT5 sessions inside a single process.

This is why `start.py` enforces single-instance and the bridge runs
`workers=1` (commit `5ae78ea`, and the standing "no multi-worker uvicorn"
rule). **Isolation is therefore achieved by running MANY single-instance
bridges, not by threading one.** Any design that adds "per-user workers"
*inside* one bridge process is wrong and is explicitly rejected here.

## 4. Target architecture

```
copy-engine/executor (N replicas)
        │  /api/v1/execute            ← unchanged execution authority
        ▼
signal-engine  (per-user adapter factory + 12-gate)
        │
        ▼  mt5_bridge_adapter → BridgeRouter.resolve(account)
        │
   ┌────┴───────────────┬───────────────────┐
   ▼                    ▼                   ▼
 bridge-A             bridge-B            bridge-C        ← fleet
 (1 MT5 terminal,    (1 MT5 terminal)    (1 MT5 terminal)
  workers=1)          per VPS/process
```

Two new concepts, both **additive**:

### 4.1 BridgeRouter (account → bridge instance)
A pure resolver in the engine. Maps a broker *account* to exactly one
bridge in the fleet, so a given MT5 account is always served by the same
terminal (no session thrash, deterministic). Pinning = stable hash of the
account id over the configured fleet, with explicit overrides.

```python
# signal-engine/risk/adapters/bridge_router.py  (NEW, not yet wired)
class BridgeRouter:
    def __init__(self, fleet: list[BridgeNode], overrides: dict[str,str]): ...
    def resolve(self, *, account_id: str) -> BridgeNode: ...   # account-pinned
    def healthy(self) -> list[BridgeNode]: ...                 # from /health
```

Default fleet = `[the single bridge configured today]` ⇒ **behaviour
identical to current** until more nodes are added via env. This is the
backward-compatible seam.

### 4.2 Per-account execution lock
At-most-one in-flight order per `(user_id, broker, account)` across the
whole fleet. Implemented as a short-TTL Redis lock (Redis already present
for the queue wakeup), acquired in the engine immediately before the bridge
call, released on completion/timeout. Prevents two executor replicas from
hitting the *same* MT5 account through *different* bridges simultaneously.
The job-claim lock prevents same-*job* races; this prevents same-*account*
races — a different axis.

## 5. Migration (flagged, reversible, current path is default)

1. **Add** `bridge_router.py` + `BridgeNode` + config parsing
   (`MT5_BRIDGE_FLEET` env, JSON list; absent ⇒ single-node fleet from
   today's `MT5_BRIDGE_URL`). Pure module, **no caller yet**. Unit-tested.
2. **Wire** `mt5_bridge_adapter` to ask the router for its target URL behind
   `EXEC_ROUTER_ENABLED` (default off ⇒ uses `MT5_BRIDGE_URL` exactly as
   now). Flip on in staging only.
3. **Add** the per-account Redis lock in the engine `/execute` MT5 branch,
   behind `EXEC_ACCOUNT_LOCK_ENABLED` (default off). Fail-open on Redis
   error (degrade gracefully — never block execution because the lock
   store is unreachable).
4. **Health-gate routing**: router skips nodes whose `/health` is not READY;
   falls back to any healthy node for unpinned/failover (logged).
5. Roll out fleet node-by-node; each node is the existing hardened bridge.

Every step ships dark; the live path is untouched until a flag is flipped
in a controlled environment.

## 6. Degradation behaviour (hard requirements)

- Router with zero healthy nodes ⇒ engine returns a typed `bridge_unavailable`
  execution error; the executor requeues with backoff (existing path). It
  must **not** crash the engine.
- Redis lock unreachable ⇒ **fail-open** (proceed without the lock) and emit
  a guardian warning. Trading is never blocked by ancillary infra.
- A single bridge crash removes only its pinned accounts; the watchdog
  (Phase 5) restarts it; the router routes around it meanwhile.

## 7. Explicitly NOT changing

- The execution authority model: only `/api/v1/execute` places trades.
- `claim_copy_jobs` / idempotency / 12-gate — all preserved.
- Bridge single-instance + `workers=1` — preserved per node.
- No broker SDKs in the executor.
- Migrations 030–040.

## 8. First implementable slice (awaiting go-ahead)

Step 1 only: `bridge_router.py` + `BridgeNode` + config + unit tests, with
**no wiring**. Zero runtime behaviour change; reviewable in isolation. Steps
2–3 (which touch the live MT5 execution branch) require explicit approval
and a staging validation pass before any flag flips.
