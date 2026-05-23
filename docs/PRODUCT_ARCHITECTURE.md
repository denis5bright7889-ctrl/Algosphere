# AlgoSphere Quant — Product, Feature & Monetization Architecture

> Single source of truth for the product surface, tier matrix, modular system
> design, build roadmap, and monetization. Grounded in the **actual deployed
> codebase**, not aspiration. Read [architecture.md](architecture.md) for the
> low-level technical map.

---

## 0. Reality Check — What Already Exists (deployed today)

Before planning new modules, this is what is **live and working** as of this
document:

| Capability | Status | Where |
|---|---|---|
| 3-tier plans: Starter $29 / Pro $99 / VIP $299 | ✅ Live | `lib/stripe/plans.ts`, `lib/types.ts`, migration `…_vip_tier.sql` |
| AI signal engine (features→regime→confidence→ensemble→gate) | ✅ Live on Railway | `apps/signal-engine/engine/*` |
| 12-gate institutional risk engine + kill switch + persistence | ✅ Live | `apps/signal-engine/risk/*` |
| Signal lifecycle auto-monitor (TP/SL close) | ✅ Live | `risk/lifecycle_monitor.py` |
| Confidence-calibration analytics | ✅ Live | `analytics/engine.py` |
| Tier-aware WebSocket + REST API | ✅ Live | `apps/signal-engine/api`, `websocket` |
| Realtime signals feed, regime page, risk telemetry panel | ✅ Live | `apps/web` |
| Performance analytics (Sharpe/Sortino/Calmar/drawdown/equity curve) | ✅ Live | `lib/analytics/metrics.ts` |
| Trade journal (CRUD, tags, screenshots, summary) | ✅ Live (basic) | `(dashboard)/journal` |
| Telegram bot (`/start /signals /status /subscribe`) | ✅ Live on Railway | `apps/telegram-bot` |
| Binance USDT-TRC20 payment + manual admin approval | ✅ Live | `api/payments`, `api/admin/payments` |
| Demo / sandbox mode + closed-beta free access | ✅ Live | `lib/demo.ts`, `lib/beta-access.ts` |
| RBAC (admin email bypass, tier gating) | ✅ Live | `lib/admin.ts` |
| Premium gold-on-black UI, glassmorphism, mobile-first | ✅ Live | `globals.css`, `tailwind.config.ts` |
| Supabase schema + RLS (27 migrations) | ✅ Live | `supabase/migrations` |
| `referrals` table (schema only, no UI/logic) | ⚠️ Partial | migration `…_initial_schema.sql` |
| **Multi-broker live execution adapters** (Binance / Bybit / OKX testnet) | ✅ Live | `risk/adapters/{binance,bybit,okx}_adapter.py` |
| **MT5 multi-tenant bridge** (Windows VPS + Cloudflare Tunnel) | ✅ Live, verified $592 equity 2026-05-21 | `apps/mt5-bridge/`, `risk/adapters/mt5_bridge_adapter.py` |
| **Paper broker** (zero-credential virtual trading) | ✅ Live | `risk/adapters/paper_adapter.py`, `paper_state` table |
| **Broker state machine** (PENDING/CONNECTED/FAILED/DISABLED, 2-cycle cap) | ✅ Live | `risk/broker_state.py`, migration `…_broker_state_machine.sql` |
| **Sync handshake endpoint** for instant /brokers verdict | ✅ Live | `api/v1/brokers/test`, `api/brokers/[id]/test/route.ts` |
| **Bridge Command Centers** (standalone + inside SaaS admin) | ✅ Live | `apps/mt5-bridge/dashboard.html`, `(admin)/bridge/` |
| **Dynamic per-server symbol cache** (no static SYMBOL_WHITELIST) | ✅ Live | `bridge.py` `_ensure_symbol_cache()` |
| **Immutable execution event log** | ✅ Live | `execution_events` table |
| **Cloudflare named tunnel** (`mt5.algospherequant.com` stable URL) | ✅ Live | see [[mt5-bridge-architecture]] memory |

**~70% of the requested surface already ships** (up from ~45% when this doc
was first written). The roadmap below sequences the remaining ~30%.

---

## 1. Monorepo Topology (the modular backbone)

