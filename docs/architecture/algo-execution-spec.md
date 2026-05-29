# AlgoSphereQuant — Autonomous Institutional Auto-Trading System Spec

> **Status:** Source-of-truth product/architecture contract.
> **Owner:** Founder.
> **Last reviewed:** 2026-05-28.
>
> This document defines the binding behaviour of the execution platform.
> Any change to lot sizing, retcode validation, risk budgeting, confidence
> thresholds, kill-switch semantics, regime taxonomy, or broker handshake
> protocol MUST land in this file in the same PR. Code that drifts from
> this spec is broken by definition.

---

## Objective

Build a fully controlled institutional-style auto-trading environment
where users **explicitly connect and authorize their own broker accounts**
for autonomous execution under the AlgoSphereQuant intelligence architecture.

The system MUST NEVER trade on accounts that are not explicitly connected
and authorized by the account owner.

The implementation must support:

- MT5 broker connectivity
- isolated per-user execution sessions
- institutional-grade risk governance
- real-time portfolio intelligence
- automated execution
- broker-side SL/TP protection
- execution telemetry
- manual override controls
- full auditability

---

## CORE ARCHITECTURE

### 1. Broker Connection Layer

Secure account connection flow.

User connects:

- MT5 login
- password
- broker server

System validates:

- broker reachable
- account authenticated
- terminal responsive
- trading permissions enabled
- symbol availability verified

Persist **encrypted broker metadata only**.

NEVER expose:

- raw password
- session tokens
- MT5 credentials

Each connected account receives:

- unique execution session
- isolated portfolio state
- isolated risk engine
- isolated adaptive learning state

Required endpoints:

- `POST /api/trading/connect`
- `POST /api/trading/disconnect`
- `GET  /api/trading/status`
- `GET  /api/trading/account`

---

### 2. Autonomous Trading Modes

Selectable execution modes:

**Conservative**

- lower frequency
- higher confidence threshold
- reduced position sizing
- strict regime filtering

**Balanced**

- default institutional mode
- normal confidence thresholds
- adaptive sizing enabled

**Aggressive**

- increased signal acceptance
- expanded risk budget
- higher scaling multiplier

**Manual Approval**

- signals generated automatically
- execution requires user approval

Users must explicitly enable `FULL_AUTOTRADE = true` before any order
execution occurs.

---

### 3. Institutional Strategy Engine

Deploy the full strategy stack:

**Liquidity Sweep Engine**

- stop hunt detection
- previous day high/low sweeps
- reversal confirmation
- ATR-based exits

**Trend Pullback Engine**

- EMA50 / EMA200 alignment
- RSI momentum confirmation
- ATR volatility qualification
- pullback detection

**Ensemble Voting**

- configurable minimum agreeing strategies
- weighted signal fusion

---

### 4. Regime Intelligence Layer

Regime classification using:

- Directional Efficiency Ratio (DER)
- lag-1 autocorrelation
- Shannon entropy
- ATR volatility state

Regimes:

- TRENDING
- RANGING
- BREAKOUT_EXPANSION
- MEAN_REVERSION
- HIGH_VOLATILITY
- NEWS_SHOCK
- EXHAUSTION
- LIQUIDITY_TRAP

Each regime controls:

- trade permission
- size multiplier
- strategy preference
- confidence scaling

---

### 5. Institutional Confidence Engine

Reconstruct raw strategy confidence into contextual institutional confidence.

Factors:

- trend alignment
- volatility quality
- momentum alignment
- session quality
- regime compatibility
- spread degradation
- portfolio concentration
- macro alignment

Output: 0–100 confidence score.

Trade thresholds:

- `< 45`  → reject
- `45–69` → reduced size
- `70–84` → standard
- `85+`   → aggressive allocation

---

### 6. Portfolio Risk Engine

Hard, non-bypassable portfolio controls.

**Account-level**

- daily drawdown lock
- weekly drawdown lock
- max total drawdown
- consecutive loss lock
- cooldown timers

**Portfolio-level**

- max open positions
- max per symbol
- max asset-class exposure
- correlation blocking
- portfolio risk budget

**Trade-level**

- ATR-based sizing
- broker min lot fallback
- MICRO_ENTRY mode
- adaptive lot scaling
- scale-in compression

