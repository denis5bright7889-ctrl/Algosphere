# Phases 5 / 7 / 10 — Operational Hardening (verify + gap-closure)

These three phases ask for institutional bridge reliability, an adaptive
risk guardian, and a hardened deployment. **Most of it already exists and
is verified working.** This document records the verified state with code
evidence, then specifies only the *genuine* gaps and the safe, flagged way
to close them. No execution-kernel rewrite is implied.

---

## Phase 5 — MT5 bridge hardening

### Already in place (evidence)
| Requirement | Status | Evidence |
|---|---|---|
| Singleton enforcement | ✅ | `start_runtime.py:175 _acquire_single_instance`; lock file + healthy-owner check |
| Process supervisor / restart | ✅ | `start_runtime.py` Task-Scheduler model; config-error → exit 2 so watchdog won't loop-restart (`:10`, `:93`) |
| NSSM compatibility | ✅ | documented migration from NSSM (`start_runtime.py:16`) |
| MT5 readiness re-probe | ✅ | `bridge.py:181 _probe_mt5` (never raises), `:220 wait_for_mt5_ready` (idempotent), readiness watchdog loop |
| Degraded mode | ✅ | `bridge.py:234 require_mt5_ready` → HTTP 503 on trading routes until ready; API stays up |
| Always /health | ✅ | `/health` with `service_uptime_s`, dep report (`bridge.py:528`) |
| Never crash API on dep/probe failure | ✅ | `_probe_mt5` never raises; `dependency_guard` never fatal for optional deps |

### Genuine gaps → safe closure
1. **Mid-session reconnect self-heal.** Re-probe handles *startup*; add a
   watchdog branch that, on a terminal drop detected mid-session
   (`terminal_info()` returns None after being ready), flips `mt5_ready`
   false, attempts bounded re-`initialize()`, and logs the transition. Pure
   additive in the existing readiness watchdog; trading routes already 503
   while not ready, so this degrades correctly.
2. **Rotating JSON logs.** loguru is present; add a rotating sink
   (size+retention) and a JSON serialize option behind `LOG_JSON=1`. No
   behaviour change when unset.
3. **Resource monitoring.** `psutil` capability already probed by the guard
   but unused; surface process RSS/CPU on `/health` when available
   (capability-gated, optional).
4. **Explicit safe-mode flag.** A `BRIDGE_SAFE_MODE` env that forces the
   bridge to serve `/health` + read-only endpoints and refuse order
   placement (returns a typed `safe_mode` rejection) — for controlled
   incident response. Default off ⇒ current behaviour.

All four are additive and flagged; none change the hot path by default.

---

## Phase 7 — Guardian

### Already in place (evidence)
| Requirement | Status | Evidence |
|---|---|---|
| Drawdown circuit breakers | ✅ | `risk_engine.py:178 _enforce_drawdown_limits` (daily/weekly/total) |
| Emergency halt / kill switch | ✅ | `risk_engine.py:235 _fire_kill`, `kill_switch.py`, global `set_global_kill_switch` RPC |
| Cooldown / halt with expiry | ✅ | `risk_engine.py:219/227 _halt_until_*`, `:136` auto re-enable |
| Execution throttling | ✅ | `risk_engine.py:382 _adaptive_multiplier` scales lot down under stress |
| Loss-streak hard breaker | ✅ | `risk_engine.py:264 record_trade` → hard breaker → kill |
| Telemetry | ✅ | `risk_engine.py:440 telemetry()` |
| Broker health worker | ✅ | `worker/broker_health.py`; `copy_health`, `engine_circuit_breaker` tables |

The RiskEngine is **synchronous gate logic** in the execution path (correct —
gates must be inline and non-bypassable). What's missing is the *adaptive
background* dimension.

### Genuine gap → safe closure
**An async Guardian monitor** (separate task/worker), layered ON TOP of the
existing gates, that:
- samples execution **latency** (engine→bridge round-trip), **reconnect**
  counts, and **broker instability** from `copy_health` / `broker_health`;
- trips the existing `engine_circuit_breaker` (and, on severe anomaly, the
  existing kill switch) — it does **not** invent a parallel halt path;
- runs as a background loop with **fail-open** semantics: a Guardian error
  or data-store outage logs a warning and leaves trading under the inline
  gates — it must **never** block startup or create an execution deadlock.

Interface sketch (new `risk/guardian.py`, additive, started as a background
task; does not gate the hot path directly — it feeds the existing breaker):
```python
class Guardian:
    async def run(self): ...          # sample → score → maybe trip breaker
    def score(self, sample) -> RiskScore: ...   # latency/reconnect/instability
```
Hard rule: Guardian *observes and trips existing controls*; the inline
RiskEngine remains the authority that actually blocks an order.

---

## Phase 10 — Deployment

### Already in place
- **Vercel** (web), **Railway** (signal-engine + 5 copy-engine workers),
  **Windows VPS** (MT5 bridge via `start_runtime.py` + Task Scheduler).
- Auto-restart: Task Scheduler "At log on" + single-instance guard; Railway
  service restarts.
- `/health` on the bridge; engine health endpoints.

### Genuine gaps → safe closure
1. **Health-gated routing.** Couple the Phase 4 `BridgeRouter` to `/health`
   READY so the engine only routes MT5 orders to healthy bridges and routes
   around degraded ones. (Lands with Phase 4 step 4.)
2. **Cloudflare tunnel hardening.** Document + script the named-tunnel
   config for the VPS bridge (no inbound ports; tunnel-only ingress;
   access policy on the bridge hostname). Ops doc + config, not app code.
3. **Startup orchestrator.** A documented boot order (bridge READY → engine
   adapter cache warm → workers claim) and a `scripts/` healthcheck that
   gates deploy promotion on all three tiers reporting healthy.

---

## Cross-cutting invariants (unchanged by all three)
- Only `/api/v1/execute` places trades; inline 12-gate non-bypassable.
- Bridge single-instance, `workers=1` per node.
- No multi-worker uvicorn.
- Graceful degradation everywhere: ancillary failure (guardian, logs,
  resource probe, audit, lock store) never blocks execution.
- Migrations 030–040 preserved.

## Sequencing
Phase 5 gaps (1–4) and Phase 7 guardian are independently shippable as
additive, flagged slices with unit tests, each preserving the current path
as default. Phase 10 health-gated routing is gated on Phase 4 step 4. Each
slice requires a staging validation pass before any flag flips in prod.