```
algosphere/
├── apps/
│   ├── web/              Next.js 16 — UI, API routes, RBAC, payments      [Vercel]
│   ├── signal-engine/    Python FastAPI — intelligence + risk + lifecycle [Railway]
│   │   └── risk/adapters/  Binance / Bybit / OKX / MT5(bridge) / Paper    (in-process)
│   ├── telegram-bot/     Python — multi-tenant alerts                     [Railway]
│   ├── mt5-bridge/       FastAPI on Windows VPS — MT5 terminal driver     [VPS + Cloudflare Tunnel]
│   ├── chain-indexer/    Python/Node — on-chain + whale analytics (NEW)   [worker]
│   └── copy-router/      Python — copy-trade fan-out engine (NEW)         [worker]
├── packages/             shared TS types, config
└── supabase/migrations/  one source of truth for schema + RLS (27 files)
```

**Note on execution architecture:** the broker adapters live **inside
`signal-engine/risk/adapters/`**, not as a separate `execution-engine` app.
Each adapter is a class implementing `ExecutionAdapter` — Binance / Bybit / OKX
talk REST directly to the exchange; the MT5 adapter HTTP-proxies to the
Windows bridge service at `apps/mt5-bridge/`. The factory at
`risk/adapters/factory.py` picks the right adapter per-user via
`broker_connections.broker`. A separate `apps/execution-engine` was the
original plan but proved unnecessary — keeping execution in-process with the
signal engine eliminates an RPC hop and avoids needing a second always-on
service for a low-QPS workload.

**Design rule that makes this scale:** every new product line is a **separate
service that reads/writes Supabase** and is **gated by `subscription_tier` via
RLS + `canAccess()`**. No new module is allowed to touch another module's
tables directly — they integrate through Supabase rows and the WS/REST contract.
This is why adding copy-trading or whale analytics never destabilises signals.

**The critical seam already proven:** `risk/adapters/base.py` defines the
abstract `ExecutionAdapter` (`submit_order` / `cancel_order` / `get_positions`
/ `refresh_state` / `connect`). Five concrete implementations live today:
`BinanceAdapter`, `BybitAdapter`, `OKXAdapter`, `MT5BridgeAdapter`,
`PaperBroker`. Adding cTrader / OANDA / IB / NinjaTrader is one new file each,
conforming to the same interface — no engine changes required.

---

## 2. Tier Feature Matrix

Legend: ✅ built · 🟡 partial/needs UI · 🔵 net-new module · ⚠️ regulated/3rd-party-cost

### STARTER — $29/mo (7-day free trial)

| Feature group | Items | Status |
|---|---|---|
| Signals | Forex/crypto/commodity/index, AI confidence, SL/TP, daily summary | ✅ (crypto = Pro gate) |
| Alerts | Telegram, Email, mobile push | 🟡 Telegram ✅; email/push 🔵 |
| Dashboard | equity, win-rate, history, daily/weekly PnL, market widgets | ✅ |
| Journal SaaS | tracking, screenshots, notes, tags, R:R, daily journaling | ✅ basic; emotion/auto-import 🟡 |
| Market tracker | trending assets, heatmaps, fear&greed, basic smart-money | 🔵 |
| Community | free Telegram, daily analysis, edu hub, econ calendar, news | 🟡 |
| Tools | risk/position/pip calculators, news tracker | ✅ calculators; news 🔵 |
| Limits | no automation, no copy-trade, delayed whale, capped history | enforced via `canAccess` |

### PRO — $99/mo (everything in Starter +)

| Feature group | Items | Status |
|---|---|---|
| Verified performance | broker-linked PnL/win-rate, Sharpe/Sortino, drawdown, ROI, heatmaps | ✅ metrics; broker-verified 🔵 |
| Advanced analytics | AI sentiment, correlation matrix, liquidity/volume heatmaps, MTF | 🟡 regime ✅; rest 🔵 |
| Alerts | WhatsApp, SMS, VIP Telegram, realtime push | 🔵 (Twilio/Meta) |
| Advanced journal | AI psychology, mistake AI, trade-review AI, discipline score | 🔵 (LLM layer) |
| Signal upgrades | higher-conf (≥85), faster, multi-market, trend-probability | ✅ via `tier_required` tag |
| Social | follow traders, share journals, leaderboards, public profiles | 🔵 |
| Market intel | whale tracking, token flows, arbitrage scanner, exchange flow | 🔵 ⚠️ |
| Prop-firm toolkit | drawdown/daily-loss tracker, compliance, lot assistant, copier | 🟡 risk engine reusable |
| Automation | semi-auto signals, smart routing, AI suggestions | 🔵 |

