# AI Trading Hub — Claude Code Configuration

> This file is read automatically by Claude Code at the start of every session.
> It gives Claude persistent memory of your project's architecture, standards, and build plan.
> Update it as the project evolves.

---

## Project Overview

**AI Trading Hub** is a SaaS platform for retail traders. It provides signal alerts,
risk dashboards, trade analytics, a journal system, and Telegram/WhatsApp automation —
sold via a subscription model ($29/month starter, $99/month premium).

**Business goal:** Reach $5,000 MRR within 6 months, $25,000 MRR within 12 months.
**Current phase:** Phase 1 — Build the core (MVP).

---

## Tech Stack

| Layer         | Technology                                      |
|---------------|-------------------------------------------------|
| Frontend      | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Auth          | Supabase Auth (email + OAuth)                   |
| Database      | Supabase (PostgreSQL)                           |
| ORM           | Prisma (optional) or Supabase client directly   |
| Subscriptions | Stripe (primary), PayPal (secondary)            |
| Crypto pay    | NOWPayments or CoinPayments API                 |
| Local pay     | Flutterwave (M-Pesa, bank transfer for Africa)  |
| Telegram bot  | python-telegram-bot (Python 3.11+) or grammY (Node) |
| WhatsApp bot  | Twilio WhatsApp API or Meta Cloud API           |
| Hosting       | Vercel (frontend), Railway or Render (bot/API)  |
| Email         | Resend or SendGrid                              |
| Analytics     | PostHog (self-hosted or cloud)                  |
| Monorepo      | Turborepo (apps/ + packages/)                   |

---

## Project Structure

```
ai-trading-hub/
├── CLAUDE.md                    ← You are here
├── apps/
│   ├── web/                     ← Next.js frontend (dashboard + landing page)
│   │   ├── app/
│   │   │   ├── (marketing)/     ← Landing page, pricing, about
│   │   │   ├── (auth)/          ← Login, signup, forgot password
│   │   │   ├── (dashboard)/     ← Protected app routes
│   │   │   │   ├── overview/    ← Main trading dashboard
│   │   │   │   ├── signals/     ← Signal alerts feed
│   │   │   │   ├── risk/        ← Risk management dashboard
│   │   │   │   ├── analytics/   ← Trade analytics
│   │   │   │   ├── journal/     ← Trade journal
│   │   │   │   ├── settings/    ← Account, billing, notifications
│   │   │   │   └── upgrade/     ← Upsell page
│   │   │   └── api/             ← Next.js API routes
│   │   │       ├── webhooks/
│   │   │       │   ├── stripe/  ← Stripe webhook handler
│   │   │       │   └── flutterwave/
│   │   │       ├── signals/     ← Signal CRUD endpoints
│   │   │       └── journal/     ← Journal CRUD endpoints
│   │   ├── components/
│   │   │   ├── ui/              ← shadcn/ui base components
│   │   │   ├── dashboard/       ← Dashboard-specific components
│   │   │   ├── charts/          ← TradingView widget wrappers, Recharts
│   │   │   └── marketing/       ← Landing page sections
│   │   └── lib/
│   │       ├── supabase/        ← Supabase client (server + client)
│   │       ├── stripe/          ← Stripe helpers and plans config
│   │       ├── payments/        ← Payment provider abstractions
│   │       └── hooks/           ← Custom React hooks
│   │
│   └── telegram-bot/            ← Python Telegram bot service
│       ├── bot.py               ← Entry point
│       ├── handlers/
│       │   ├── signals.py       ← /signal command handler
│       │   ├── subscription.py  ← /subscribe, /status handlers
│       │   └── admin.py         ← Admin broadcast commands
│       ├── services/
│       │   ├── signal_service.py
│       │   └── subscription_service.py
│       ├── database.py          ← Supabase Python client
│       └── requirements.txt
│
├── packages/
│   ├── types/                   ← Shared TypeScript types
│   ├── config/                  ← Shared ESLint, Tailwind, TS configs
│   └── ui/                      ← Shared component library (if needed)
│
├── supabase/
│   ├── migrations/              ← SQL migration files
│   └── seed.sql                 ← Dev seed data
│
├── docs/
│   ├── architecture.md
│   ├── api.md
│   └── deployment.md
│
├── turbo.json
├── package.json                 ← Root workspace
└── .env.example                 ← All required env vars documented here
```

---

## Database Schema (Supabase / PostgreSQL)