Risk engine MUST survive:

- process restart
- VPS restart
- MT5 reconnect

All risk state MUST be persisted.

---

### 7. Adaptive Position Sizing

```
risk_per_lot    = (stop_distance / tick_size) × tick_value

strategy_lots   = (risk_per_trade_pct × equity) / risk_per_lot

portfolio_lots  = (remaining_portfolio_budget) / risk_per_lot

target_lots     = min(strategy_lots, portfolio_lots)
                × adaptive_multiplier
                × regime_multiplier
                × fusion_multiplier
```

Snap **DOWN** to broker step size.

Execution hierarchy:

```
IF lots >= broker_min:
    FULL_SIZE
ELIF (broker_min × risk_per_lot) <= remaining_budget:
    MICRO_ENTRY
ELSE:
    SAFE_BLOCK
```

**Never round UP lot sizes.**

---

### 8. Execution Engine

Hardened MT5 execution pipeline.

Requirements:

- type-filling negotiation (FOK / IOC / RETURN)
- retry-aware locking
- strict retcode validation
- latency tracking
- slippage tracking
- broker-side SL/TP placement

**ONLY retcode `10009` counts as a confirmed fill.**

All other retcodes must:

- retry, or
- reject, or
- trigger alerts.

Never fabricate fills.

---

### 9. Trade Lifecycle Management

Once trade opens:

**Break-even logic** — move SL to entry after configured ATR threshold.

**Trailing stop logic** — ATR-based trailing system.

**Position reconciliation** — continuously compare:

- MT5 live positions
- internal cache
- dashboard state

Auto-repair inconsistencies.

---

### 10. User Control Center

Users must have FULL control.

Dashboard features:

- connect / disconnect broker
- enable / disable auto-trading
- pause trading instantly
- emergency close-all
- risk profile selection
- symbol whitelist
- trade history
- execution logs
- live PnL
- portfolio heat
- open positions
- confidence visualization
- regime visualization

Users can:

- limit max risk
- disable symbols
- disable strategies
- force-close positions
- disable adaptive sizing
- disable macro fusion

---

### 11. Safety Requirements

Mandatory protections:

- No execution without explicit account authorization
- No execution without FULL_AUTOTRADE enabled
- No hidden trading
- No silent retries beyond configured limits
- No bypassing risk gates
- No execution if bridge unhealthy
- No execution if MT5 disconnected
- No execution if account equity unavailable
- No execution if symbol metadata invalid
- No execution if `tick_value == 0`
- No execution if spread exceeds threshold

---

### 12. Infrastructure Requirements

- **frontend:** Next.js
- **backend:** FastAPI
- **broker bridge:** Windows VPS MT5 bridge
- **deployment:** Railway + Vercel
- **persistence:** Supabase / Postgres
- **realtime:** websocket stream
- **alerts:** Telegram
- **monitoring:** structured logs + metrics

---

### 13. Production Telemetry

Track:

- execution latency
- fill quality
- slippage
- confidence distribution
- win rate by regime
- strategy contribution
- drawdown curves
- correlation exposure
- rejection reasons
- MT5 reconnect frequency

Build observability dashboards on top of these.

---

### 14. Compliance UX

The UI must clearly state:

> "AlgoSphereQuant does not custody funds.
> Trades execute only on broker accounts explicitly connected and
> authorized by the user."

Require, before activation:

- explicit user consent
- risk disclosure acceptance
- execution authorization confirmation

---

## FINAL OBJECTIVE

The final system functions as:

- a fully autonomous institutional-style execution engine,
- with hardened risk governance,
- user-controlled broker connectivity,
- adaptive intelligence,
- transparent execution,
- and production-grade reliability.

Architecture priorities, in order:

1. survivability
2. execution integrity
3. controlled risk
4. auditability

…**over** trade frequency or aggressive leverage.

---

## Change Protocol

Any PR that touches:

- `apps/signal-engine/risk/**`
- `apps/signal-engine/engine/**`
- `apps/signal-engine/api/execute.py`
- `apps/signal-engine/api/brokers.py`
- `apps/mt5-bridge/**`
- `apps/web/src/app/api/trading/**`

…MUST either (a) leave behaviour unchanged or (b) update this spec in the
same PR. Reviewers should reject silent drift.