### VIP / INSTITUTIONAL — $299/mo (everything in Pro +)

| Module | Status | Notes |
|---|---|---|
| Institutional AI quant bot (Binance/Bybit/OKX/MT5/cTrader) | 🔵 ⚠️ | `apps/execution-engine`; **regulatory review required** |
| Institutional risk engine (19 controls) | ✅ | already built — 12-gate `risk_gate` + `risk_engine` |
| Automated execution dashboard | 🟡 | risk telemetry panel exists; extend with positions/latency |
| Copy-trading platform | 🔵 ⚠️ | `apps/copy-router` |
| Copy-trade AI filter bot | 🔵 | trader-quality scoring engine |
| Crypto analytics terminal (Nansen/Dune-style) | 🔵 ⚠️ | `apps/chain-indexer` + paid data provider |
| Prop-firm automation suite | 🔵 | builds on existing risk engine |
| Token launch infrastructure | 🔵 ⚠️ | **separate product + smart-contract audit** |
| Premium Telegram communities | 🟡 | extend existing bot to multi-tenant gated groups |
| Trading Journal Pro+ (AI coaching) | 🔵 | LLM behavioral layer |
| Social trading network | 🔵 | shares infra with copy-trading |

---

## 3. Net-New Modules — Architecture Specs

### 3.1 Multi-broker live execution (in `signal-engine/risk/adapters/`) — partially shipped ⚠️

| Broker | Status | File |
|---|---|---|
| **Binance Futures** (testnet + live) | ✅ Live | `binance_adapter.py` |
| **Bybit Unified** (testnet + live) | ✅ Live | `bybit_adapter.py` |
| **OKX** (demo + live) | ✅ Live | `okx_adapter.py` |
| **MT5** (any MetaTrader 5 broker via Windows bridge) | ✅ Live, multi-tenant verified | `mt5_bridge_adapter.py` + `apps/mt5-bridge/` |
| **Paper broker** (zero-credential virtual trading) | ✅ Live | `paper_adapter.py` + `paper_state` table |
| **cTrader** | ❌ Not implemented | Spec'd via Open API / FIX |
| **Interactive Brokers** | ❌ Not implemented | `ib_insync` or IB Gateway |
| **OANDA** | ❌ Not implemented | REST v20 |
| **NinjaTrader / Tradovate / Rithmic / Sierra / JForex** | ❌ Not implemented | Each is a distinct integration project |

Architecture in place + verified — every adapter conforms to `ExecutionAdapter`
(see `risk/adapters/base.py`), routes through the **existing 12-gate `risk_gate`**
(non-bypassable), uses per-user AES-256-GCM encrypted creds in
`broker_connections`. Reuses `risk_engine` persistence, kill switch, emergency
flatten verbatim.

Adding a new broker = ~150-line Python file conforming to the interface +
optional UI tweak in `BrokersClient.tsx` to label the fields per broker. No
engine changes.

**Regulatory flag (unchanged):** trading user capital programmatically may
require licensing in various jurisdictions. Each broker ships behind a
per-jurisdiction enablement flag + signed user risk disclosure. The
architecture is jurisdictionally-neutral; the **enablement** decision is
business/legal, not engineering.

### 3.2 `apps/copy-router` (copy trading + social) ⚠️

- `strategy_providers`, `copy_subscriptions`, `copy_allocations`,
  `provider_stats` tables (RLS-gated).
- Provider publishes a trade → router fans out to subscribers' execution
  adapters with per-follower allocation/risk scaling.
- **Copy-trade AI filter:** consistency/manipulation scoring job that ranks
  providers; only ≥ threshold providers become copyable.
- Performance fees + revenue share accounted in `ledger` table.

### 3.3 `apps/chain-indexer` (whale / on-chain analytics) ⚠️💲

- Adapter pattern over a paid provider (Nansen API / Dune / Covalent /
  Bitquery) — **recurring data cost is the gating constraint**, architect the
  adapter so the provider is swappable.