### Core tables — build these first

```sql
-- Users (extends Supabase auth.users)
profiles (
  id uuid references auth.users primary key,
  full_name text,
  telegram_chat_id bigint unique,
  whatsapp_number text,
  subscription_tier text default 'free',  -- 'free' | 'starter' | 'premium'
  subscription_status text,               -- 'trialing' | 'active' | 'canceled' | 'past_due'
  stripe_customer_id text unique,
  created_at timestamptz default now()
)

-- Subscriptions
subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  stripe_subscription_id text unique,
  plan text,                              -- 'starter' | 'premium'
  status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now()
)

-- Trading signals
signals (
  id uuid primary key default gen_random_uuid(),
  pair text not null,                     -- e.g. 'XAUUSD', 'EURUSD'
  direction text not null,                -- 'buy' | 'sell'
  entry_price numeric,
  stop_loss numeric,
  take_profit_1 numeric,
  take_profit_2 numeric,
  take_profit_3 numeric,
  risk_reward numeric,
  status text default 'active',           -- 'active' | 'closed' | 'cancelled'
  result text,                            -- 'win' | 'loss' | 'breakeven'
  pips_gained numeric,
  tier_required text default 'starter',   -- minimum tier to see this signal
  published_at timestamptz default now(),
  created_by uuid references profiles(id)
)

-- Trade journal entries
journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  pair text,
  direction text,
  entry_price numeric,
  exit_price numeric,
  lot_size numeric,
  pips numeric,
  pnl numeric,
  risk_amount numeric,
  setup_tag text,                         -- e.g. 'breakout', 'trend', 'reversal'
  notes text,
  screenshot_url text,
  trade_date date,
  created_at timestamptz default now()
)

-- Affiliate / referrals
referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid references profiles(id),
  referred_id uuid references profiles(id),
  commission_pct numeric default 20,
  commission_paid boolean default false,
  created_at timestamptz default now()
)
```

---

## Stripe Plans Configuration

```typescript
// lib/stripe/plans.ts
export const PLANS = {
  free: {
    id: 'free',
    name: 'Free Trial',
    price: 0,
    features: ['3 signals/week', 'Dashboard preview', 'Telegram community'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 29,
    stripePriceId: process.env.STRIPE_STARTER_PRICE_ID!,
    features: ['Daily signals', 'Risk dashboard', 'Trade journal', 'Telegram bot'],
  },
  premium: {
    id: 'premium',
    name: 'Pro',
    price: 99,
    stripePriceId: process.env.STRIPE_PREMIUM_PRICE_ID!,
    features: ['Everything in Starter', 'Full analytics', 'WhatsApp automation',
               'Copy-trading', 'API access', 'Priority support'],
  },
}
```

---

## Environment Variables

All env vars must be documented in `.env.example`. Never commit real secrets.

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_STARTER_PRICE_ID=
STRIPE_PREMIUM_PRICE_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Telegram bot
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_CHAT_ID=

# Flutterwave (M-Pesa / Africa payments)
FLUTTERWAVE_PUBLIC_KEY=
FLUTTERWAVE_SECRET_KEY=
FLUTTERWAVE_WEBHOOK_HASH=

# PayPal
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=

# NOWPayments (crypto)
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=

# Email
RESEND_API_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_SECRET=
```

---

## Common Commands

```bash
# Development
npm run dev              # Start all apps (Turborepo)
npm run dev --filter=web # Start only the Next.js frontend
cd apps/telegram-bot && python bot.py  # Start the Telegram bot

# Database
npx supabase start       # Start local Supabase (Docker required)
npx supabase db push     # Push migrations to remote
npx supabase db reset    # Reset local DB and re-seed

# Testing
npm run test             # Run all tests
npm run test --filter=web

# Build & deploy
npm run build
vercel deploy            # Deploy frontend
railway up               # Deploy Telegram bot to Railway

# Stripe (local webhook testing)
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

---

## Coding Standards

### TypeScript
- Strict mode enabled. No `any` types — use `unknown` and narrow properly.
- All API route handlers must define request/response types.
- Use `zod` for all runtime validation (form inputs, webhook payloads, API bodies).

### React / Next.js
- App Router only. No Pages Router.
- Server Components by default. Use `"use client"` only when necessary (interactivity, hooks).
- Keep components small and focused. Max ~150 lines per component file.
- Co-locate component-specific logic in the same folder.
- All data fetching in Server Components or Route Handlers — not client-side fetch in `useEffect`.

