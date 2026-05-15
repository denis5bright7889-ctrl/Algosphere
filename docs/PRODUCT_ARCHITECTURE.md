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
| AI signal engine (features→regime→confidence→ensemble→gate) | ✅ Live on Render | `apps/signal-engine/engine/*` |
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
| Supabase schema + RLS (8 migrations) | ✅ Live | `supabase/migrations` |
| `referrals` table (schema only, no UI/logic) | ⚠️ Partial | migration `…_initial_schema.sql` |

**~45% of the requested surface already ships.** The roadmap below sequences
the remaining ~55% without rebuilding what works.

---

## 1. Monorepo Topology (the modular backbone)

```
algosphere/
├── apps/
│   ├── web/              Next.js 16 — UI, API routes, RBAC, payments      [Vercel]
│   ├── signal-engine/    Python FastAPI — intelligence + risk + lifecycle [Render]
│   ├── telegram-bot/     Python — multi-tenant alerts                     [Railway]
│   ├── execution-engine/ Python — live broker execution (NEW, isolated)   [Railway/Fly]
│   ├── chain-indexer/    Python/Node — on-chain + whale analytics (NEW)   [worker]
│   └── copy-router/      Python — copy-trade fan-out engine (NEW)         [worker]
├── packages/             shared TS types, config
└── supabase/migrations/  one source of truth for schema + RLS
```

**Design rule that makes this scale:** every new product line is a **separate
service that reads/writes Supabase** and is **gated by `subscription_tier` via
RLS + `canAccess()`**. No new module is allowed to touch another module's
tables directly — they integrate through Supabase rows and the WS/REST contract.
This is why adding copy-trading or whale analytics never destabilises signals.

**The critical seam already built:** `risk/broker_adapter.py` defines an
abstract `BrokerAdapter` (`MockBroker`, `SupabaseBroker`, `MT5Broker` stub).
Live execution, copy-trading, and prop-firm tooling all plug into this one
interface — they do not fork the engine.

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

### 3.1 `apps/execution-engine` (VIP auto-trading) ⚠️

- Implements concrete `BrokerAdapter`s: `BinanceBroker`, `BybitBroker`,
  `OKXBroker`, `MT5Broker`, `CTraderBroker`.
- Consumes published signals from Supabase → routes through the **existing
  12-gate `risk_gate`** (non-bypassable) → places orders.
- Per-user encrypted API-key vault (Supabase Vault / KMS — never plaintext).
- Reuses `risk_engine` persistence, kill switch, emergency-flatten verbatim.
- **Regulatory flag:** trading user capital programmatically can constitute
  regulated investment management / money transmission depending on
  jurisdiction. This module ships **behind a legal-review gate** and a
  signed user risk disclosure. Architect now, enable per-jurisdiction.

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
> phase ships revenue or retention value independently.

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

**Phase D — Live execution (~20–25 d, gated)**
9. `apps/execution-engine` — Binance/Bybit first, then MT5/cTrader.
   **Blocked on legal review + per-jurisdiction enablement.**

**Phase E — Crypto intelligence (~15 d + data budget)**
10. `apps/chain-indexer` + Crypto Analytics Terminal UI.

**Phase F — Platform polish (continuous)**
11. Backtesting engine, no-code strategy builder, gamification, mobile app,
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

## 8. Immediate Next Slice (recommended)

**Affiliate / Referral system.** The `referrals` table already exists in the
schema with `referrer_id`, `referred_id`, `commission_pct`, `commission_paid`.
It needs only: referral-link generation (`?ref=<uid>`), attribution on signup,
commission accrual on first payment (hook into the existing
`api/admin/payments/[id]/approve` flow), and a `/referrals` dashboard. ~2–3
days, pure additive, immediate revenue lever, zero regulatory exposure.

Say the word and I'll build that slice end-to-end.