- Writes `wallet_signals`, `exchange_flows`, `token_launches`,
  `smart_money_events` → consumed by the Crypto Terminal UI + Telegram.

### 3.4 Token Launch Infrastructure ⚠️

- This is **a separate product**, not a feature of the trading SaaS. Recommend
  a sibling app (`apps/launchpad`) with its own roadmap, smart-contract audit
  budget, and legal review. Listed for completeness; **do not** bundle into the
  trading MVP.

### 3.5 Notifications fabric (cross-tier)

- One `notifications` service: channel adapters (Telegram ✅, Email→Resend,
  SMS/WhatsApp→Twilio/Meta, Web Push→VAPID). Tier decides channels. Single
  `notification_log` table, append-only, RLS.

### 3.6 Trader Type Classification (NEW — onboarding personalization)

- 8 archetypes: Scalper, Day Trader, Swing Trader, Position Trader, Algorithmic
  Trader, Copy Trader, Prop Firm Trader, Arbitrage Trader.
- Captured at signup via a 4-question onboarding wizard (timeframe, hold
  duration, automation preference, capital source).
- Persisted as `profiles.trader_type ENUM` + `profiles.classification_meta JSONB`
  for the raw answers.
- **Drives three downstream behaviors:**
  1. **Risk profile defaults**: scalper → tighter SL %, day → moderate, swing
     → wider SL, position → multi-day TP. Pre-fills the position-size
     calculator + the engine's per-user `risk_config` overrides.
  2. **Strategy recommendations**: the engine's strategy registry (already in
     `signal_engine.py`) tags each strategy with applicable trader types;
     `/strategies` filters to ones matching the user's type by default.
  3. **Dashboard customization**: `/overview` reorders panels — scalpers see
     fills/latency on top; swing/position see equity curve + macro calendar;
     algorithmic traders see `/algo` performance + bridge health.
- One migration: `…_trader_type.sql` adds the enum + the JSONB column + an
  `idx_profiles_trader_type` index.
- One web flow: `/onboarding/trader-type` page + a `lib/trader-type.ts` helper
  that returns the recommended dashboard layout + strategy filters.
- Skippable; defaults to `'day_trader'` if unset.

### 3.7 Live Execution Mirror Chart (NEW — chart overlay)

- TradingView-style chart on `/execution` with **live overlay of the user's
  actual fills, position lines, SL/TP markers, and PnL ribbon**. The data
  path already exists — every adapter writes fills to `shadow_executions`
  + emits `ORDER_FILLED` / `POSITION_CLOSED` events to the new
  `execution_events` table.
- **Data flow:** broker fill → `submit_order()` returns `OrderResult` →
  appended to `execution_events` (immutable, append-only, RLS) → Supabase
  Realtime channel `execution_events:user_id=<uid>` pushes to the user's
  open chart → chart redraws overlay without page reload.
- **Chart library:** `lightweight-charts` (TradingView's open-source
  library) — same look as TradingView, free, no React-heavyweight wrapper
  needed. Price feed from the engine's existing market-data provider chain
  (TwelveData / Finnhub), already in `data/market_data.py`.
- **Overlay markers:**
  - 🟢 entry marker at fill price / time
  - 🔴 exit marker at close price / time
  - horizontal SL (red dashed) + TP1/TP2/TP3 (green dashed) lines while
    position is open
  - PnL ribbon (top-right of chart) updates per tick via mark-to-market
- **One new endpoint:** `GET /api/execution/chart?symbol=&from=&to=` that
  returns OHLCV bars + the overlay-marker rows (fills + position-lifecycle
  events) in one payload, so first paint doesn't need two round-trips.
- **No engine changes required.** The data is already being recorded; this
  is purely a visualization layer.

### 3.8 Auto-Detection Trade Journal (NEW — Phase 2 foundation laid 2026-05-23)

**Goal:** turn every executed trade into a journal row **automatically**, with
zero manual entry, zero latency added to order execution, and graceful
degradation if any non-trading subsystem fails.

**The load-bearing decision:** the trigger lives in the **database**, not in
application code. Every broker adapter already writes `ORDER_FILLED` and
`POSITION_CLOSED` rows to `execution_events` (paper / binance / bybit / okx /
mt5-bridge / oanda / tradovate — wired during Phase D). A
DB trigger on `execution_events INSERT` is therefore a single integration
point that picks up every current and future adapter for free, with no code
changes required in the engine.