### Styling
- Tailwind CSS only. No inline styles, no separate CSS files unless for third-party overrides.
- Use `cn()` utility (clsx + tailwind-merge) for conditional class composition.
- Responsive-first: mobile styles first, then `md:` and `lg:` breakpoints.
- Follow shadcn/ui patterns for all base UI components.

### Security rules — always follow these
- Every API route must check `supabase.auth.getUser()` before touching data.
- Row Level Security (RLS) must be enabled on all Supabase tables.
- Stripe webhook endpoints must verify the `stripe-signature` header.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.
- Subscription gating: always check `profiles.subscription_tier` server-side, not client-side.

### Naming conventions
- Files: `kebab-case.ts` for utilities, `PascalCase.tsx` for components.
- Database columns: `snake_case`.
- TypeScript types/interfaces: `PascalCase`.
- Env vars: `SCREAMING_SNAKE_CASE`.

---

## Phase Build Plan

Use this as your task tracker. Work through phases in order.

### Phase 1 — MVP (Month 1–2) 🔴 CURRENT PHASE

**Goal: Get first 10 paying subscribers.**

- [x] Repo setup: Turborepo monorepo, Next.js app, Supabase project
- [x] Auth: Supabase email auth + Google OAuth (login, signup, forgot-password, OAuth callback)
- [x] Database: Create all core tables with RLS policies (migrations + seed)
- [x] Landing page: hero, features, pricing, FAQ, lead capture form
- [x] Stripe: subscription checkout, webhook handler, billing portal
- [x] Dashboard shell: sidebar nav, mobile responsive, subscription gate
- [x] Signals page: list view of active signals (gated by tier)
- [x] Telegram bot MVP: `/start`, `/signals`, `/subscribe`, `/status` commands
- [x] Free trial flow: 7-day auto-expiry via Stripe trial period
- [ ] Deploy: Vercel (web) + Railway (bot)
- [ ] Payment: M-Pesa via Flutterwave

### Phase 2 — Product (Month 3–5) 🟡 UPCOMING

**Goal: Reach 100 paying subscribers ($3k–$5k MRR).**

- [ ] Risk management dashboard: position sizing calculator, daily loss tracker
- [ ] Trade journal: full CRUD, tagging, screenshot uploads (Supabase Storage)
- [ ] Basic analytics: win rate, avg R:R, best pairs, P&L chart (Recharts)
- [ ] Telegram bot: subscription status check, tier-based signal delivery
- [ ] Affiliate/referral system: unique referral links, commission tracking
- [ ] PayPal integration
- [ ] Crypto payments (NOWPayments)
- [ ] Email sequences (Resend): onboarding drip, trial expiry, renewal

### Phase 3 — Scale (Month 6–9) 🟢 FUTURE

**Goal: 300+ subscribers, broker partnerships, $10k+ MRR.**

- [ ] Full analytics suite: drawdown curves, trade calendar heatmap, setup tags analysis
- [ ] WhatsApp automation (Twilio): broadcast signals, renewal reminders
- [ ] Dealer/broker dashboard: manage multiple trader accounts
- [ ] Copy-trading integration (MT4/MT5 bridge)
- [ ] Premium community access gating (Telegram group bot)
- [ ] Prop firm partnership dashboard

### Phase 4 — Automate & License (Month 10+) 🔵 FUTURE

**Goal: White-label revenue, $25k+ MRR.**

- [ ] Public REST API with API key auth (for $99 tier)
- [ ] White-label system: custom branding config per licensee
- [ ] Multi-tenant architecture: separate Supabase schemas or row-level isolation
- [ ] Admin super-dashboard: manage all licensees, revenue, health
- [ ] Enterprise billing: custom pricing, invoicing, SLA contracts

---

## Key Architectural Decisions

1. **Supabase over custom auth** — RLS handles data isolation cleanly. Fast to set up.
   Do not replace with NextAuth or a custom JWT system without a strong reason.

2. **Signal delivery is one-directional** — Signals are created by admins only.
   Regular users only read signals. Enforce this with RLS (`created_by` column + admin role check).

3. **Subscription gating is server-side only** — The subscription tier check must happen
   in Server Components or API routes. Never rely on client-side state for gating.

4. **Telegram bot is a separate service** — It runs as a long-polling Python process, not
   a Next.js API route. It shares the Supabase database. Do not merge them.

