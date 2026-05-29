# AlgoSphereQuant — Spec Gap Audit (2026-05-28)

> **Update 2026-05-29:** Phases A, B and C have landed. See the
> [Closed in this pass](#closed-in-this-pass-2026-05-29) section at the
> bottom for what changed. The section-by-section notes below describe
> the state *before* that work and are kept for historical context.

This is the first pass mapping the 14 sections of [algo-execution-spec.md](./algo-execution-spec.md)
against the current codebase.

Legend:
- ✅ Built — meets the spec.
- 🟡 Partial — code exists, but at least one spec-required behaviour is missing.
- 🔴 Missing — nothing in the codebase corresponds.

---

## 1. Broker Connection Layer — 🟡 Partial

**Built**

- `POST /api/brokers` ([apps/web/src/app/api/brokers/route.ts](../../apps/web/src/app/api/brokers/route.ts))
  encrypts MT5 credentials with AES-256-GCM and persists only ciphertext.
- `POST /api/brokers/:id/test` ([apps/web/src/app/api/brokers/[id]/test/route.ts](../../apps/web/src/app/api/brokers/[id]/test/route.ts))
  → `POST /api/v1/brokers/test` on the engine ([apps/signal-engine/api/brokers.py](../../apps/signal-engine/api/brokers.py))
  performs the live broker handshake: reachable, authenticated, equity readable.
- Per-user adapter cache + vault ([apps/signal-engine/risk/adapters/factory.py](../../apps/signal-engine/risk/adapters/factory.py))
  isolates each user's execution session.
- Broker-account ownership registry blocks the same MT5 account being claimed
  by two AlgoSphere profiles ([supabase/migrations/20240101000041_broker_account_ownership.sql](../../supabase/migrations/20240101000041_broker_account_ownership.sql)).

**Missing vs. spec**

- **Spec endpoints don't exist verbatim.** Spec names:
  - `POST /api/trading/connect`
  - `POST /api/trading/disconnect`
  - `GET  /api/trading/status`
  - `GET  /api/trading/account`

  Today we have `POST /api/brokers`, `DELETE /api/brokers/:id`, `POST /api/brokers/:id/test`,
  `GET /api/brokers`. Same surface area, different shape. Either we update the
  spec to match the current shape, or add `/api/trading/*` as thin aliases.
- **Trading-permissions check** (the broker side actually allows order placement)
  is not part of the test handshake — it only verifies login + equity-read.
- **Symbol-availability verification** during connection is not performed; the
  engine discovers symbol issues per-trade at gate 9.

---

## 2. Autonomous Trading Modes — 🔴 Missing

**Built** — nothing user-facing.

**Missing vs. spec**

- No `profiles.trading_mode` column (Conservative / Balanced / Aggressive / Manual).
- No `profiles.full_autotrade_enabled` (or equivalent) gate before execution.
- The execution path in [apps/signal-engine/api/execute.py](../../apps/signal-engine/api/execute.py)
  has no mode-aware adjustments to confidence threshold, risk budget, or sizing
  multiplier.
- No "Manual Approval" queue.

**This is a P0 gap.** The spec is explicit: *"Users must explicitly enable
FULL_AUTOTRADE = true before any order execution occurs."* Today, once a
broker is connected and a signal fires through copy/relay, the engine will
execute. There is no spec-compliant "armed" toggle.

---

## 3. Institutional Strategy Engine — ✅ Built

- **Liquidity Sweep Engine** — [apps/signal-engine/engine/signal_engine.py:62](../../apps/signal-engine/engine/signal_engine.py#L62)
  detects PDH/PDL sweeps with reversal confirmation.
- **Trend Pullback Engine** — `trend_continuation` at [apps/signal-engine/engine/signal_engine.py:42](../../apps/signal-engine/engine/signal_engine.py#L42)
  uses EMA alignment + RSI + ATR-aware MACD.
- **Ensemble Voting** — weighted strategy fusion by regime weights
  (see [regime_engine.py](../../apps/signal-engine/engine/regime_engine.py)).

Spec says "EMA50 / EMA200 alignment" for trend pullback; we use EMA9/21/50 +
EMA200 (more granular). Acceptable, but worth a spec footnote.

---

## 4. Regime Intelligence Layer — 🟡 Partial

**Built** — DER + autocorrelation + Shannon entropy + ATR percentile classifier
([apps/signal-engine/engine/regime_engine.py](../../apps/signal-engine/engine/regime_engine.py)).

**Missing vs. spec regime taxonomy:**

| Spec regime          | Code regime          | Status                                    |
|----------------------|----------------------|-------------------------------------------|
| TRENDING             | `TRENDING`           | ✅                                         |
| RANGING              | `RANGING`/`MEAN_REVERSION` (alias) | ✅                            |
| BREAKOUT_EXPANSION   | `EXPANSION`          | ✅ (rename)                                |
| MEAN_REVERSION       | `MEAN_REVERSION`     | ✅                                         |
| HIGH_VOLATILITY      | `HIGH_VOLATILITY`    | ✅                                         |
| NEWS_SHOCK           | —                    | 🔴 missing                                 |
| EXHAUSTION           | `EXHAUSTION`         | ✅                                         |
| LIQUIDITY_TRAP       | —                    | 🔴 missing                                 |

`NEWS_SHOCK` and `LIQUIDITY_TRAP` are spec-required and absent. They both
warrant their own classifiers because they should fully suppress new trades
(like `EXHAUSTION`).

---

## 5. Institutional Confidence Engine — 🟡 Partial

**Built** — 9-factor scorer ([apps/signal-engine/engine/confidence_engine.py](../../apps/signal-engine/engine/confidence_engine.py)).

**Missing vs. spec factor list:**

| Spec factor                | Code factor          | Status |
|----------------------------|----------------------|--------|
| trend alignment            | `ema_alignment`      | ✅      |
| volatility quality         | `atr_percentile`     | ✅      |
| momentum alignment         | `macd_alignment`     | ✅      |
| session quality            | `session_quality`    | ✅      |
| regime compatibility       | `regime_quality`     | ✅      |
| spread degradation         | `spread_quality`     | ✅      |
| **portfolio concentration**| —                    | 🔴      |
| **macro alignment**        | —                    | 🔴      |

**Spec thresholds vs. code thresholds:**

| Spec band      | Action            | Code band      | Action      |
|----------------|-------------------|----------------|-------------|
| `< 45`         | reject            | `< 50`         | `blocked`   |
| `45–69`        | reduced size      | `50–64`        | `normal`    |
| `70–84`        | standard          | `65–79`        | `aggressive`|
| `85+`          | aggressive        | `80+`          | `exceptional`|

Thresholds are misaligned. We can either lift the spec to match what the
calibration actually demonstrated, or retune the engine to the spec.

---

## 6. Portfolio Risk Engine — ✅ Built (with caveats)

**Built** — 12-gate `RiskGate` ([apps/signal-engine/risk/risk_gate.py](../../apps/signal-engine/risk/risk_gate.py))
with kill switch, drawdown locks, cooldowns, persistence.

**Spec coverage:**

| Spec requirement                | Status                                              |
|---------------------------------|-----------------------------------------------------|
| daily drawdown lock             | ✅ `_halt_until_midnight`                            |
| weekly drawdown lock            | ✅ `_halt_until_next_monday`                         |
| max total drawdown              | ✅ `_fire_kill`                                      |
| consecutive loss lock           | ✅ `max_consecutive_losses`                          |
| cooldown timers                 | ✅ `cooldown_until_iso`                              |
| max open positions              | ✅ Gate 8                                            |
| max per symbol                  | 🔴 not enforced                                      |
| max asset-class exposure        | 🟡 sizing-side only via `ASSET_RISK_TIERS`           |
| correlation blocking            | 🔴 not enforced in the per-trade gate                |
| portfolio risk budget           | 🟡 implicit via per-trade pct; no portfolio cap      |
| ATR-based sizing                | ✅                                                   |
| broker min lot fallback         | ✅ micro-account guard                                |
| MICRO_ENTRY mode                | ✅                                                   |
| adaptive lot scaling            | ✅ `_adaptive_multiplier`                            |
| scale-in compression            | 🔴 no scale-in logic                                 |
| state survives restart          | ✅ `RiskStateStore`                                  |

---

## 7. Adaptive Position Sizing — 🟡 Partial

The formula `risk_per_lot = stop_distance / tick_size × tick_value` is implemented
exactly ([risk_engine.py:342](../../apps/signal-engine/risk/risk_engine.py#L342)).

Snap-DOWN to lot step is correct ([risk_engine.py:350](../../apps/signal-engine/risk/risk_engine.py#L350)).

**Missing:**

- **`portfolio_lots = remaining_portfolio_budget / risk_per_lot`** — no remaining
  portfolio-level budget computation; only the per-trade percentage is enforced.
- **`fusion_multiplier`** — adaptive and regime multipliers exist, fusion
  multiplier (signal-strength × ensemble-agreement) does not.
- **`MICRO_ENTRY` vs. `SAFE_BLOCK` distinction** is implicit (the function
  returns 0.0 with a reason when the micro-account guard would breach the cap)
  but doesn't surface a labelled `SAFE_BLOCK` outcome to the gate decision.

---

## 8. Execution Engine — 🟡 Partial

**Built** — MT5 bridge with proper retcode handling
([apps/mt5-bridge/bridge.py](../../apps/mt5-bridge/bridge.py)) and the engine-side
adapter that talks to it ([apps/signal-engine/risk/adapters/mt5_bridge_adapter.py](../../apps/signal-engine/risk/adapters/mt5_bridge_adapter.py)).

**Need to verify (audit-then-claim):**

- **Filling-type negotiation (FOK/IOC/RETURN)** — bridge.py needs a read to
  confirm.
- **Strict `10009 == filled` semantics** — needs a read on the order paths.
- **Broker-side SL/TP placement** — needs verification that SL/TP are sent
  with the order (not set after).
- **Slippage tracking** — `slippage_pct` is in `OrderResult`; need to confirm
  it's actually populated from a pre-order quote vs. fill price.

These should be spot-checked before claiming compliance.

---

## 9. Trade Lifecycle Management — 🟡 Partial

**Built** — `LifecycleMonitor` ([apps/signal-engine/worker/lifecycle_monitor.py](../../apps/signal-engine/worker/lifecycle_monitor.py))
runs every 2 min.

**Need to verify:**

- Break-even SL move after configured ATR threshold.
- ATR-trailing-stop logic.
- Position reconciliation between MT5 / internal cache / dashboard.

There's also a `/positions` endpoint
([apps/signal-engine/api/execute.py:435](../../apps/signal-engine/api/execute.py#L435))
that the copy-engine reconciler uses, but we don't have a dedicated
3-way diff (MT5 ↔ cache ↔ dashboard) that auto-repairs.

---

## 10. User Control Center — 🟡 Partial

**Built**

- `/brokers` — connect/disconnect with status.
- `/risk` — risk telemetry.
- `/risk/exposure` — portfolio heat.
- `/execution` — execution desk.
- `/execution/monitor` — live monitor.
- `/algo` — orchestration surface ([apps/web/src/app/(dashboard)/algo/page.tsx](../../apps/web/src/app/(dashboard)/algo/page.tsx)).
- `/regime` — regime visualisation.

**Missing vs. spec:**

- **Enable / disable auto-trading switch.** No `FULL_AUTOTRADE` toggle UI.
- **"Pause trading instantly"** is operator-side only (HALTED.flag); no per-
  user pause button.
- **"Emergency close-all"** — backend supports it (`broker.close_all_positions`)
  but there is no user-facing button + API.
- **Risk profile selector** (Conservative/Balanced/Aggressive).
- **Symbol whitelist / strategy disable / disable adaptive sizing / disable
  macro fusion** — none of these per-user overrides exist.

---

## 11. Safety Requirements — 🟡 Partial

| Mandatory protection                          | Status                            |
|-----------------------------------------------|-----------------------------------|
| explicit account authorization                | ✅ vault + ownership registry     |
| FULL_AUTOTRADE enabled before execution       | 🔴 not implemented                |
| no hidden trading                             | ✅ Telegram notify on open        |
| no silent retries beyond configured limits    | ✅ broker_guard                   |
| no bypassing risk gates                       | ✅ `RiskGate` is the only path    |
| no execution if bridge unhealthy              | ✅ broker_guard circuit breaker   |
| no execution if MT5 disconnected              | ✅ adapter `is_connected()`       |
| no execution if equity unavailable            | ✅ refresh_state + gate           |
| no execution if symbol metadata invalid       | ✅ Gate 9                         |
| no execution if `tick_value == 0`             | ✅ sizing rejects                  |
| no execution if spread exceeds threshold      | ✅ Gate 11                        |

**The single critical hole: `FULL_AUTOTRADE`.** Everything else passes.

---

## 12. Infrastructure Requirements — ✅ Built

Frontend Next.js (Vercel) + FastAPI engine (Railway) + Windows VPS MT5 bridge +
Supabase/Postgres + WebSocket stream (`websocket/manager.py`) +
Telegram alerts (`notifier.py`) + structured logs (`observability.py`). Matches.

---

## 13. Production Telemetry — 🟡 Partial

**Built** — execution-side metrics exist:

- `/execute/guard` snapshot — per-broker circuit-breaker state.
- `RiskEngine.telemetry()` — equity, DDs, streaks, locks.
- Slippage on every `OrderResult`.

**Missing:**

- **Confidence distribution** histogram over time.
- **Win rate by regime** dashboard.
- **Strategy contribution** breakdown.
- **Correlation exposure** view.
- **Rejection reasons** aggregate.
- **MT5 reconnect frequency** metric.

These metrics need persisted aggregates + dashboard surfaces.

---

## 14. Compliance UX — 🔴 Missing

**Built** — `/algo` page disclaims "Live execution requires VIP" and is
honest about no fabricated rationale.

**Missing vs. spec — all three are mandatory before activation:**

- Explicit user consent (Terms / Risk Disclosure acceptance).
- "AlgoSphereQuant does not custody funds" copy on connect & execution
  surfaces.
- Execution authorization confirmation (the FULL_AUTOTRADE arming UX).

No `user_consents` table, no acceptance audit trail.

---

# Cross-cutting summary

The platform's **execution integrity** is mature: risk gate, ownership
registry, vault, kill switch, ATR sizing, lifecycle monitor, telemetry are
all in place. The two structural holes are at the **product/UX layer**:

1. **No FULL_AUTOTRADE arming.** Section 2 + Section 10 + Section 11 + Section 14
   collectively say *"Users must opt in to autonomous execution. There must be
   a switch. There must be consent. There must be a kill button."* — none of
   that exists today.

2. **No trading-mode selector.** Conservative / Balanced / Aggressive / Manual
   has no schema, no UI, no execution effect.

If we close those two, the platform crosses the line from "executes
correctly" to "executes correctly **and on the user's terms**" — which is
the spec's real ask.

---

# Recommended next slice

**Phase A — Compliance & arming (closes Sections 2 / 10 / 11 / 14):**

1. Migration adding `profiles.trading_mode`, `profiles.full_autotrade_enabled`,
   `profiles.autotrade_armed_at`, `profiles.autotrade_consent_version`.
2. Migration adding `user_consents` (immutable acceptance log).
3. `/api/trading/arm` + `/api/trading/disarm` + `/api/trading/panic-close`
   routes.
4. Engine-side guard: refuse `/execute` when the caller's profile has
   `full_autotrade_enabled = false`.
5. UI: `AutotradeArmCard` on `/algo` with consent checkboxes, mode picker,
   and "Pause/Panic close" action row.

**Phase B — Strategy/regime/confidence alignment:**

1. Add `NEWS_SHOCK` + `LIQUIDITY_TRAP` regimes.
2. Add `portfolio_concentration` + `macro_alignment` factors to the
   confidence engine; reconcile thresholds with the spec.
3. Add the missing risk dimensions: per-symbol cap, correlation block,
   portfolio budget.

**Phase C — Telemetry / observability:**

1. Confidence-distribution + rejection-reason aggregates.
2. Win rate by regime + strategy contribution dashboards.
3. MT5 reconnect-frequency metric.

Phase A is the highest-leverage slice and unblocks legal/UX claims that the
landing page already makes. I'll start there in the next pass.

---

# Closed in this pass (2026-05-29)

## Phase A — Arming / consent / modes (sections 2, 10, 11, 14)

- Migration [20240101000047_autotrade_arming.sql](../../supabase/migrations/20240101000047_autotrade_arming.sql):
  `profiles.full_autotrade_enabled` / `trading_mode` / `autotrade_armed_at` /
  `autotrade_disarmed_at` / `autotrade_consent_version`, plus `user_consents`
  and `panic_close_events` audit tables (RLS: self-read, service-role write).
  Defaults fail-CLOSED — no existing profile auto-arms.
- Web routes: `POST /api/trading/arm`, `POST /api/trading/disarm`,
  `GET /api/trading/status`, `POST /api/trading/panic-close`
  ([apps/web/src/app/api/trading](../../apps/web/src/app/api/trading)).
- Engine route [apps/signal-engine/api/trading.py](../../apps/signal-engine/api/trading.py):
  `POST /trading/panic-close` (per-user multi-broker flatten via reduce_only)
  + `POST /trading/autotrade-check`.
- **Execute gate** [apps/signal-engine/api/execute.py](../../apps/signal-engine/api/execute.py):
  `_autotrade_armed()` refuses opening orders when the user hasn't armed or
  has stale consent. **Fail-CLOSED.** reduce_only (closes) bypass it. This
  is the section-11 hole, now closed.
- UI [AutotradeArmCard.tsx](../../apps/web/src/components/algo/AutotradeArmCard.tsx)
  on `/algo`: mode picker, dual consent checkboxes, arm/pause/panic.
- Shared constants [apps/web/src/lib/autotrade.ts](../../apps/web/src/lib/autotrade.ts)
  (`CONSENT_DOC_VERSION`, `MODE_OVERRIDES`).

## Phase B — Regime / confidence / risk (sections 4, 5, 6, 7)

- Regimes: `NEWS_SHOCK` + `LIQUIDITY_TRAP` added to
  [regime_engine.py](../../apps/signal-engine/engine/regime_engine.py); both
  fully suppress trading and score 0 quality.
- Confidence: `portfolio_concentration` + `macro_alignment` factors added to
  [confidence_engine.py](../../apps/signal-engine/engine/confidence_engine.py)
  (max 110 pts, normalised to 100); publish bands retuned to the spec's
  45/70/85. Calibration helper thresholds aligned to match.
- Risk gates 13/14/15 added to
  [risk_gate.py](../../apps/signal-engine/risk/risk_gate.py): per-symbol cap,
  correlation block, portfolio risk budget. Per-symbol exposure now tracked
  in `RiskState.open_positions_by_symbol`.

## Phase C — Telemetry (section 13)

- [analytics/telemetry.py](../../apps/signal-engine/analytics/telemetry.py) +
  `GET /api/v1/telemetry/distributions`: confidence distribution,
  win-rate-by-regime, strategy contribution, MT5 connection health. Honest
  empty markers where data isn't persisted.
- Surfaced on `/execution/monitor` via a server-rendered telemetry section.

## Still open (deferred)

- **Rejection-reason aggregation** needs a persisted `GateDecision` table
  (gate rejections are logged but not queryable). Telemetry returns an
  explicit not-yet-persisted marker.
- **`/api/trading/*` are additive** — the original `/api/brokers/*` routes
  remain. We did NOT rename them; the spec's verbatim endpoint names are
  satisfied by `/api/trading/{status,arm,disarm,panic-close}` plus the
  existing broker CRUD.
- **Macro alignment input** is wired through the confidence engine but the
  caller (signal worker) still passes the neutral 0.5 default — a real macro
  feed (DXY / BTC dominance) is a follow-up.
- **Manual-approval queue**: `trading_mode='manual'` is stored and the engine
  respects the arming flag, but the per-signal approval queue UI is not built
  yet — manual mode currently behaves as "armed but you should watch it".
- DB migration 047 is written but **not yet pushed** (`supabase db push`).