**Event flow (single source of truth for auto-journal):**

```
broker fill / close
        │
        ▼
ExecutionAdapter.submit_order() / .close_position()
        │
        ▼
INSERT INTO execution_events (user_id, broker, event_type, payload, …)
        │                                       ▲
        │                                       │ (trigger runs in the same TX
        │                                       │  but is EXCEPTION-guarded so
        │                                       │  any failure swallows silently
        │                                       │  and the event INSERT still
        │                                       │  succeeds — trading must
        │                                       │  never block on auto-journal)
        ▼
TRIGGER trg_auto_journal_from_event (AFTER INSERT, FOR EACH ROW)
        │
        ├─ event_type = 'ORDER_FILLED'     → INSERT journal_entries (source='auto')
        │                                     keyed by auto_position_id
        │
        └─ event_type = 'POSITION_CLOSED'  → UPDATE matching open auto row
                                              (exit_price, pnl, duration_ms)
```

**Schema additions** (migration `…_journal_auto_detection.sql`, shipped):

| Column on `journal_entries` | Type | Purpose |
|---|---|---|
| `source` | TEXT NOT NULL DEFAULT `'manual'` CHECK in (manual, auto) | UI filter; manual `/journal` entries keep `'manual'` |
| `execution_event_id` | UUID FK → `execution_events(id)` ON DELETE SET NULL | Provenance — links the journal row to the fill that birthed it |
| `auto_position_id` | TEXT | Stable key joining entry-fill to exit-close (paper uses same UUID for order/position; real adapters reuse broker_pos_id) |
| `duration_ms` | BIGINT | Computed in the close trigger — `close_ts - entry_ts` |
| `slippage_pct` | NUMERIC(10,6) | Lifted from fill payload when present |
| `regime_at_entry` | TEXT | Set by background enricher (reads regime engine snapshot) |
| `broker` | TEXT | Copied from `execution_events.broker` |
| `ai_tags` | TEXT[] | Populated by the async tagger — starts NULL, never blocking |

Plus two indexes: `(user_id, source, created_at DESC)` for the dashboard
filter and a partial index on `auto_position_id WHERE NOT NULL` for the
close-lookup hot path.

**Strict invariants** (encoded in the trigger function):
1. `SECURITY DEFINER` + explicit `SET search_path = public` — same controlled
   RLS bypass pattern as `handle_new_user`. Service-role inserts to
   `execution_events` already flow through the same definer context.
2. **Whole body wrapped in `EXCEPTION WHEN OTHERS THEN NULL`** — a broken
   auto-journal (malformed payload, missing field, journal-table change)
   **must never** prevent the `execution_events` insert from committing.
   Trading is the load-bearing path; the journal is metadata.
3. Touches **only** `journal_entries`. Does not read or write
   `execution_events`, `broker_connections`, `risk_state`, or any
   trading-critical table.
4. `source = 'auto'` for trigger-created rows; manual entries keep
   `'manual'`. The journal UI's "Auto vs Manual" filter pivots on this.

**What still ships in Phase 2** (deferred to focused follow-ups, NOT yet built):
- **UI badge on auto entries** — `(dashboard)/journal/page.tsx` badge +
  source filter pill. Cosmetic; the data is already labeled.
- **AI tagger** — async background worker reads
  `journal_entries WHERE ai_tags IS NULL`, calls Anthropic with the trade
  context + a constrained classification prompt (breakout / reversal / trend
  / scalp / news / revenge / overtrade), writes back `ai_tags`. Prompt-cached
  to keep cost <$0.001 per trade. **Never** blocks order execution because
  it runs against journal rows, not the live event path.
- **Metadata enricher** — same worker pattern, fills `regime_at_entry` from
  the engine's regime snapshot at fill time, optional fundamental-context
  notes for swing/position trades.
- **Daily / weekly / monthly summary jobs** — cron-driven, send via the
  existing notifications fabric (Telegram ✅, email/push 🔵). Aggregate
  win-rate, profit-factor, expectancy, best/worst session, time-of-day
  heatmap from the same `journal_entries` rows.

**Why the trigger is in SQL, not Python:**
- One write path covers every present and future adapter — adding cTrader /
  IB later requires zero auto-journal code, only the adapter conforming to
  `ExecutionAdapter`.