5. **Payment abstraction layer** — All payment providers (Stripe, PayPal, Flutterwave, crypto)
   should go through a unified `lib/payments/` abstraction. This prevents vendor lock-in
   and simplifies the subscription status logic.

---

## Claude Code Prompts — Quick Reference

Copy-paste these into Claude Code to build each feature fast:

```
# Scaffold the entire project
"Set up the Turborepo monorepo with a Next.js 14 app at apps/web and a Python
Telegram bot at apps/telegram-bot. Include all config files, .env.example,
and the directory structure defined in CLAUDE.md."

# Database
"Create Supabase SQL migrations for all tables in the Database Schema section
of CLAUDE.md. Include RLS policies: users can only read/write their own rows.
Admins (role = 'admin') can read all rows. Signals are readable by all
authenticated users whose subscription_tier matches the signal's tier_required."

# Auth + subscription gate
"Build the Supabase auth flow (email + Google OAuth) and a middleware that
protects all /dashboard routes. Redirect unauthenticated users to /login.
Redirect users with expired trials to /upgrade."

# Landing page
"Build the landing page at app/(marketing)/page.tsx. Include: hero with headline
and CTA, features grid (6 products from CLAUDE.md), pricing cards (3 tiers from
PLANS config), social proof section, FAQ accordion, and email lead capture form
that saves to Supabase. Use Tailwind. Make it mobile responsive."

# Stripe subscriptions
"Implement the full Stripe subscription flow: checkout session creation API route,
Stripe webhook handler at /api/webhooks/stripe that handles checkout.session.completed,
customer.subscription.updated, and customer.subscription.deleted. Update
profiles.subscription_tier and subscriptions table on each event."

# Signals dashboard
"Build the signals page at app/(dashboard)/signals/page.tsx. Fetch signals from
Supabase server-side. Show a card for each signal with pair, direction badge
(buy=green, sell=red), entry, SL, TP levels, and R:R ratio. Lock signals that
require a higher tier than the user's current tier — show an upgrade prompt."

# Trade journal
"Build the trade journal at app/(dashboard)/journal. Include: a table of past
entries, an 'Add trade' modal form (all fields from journal_entries table),
screenshot upload to Supabase Storage, and a summary bar showing total P&L,
win rate, and trade count for the last 30 days."

# Telegram bot
"Build the Python Telegram bot in apps/telegram-bot/. Use python-telegram-bot v20.
Implement: /start (welcome + subscribe link), /signals (show last 5 active signals
if user is subscribed), /status (show subscription tier and expiry), /subscribe
(send Stripe checkout link). Verify subscription by looking up telegram_chat_id
in Supabase profiles table."

# Flutterwave M-Pesa
"Add Flutterwave as a payment option. Create a checkout flow for M-Pesa/mobile
money at app/(dashboard)/upgrade/mpesa. Use Flutterwave's Node SDK. On payment
success webhook (/api/webhooks/flutterwave), activate the user's subscription
in Supabase (same logic as Stripe webhook). Use PLANS config for amounts."

# Affiliate system
"Build an affiliate referral system. Each user gets a unique referral link
(?ref=USER_ID). On signup via referral link, create a row in the referrals table.
When the referred user's first payment succeeds, mark commission as earned.
Add a /dashboard/referrals page showing clicks, conversions, and pending earnings."
```

---

## Asking Claude Code for Help

When starting a session, Claude Code will read this file automatically.
You can then give direct commands like:

- `"Build the signals page"` — Claude knows the stack, schema, and file locations
- `"Add M-Pesa payment"` — Claude knows to use Flutterwave and where the webhook handler lives
- `"What's left in Phase 1?"` — Claude reads the checklist above
- `"Write a migration for the referrals table"` — Claude knows the schema patterns

Update the phase checklist above as you complete tasks so Claude always knows
what has been built and what's next.

---

## Do Not

- Do not use Pages Router. App Router only.
- Do not fetch data client-side in `useEffect` when a Server Component would work.
- Do not hardcode Stripe price IDs, bot tokens, or API keys. Always use env vars.
- Do not mix payment provider logic inline in components — use `lib/payments/`.
- Do not write migrations by hand — always generate via `supabase db diff` or write
  clean SQL in `supabase/migrations/` with a timestamp prefix.
- Do not delete or alter the `profiles` table RLS policies without thorough review.
- Do not expose the Supabase service role key to the browser under any circumstances.