- No extra service to deploy, monitor, or scale; auto-journal can't fall
  behind a queue.
- The EXCEPTION guard at the SQL level is structurally impossible to defeat
  by an application bug — Python code that wraps `INSERT execution_events`
  inside a `try/except journal_failure` is one missed handler away from
  silently blocking trades. SQL trigger semantics make the failure mode
  enforced.

### 3.9 AI Trading Coach (NEW — Phase 3 design, not yet implemented)

**Goal:** behavioral-PM-style oversight that scores trade discipline, flags
psychological patterns (revenge / overtrade / consistency drift), and
delivers an end-of-day PM-style review. **All non-blocking** — the coach
reads off the populated `journal_entries` rows, never on the live execution
critical path.

**Architecture (event-driven, async, degrades to silent if AI is down):**

```
journal_entries INSERT/UPDATE
        │
        ▼
NOTIFY journal_changed channel (pg_notify)         ← passive; nothing blocks
        │
        ▼
apps/ai-coach worker (Python, on Railway)
   │
   ├─ Per-trade supervision   →  trade_scores (discipline, R:R adherence,
   │                              entry-quality, exit-quality)
   │
   ├─ Pattern detector        →  coach_alerts (REVENGE / OVERTRADE /
   │                              DRAWDOWN_ACCEL / STRATEGY_DEVIATION /
   │                              LOSS_STREAK)
   │
   ├─ Daily roll-up (cron)    →  coach_reports (PM-style markdown summary,
   │                              delivered via notifications fabric)
   │
   └─ Discipline rolling EMA  →  profiles.discipline_score (0-100)
```

**New tables** (one migration, RLS-gated per `user_id`):

```sql
trade_scores (
  id uuid pk, user_id uuid fk, journal_entry_id uuid fk,
  discipline_score numeric(5,2),     -- 0-100 per trade
  rr_adherence numeric(5,2),         -- planned vs actual R:R
  entry_quality numeric(5,2),        -- regime-aware entry score
  exit_quality numeric(5,2),         -- vs hindsight optimal exit
  notes text,                        -- LLM rationale (cached)
  created_at timestamptz default now()
)

coach_alerts (
  id uuid pk, user_id uuid fk,
  kind text check in (
    'revenge','overtrade','drawdown_accel',
    'strategy_deviation','loss_streak','consistency_drift'
  ),
  severity text check in ('info','warn','critical'),
  payload jsonb,                     -- supporting metrics
  acknowledged boolean default false,
  created_at timestamptz default now()
)

coach_reports (
  id uuid pk, user_id uuid fk,
  scope text check in ('daily','weekly','monthly'),
  period_start date, period_end date,
  body_markdown text,                -- the PM-style report
  metrics jsonb,                     -- win_rate, pf, expectancy, dd, …
  created_at timestamptz default now()
)
```

**Rolling discipline score** lives directly on `profiles.discipline_score`
(numeric default 100) so the dashboard header can render it without joining.
Recomputed by the worker on each `trade_scores` insert as an EMA — a single
field update, no expensive re-scan.

**Failure mode:** if `apps/ai-coach` is offline, journal rows still accrue
normally, alerts just stop. When the worker comes back it processes the
backlog of `journal_entries WHERE id NOT IN (SELECT journal_entry_id FROM
trade_scores)`. No data loss, no execution impact.

### 3.10 Mobile UI stability guards (NEW — Phase 1 shipped 2026-05-23)

Three problems explicitly defeated in `apps/web/src/app/globals.css`:

| Problem | Symptom | Fix |
|---|---|---|
| Horizontal scroll on mobile | wide tables / monospace strings pushed the whole page wide | `html, body { overflow-x: hidden; overscroll-behavior-x: none }` + `body { touch-action: pan-y }` |
| iOS Safari auto-zoom on input focus | viewport jump + layout shift when tapping a form field with `font-size < 16px` | `@media (max-width: 768px) { input, select, textarea { font-size: 16px !important } }` |
| Notch / home-indicator clipping | content rendered under the safe-area | `.pb-safe` / `.pt-safe` utilities + `env(safe-area-inset-bottom)` on the dashboard `<main>` and bottom bar (already in place) |

Wide content that genuinely needs horizontal scroll (the payments-history
table on `/settings`) is wrapped in a per-block `overflow-x-auto` container
with `min-w-[Npx]`, so it scrolls **inside** its bounded card instead of
escaping the viewport.

### 3.11 New API endpoints (Phase 2/3 surface)

| Endpoint | Purpose | Status |
|---|---|---|
| `GET  /api/journal/auto` | List auto-detected entries with source filter + pagination | 🔵 (data ready via trigger) |
| `POST /api/journal/[id]/retag` | Force re-tag of one entry through the AI tagger | 🔵 |
| `GET  /api/journal/summary?range=7d|30d|mtd|ytd` | Aggregate analytics block (winrate, pf, expectancy, by-session, by-symbol) | 🔵 |
| `GET  /api/coach/score` | Current rolling discipline score + last 30-day trend | 🔵 |
| `GET  /api/coach/alerts?unack=1` | Active behavioral alerts for the user | 🔵 |
| `POST /api/coach/alerts/[id]/ack` | Acknowledge / dismiss alert | 🔵 |
| `GET  /api/coach/report?scope=daily|weekly|monthly&date=` | Latest PM-style report | 🔵 |

All endpoints check `supabase.auth.getUser()` server-side and rely on RLS for
row visibility — same pattern as every existing API route.

---

## 4. Monetization Architecture

| Model | Mechanism | Status |
|---|---|---|
| Monthly subscription | Binance USDT manual + (future Stripe) | ✅ |
| Annual billing (–20%) | add `billing_interval` to `subscriptions`; price IDs | 🔵 small |
| Profit-sharing | `ledger` + high-water-mark calc on copy/managed accounts | 🔵 |
| Enterprise / white-label / institutional licensing | `organizations` + branding config + seat billing | 🔵 |
| Strategy marketplace fees | take-rate on `strategy_subscriptions` | 🔵 |
| Copy-trading commissions / performance fees | per-trade & HWM accrual in `copy-router` | 🔵 |
| Telegram community memberships | gated chat via bot + recurring entitlement | 🟡 |
| Affiliate / referral | **`referrals` table already exists** — needs link gen + attribution + payout UI | 🟡 *(best next slice)* |
| API access subscription | `api_keys` table exists; add per-tier rate limits + metering | 🟡 |
| Token launch service fees | separate product | ⚠️ |

**Billing principle:** every paid surface checks entitlement **server-side**
via `canAccess()` / RLS. Frontend never grants. This is already enforced and
must remain the invariant for all new modules.

---

## 5. Build Roadmap (sequenced by leverage / effort)

> Effort = focused engineering days for an MVP of that slice. Ordered so each
> phase ships revenue or retention value independently. Phases marked ✅ have
> shipped since this doc was first written.

**Phase A — Monetization completeness (~6–9 d)**
1. Affiliate/referral system (table exists) — link gen, attribution on signup,
   commission ledger, payout dashboard. *Highest ROI, lowest effort.*
2. Annual billing toggle (−20%) + plan-page UI.
3. API-key metering + per-tier rate limits (table exists).

**Phase B — Retention & social proof (~10–14 d)**
4. Verified performance profiles + public trader pages + leaderboard.
5. Notifications fabric (email + web push first; SMS/WhatsApp behind Pro).
6. Journal Pro+ AI layer (LLM trade reviews, discipline score) — Anthropic API,
   prompt-cached, tier-gated.

**Phase C — Copy & prop (~15–20 d)**
7. `apps/copy-router` + social trading network (shared infra).
8. Prop-firm suite (reuses risk engine; mostly UI + rule config).

**Phase D — Live execution (originally ~20–25 d, gated) — ✅ partially shipped**
9. ✅ Binance / Bybit / OKX adapters live in `signal-engine/risk/adapters/`.
10. ✅ **MT5 multi-tenant bridge live** at `apps/mt5-bridge/`, end-to-end
    verified 2026-05-21 (real broker equity flowing). See
    [mt5-bridge-architecture memory] for topology.
11. ✅ Paper broker live — zero-credential onboarding for new users.
12. ✅ Broker state machine + sync handshake + admin Command Centers.
13. ⏳ Remaining: cTrader, IB, OANDA, NinjaTrader, Tradovate, Rithmic. Each
    is ~2 days against the same `ExecutionAdapter` interface.

**Phase E — Crypto intelligence (~15 d + data budget)**
14. `apps/chain-indexer` + Crypto Analytics Terminal UI.

**Phase F — Personalization + visualization (NEW — ~5 d total)**
15. ✅ Trader Type Classification (§3.6) — shipped (8 archetypes + 4-question wizard).
16. ✅ Live Execution Mirror Chart (§3.7) — shipped (`/execution` overlays fills on price).
17. AI Trade Journal Insights — see §3.8/3.9 below — foundation laid.

**Phase F.5 — Auto-journal + AI coach (NEW — ~5 d remaining)**
18. ✅ Auto-detection trigger (§3.8) — `execution_events → journal_entries`
    shipped 2026-05-23 (migration 029). Every adapter's fills now auto-populate
    the journal with zero application changes.
19. 🔵 Journal UI auto-badge + source filter (`(dashboard)/journal/page.tsx`).
    ~0.5 d.
20. 🔵 `apps/ai-tagger` — async worker, Anthropic prompt-cached classifier
    fills `journal_entries.ai_tags`. ~1 d.
21. 🔵 Summary jobs — daily/weekly/monthly Telegram + email digests off the
    populated journal. ~1 d.
22. 🔵 `apps/ai-coach` (§3.9) — trade scoring, behavioral pattern detector,
    rolling discipline EMA, PM-style end-of-day report. ~2 d.

**Phase G — Platform polish (continuous)**
18. Backtesting engine, no-code strategy builder, gamification, mobile app,
    desktop terminal, AI market narration.

Token launchpad = **separate product track**, not on this roadmap.

---

## 6. Cross-Cutting Non-Functionals (already partly in place)

- **Security:** Supabase JWT on every REST/WS; service-role key server-only;
  payment signature verification; append-only `audit_logs` (table exists);
  per-user/IP rate limiting (`observability.py` has the limiter).
- **Reliability:** signal-engine boots in degraded mode (no crash on missing
  env); kill switch + risk-state persistence; Render health checks.
- **Scalability:** stateless services + Supabase as the integration bus; each
  module independently deployable and horizontally scalable.
- **UI:** gold-on-black luxury theme, glassmorphism, animated telemetry,
  mobile-first — already the system default.

---

## 7. Honest Constraints (read before committing budget)

1. **Live auto-execution is the biggest liability.** Programmatically trading
   user funds may require licensing (investment adviser / portfolio manager /
   money transmitter) in many jurisdictions. Phase D ships behind legal sign-off
   and explicit risk disclosures. The architecture is ready; the *enablement*
   is a business/legal decision, not an engineering one.
2. **Whale/on-chain analytics has a real recurring cost.** Nansen/Dune-grade
   data is a paid feed. The adapter is cheap to build; the data subscription is
   the actual line item — price it into the VIP tier economics.
3. **Token launchpad is a different company.** Smart-contract deployment,
   liquidity locking, and treasury tooling carry audit + legal scope unrelated
   to trading SaaS. Recommend spinning it out rather than diluting focus.
4. **Render free tier sleeps.** 24/7 signal generation + live execution require
   a paid always-on instance — non-negotiable before Phase D.

---

## 8. Immediate Next Slice (recommended — updated 2026-05-21)

Three short slices are now all roughly equal-effort and additive. Pick by
which problem hurts most:

**Option A — Trader Type Classification (~1 day).** Easiest, immediate
onboarding UX win. Forces users to commit to a style → drives risk-profile
defaults + dashboard layout. No regulatory exposure.

**Option B — Live Execution Mirror Chart (~3 days).** Highest "wow" factor
for the now-functional MT5 + Binance flow. Users see their actual fills
overlaid on a TradingView-style chart, real-time. The data path
(`shadow_executions` + `execution_events`) already records everything;
this is purely visualization.

**Option C — Affiliate / Referral system (~2–3 days).** Original
recommendation from §8. Still valid: pure revenue lever, schema already
exists (`referrals` table), zero regulatory exposure.

If you can't decide: do **A first** (1 day) for onboarding wins, then **B**
(3 days) so the platform feels alive when users connect their first broker.
**C** can run in parallel since it's purely backend + a dashboard page.

Say which slice and I'll build it end-to-end.
