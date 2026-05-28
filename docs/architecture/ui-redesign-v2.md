# AlgoSphereQuant — UI Redesign Spec v2

> **Status**: design contract. Captures the operator's full UI redesign
> brief in actionable form, audits the current platform against it, and
> slices the work into PR-sized chunks each verifiable end-to-end.
> Implementation is multi-slice — this doc is the contract those slices
> reference. **Nothing here is shipped yet** (this doc itself is the only
> shipped artifact).

---

## 1. Vision (verbatim from brief)

A **clean, institutional-grade trading intelligence platform** comparable
to **TradingView × Bloomberg × MT5**:

- Visually minimal, powerful
- Trader-first (not analyst-first)
- Scalable across three tiers (Starter / Pro / VIP)
- Desktop = full trading workstation; mobile = simplified decision tool
- Dark mode default · subtle blue/purple accents · subtle glassmorphism

### Five UX laws (non-negotiable)
1. Chart is the centre of gravity.
2. Intelligence is secondary, not dominant (progressive disclosure).
3. Execution is one-click accessible.
4. Mobile is a decision tool, not a mirror of desktop.
5. VIP = density, *not* clutter.

---

## 2. Current state — honest audit

### What exists today
- **Dashboard layout** (`app/(dashboard)/layout.tsx`) — `DesktopSidebar` (left, accordion nav) + `TopBar` + `<main>` content + `InsightDrawer` (right, contextual rail) + `MobileBottomNav` + `MobileCommandFab`. The **3-pane shell already exists in skeleton form**.
- **Nav registry** — `components/dashboard/nav.ts` exports `NAV_GROUPS` typed by tier (`free|starter|premium|vip`). `visibleNav(tier)` filters per tier. Single source of truth for routing + ⌘K palette + mobile nav.
- **60+ dashboard pages** across Intelligence / Markets / Execution / Portfolio / Research / Community / System groups.
- **Workspace** at `/workspace` (chart workspace, multi-panel — PR #43 family).
- **Markets Explorer** at `/intelligence/markets` (registry-driven dense table — PR #42).
- **Decision Brain card** on `/intelligence` landing (PR #45 / #46 / #47).
- **TradingView chart modal** + symbol registry (PRs #41 / #42).
- **Marketing landing**, `/live`, `/investors`, `/deck` (PRs #52 / #54 / #55) — share-ready public surface.
- **Tier rank** — `TIER_RANK = { free:0, starter:1, premium:2, vip:3 }` and `canAccess(email, tier, required)` already enforced server-side on signals; nav items have `minTier` for declutter.

### What's missing vs the v2 vision
- **Right-rail "Intelligence" panel is generic** (`InsightDrawer` is contextual but not the structured collapsible-card model the brief asks for: Market Regime / Smart Money / Structure / Alerts).
- **No tier-based dashboard *variants***. Today every tier sees the same chrome with items hidden; the brief asks for **Starter = simplified guided mode**, **Pro = modular multi-panel**, **VIP = Bloomberg-style density**. Separate compositions, not just nav filtering.
- **No `<TierLock>` primitive** for blur+lock upsell UI. Today locked items are simply hidden; the brief wants visible "blur + lock icon" pressure.
- **Mobile nav doesn't match the 5-tab spec**. Brief is explicit: Home / Chart / Signals / Intelligence / Account — currently `MobileBottomNav` reads `NAV_GROUPS` and exposes different items.
- **No standardised design tokens** as a module (colors / type / spacing / motion live across `globals.css` + inline Tailwind utilities; brief asks for a clean exported design system).
- **No mobile-specific page compositions** — most pages stack the dashboard layout responsively; brief wants Home / Chart / Signals / Intelligence / Account to each be a purpose-built mobile composition.

---

## 3. Target architecture

### 3.1 Desktop — 3-panel institutional layout

```
┌──────────────┬─────────────────────────────────┬──────────────────────┐
│ LEFT  (220) │ CENTER  (flex)                  │ RIGHT  (340 / 400)   │
│ Navigation  │ Primary workspace               │ Intelligence cards   │
│ + Signals   │ (chart-first, tabbed)           │ (collapsible)        │
│ collapsible │                                 │ collapsible          │
└──────────────┴─────────────────────────────────┴──────────────────────┘
                              TopBar (compact)
```

**Left (220 px, collapsible to 60 px icon-only)** — sectioned nav:
- Market Feed · Active Signals · Watchlist · Portfolio · Copy Trading · Strategy Hub
- Tier badges on locked items (don't hide; show with `<TierLock variant="nav">`)

**Center** — tabbed primary workspace (per brief):
- Chart Workspace (default) · Execution Desk · Trade Journal · Shadow Mode
- TradingView behaviour: full chart control, signal/position overlays, drawing tools (Pro+ gated)
- Single primary action per workspace (the brief's "1 primary action / screen" law)

**Right (340 px on lg, 400 px on xl, collapsible)** — Intelligence layer as **collapsible cards** grouped by domain:
- Market Intelligence: Market Regime · Market Pulse · Volatility · Market Stress
- Smart Money: Whale Flows · Exchange Flows · Positioning
- Structure: Correlations · Market Breadth · Sector Rotation
- Alerts: Smart Alerts · Narrative Shifts

Default: **only the top card per group expanded**. Progressive disclosure.

### 3.2 Mobile — 5-tab bottom nav (not a desktop mirror)

Tabs (left → right): **Home · Chart · Signals · Intelligence · Account**.

| Tab | Purpose | Key elements |
|---|---|---|
| **Home** | At-a-glance decision deck | Net PnL · active-signals count · market bias pill · risk warnings · CTA to Chart |
| **Chart** | Full-bleed price | Full-screen TradingView · swipe-to-switch-symbol · signal overlays · quick-trade FAB (Pro+) |
| **Signals** | Active signals only | Card per signal: pair · direction · entry/stop/target · confidence · status. No archive noise. |
| **Intelligence** | Collapsible cards | Market Regime · Smart Money · Volatility · Liquidity · Narrative — first card auto-expanded |
| **Account** | Portfolio + ops | Portfolio · performance · brokers · subscription tier · settings · logout |

**Mobile gestures**: swipe between Chart symbols; pull-to-refresh on Signals + Intelligence; long-press signal card → quick-trade sheet (Pro+).

### 3.3 Tier-based UI variants

The brief is emphatic: tiers are **different UI compositions**, not just hidden items.

| Tier | Dashboard mode | Behaviour |
|---|---|---|
| **Starter** | *Guided* — single column, large CTAs, low cognitive load, partial intelligence, locked modules visibly blurred with lock icon | "Easy trading mode" |
| **Pro** | *Workstation* — 3-panel layout, customisable, real-time signals, advanced chart, multi-tab navigation | Professional terminal |
| **VIP** | *Terminal* — multi-panel dense layout, all intelligence visible, API surface, advanced analytics, ultra-low-latency feeds | Bloomberg-style density |

The same routes serve all tiers; **layout selection** happens in the dashboard layout root based on effective tier (admin/beta/demo already resolved by `(dashboard)/layout.tsx`).

---

## 4. Design system

### 4.1 Tokens (target — values to seed; current `globals.css` is close)

```ts
// lib/design/tokens.ts (new)
export const colors = {
  bg:        { base: '#050507', surface: '#0a0a12', elevated: '#11111a' },
  border:    { subtle: 'rgba(255,255,255,0.06)', strong: 'rgba(255,255,255,0.12)' },
  fg:        { primary: '#f5f5f7', muted: '#a1a1aa', subtle: '#71717a' },
  accent: {                                  // subtle blue/purple per brief
    primary:  '#f5b14c',                     // existing brand amber (kept)
    info:     '#7c8fff',                     // blue
    deep:     '#9b7cff',                     // purple
  },
  state: { up: '#10b981', down: '#f43f5e', warn: '#f59e0b', neutral: '#71717a' },
}
export const radius  = { sm:'6px', md:'10px', lg:'14px', xl:'20px', full:'9999px' }
export const space   = { 1:'4px', 2:'8px', 3:'12px', 4:'16px', 5:'20px', 6:'24px', 8:'32px', 10:'40px', 12:'48px', 16:'64px' }
export const typo    = { display:'-0.02em / 800 / 56px', h1:'-0.015em / 700 / 40px', h2:'700 / 28px', h3:'600 / 20px', body:'500 / 14px', meta:'500 / 11px' }
export const motion  = { fast:'120ms cubic-bezier(0.2,0.8,0.2,1)', base:'200ms cubic-bezier(0.2,0.8,0.2,1)', slow:'320ms cubic-bezier(0.2,0.8,0.2,1)' }
```

### 4.2 Component inventory (target)

**Primitives** (new, in `components/ui/`):
- `Surface` (card wrapper with elevation variants)
- `Panel` (collapsible right-rail card)
- `TierLock` (blur + lock overlay for sub-tier features)
- `Pill`, `Badge`, `KBD`, `Toolbar`
- `Sheet` (mobile bottom-sheet)
- `TabBar` (mobile bottom nav primitive)

**Composites** (refactor existing):
- `DashboardShell` (replaces current layout — composes Left/Center/Right + Mobile)
- `IntelligenceRail` (right rail, replaces ad-hoc `InsightDrawer` with structured grouped cards)
- `MobileTabBar` (replaces `MobileBottomNav` with 5-tab spec)
- `WorkspaceTabs` (center-pane tabbing for Chart / Execution / Journal / Shadow)

---

## 5. Component hierarchy

```
RootLayout
└── DashboardShell                    // tier-aware variant selection
    ├── Desktop (md+)
    │   ├── DesktopSidebar (Left)     // collapsible 220 ↔ 60
    │   ├── DashboardMain (Center)
    │   │   ├── TopBar
    │   │   └── WorkspaceTabs         // Chart | Execution | Journal | Shadow
    │   │       └── {children}        // route content
    │   └── IntelligenceRail (Right)  // collapsible 340/400
    │       └── PanelGroup × 4        // Market / Smart Money / Structure / Alerts
    │           └── Panel × N (collapsible cards)
    │
    └── Mobile (<md)
        ├── MobileTopBar (minimal)
        ├── {tab content}             // Home | Chart | Signals | Intelligence | Account
        └── MobileTabBar (bottom, 5 tabs)
```

---

## 6. Subscription-tier gating model

### `<TierLock>` primitive

```tsx
<TierLock minTier="premium" variant="card | nav | inline">
  <PremiumOnlyContent />
</TierLock>
```

- `variant="card"` — wraps the children, blurs them, overlays a centred lock icon + "Premium tier" pill + "Upgrade" CTA. The brief's blur+lock pattern.
- `variant="nav"` — renders the nav item dimmed with a small lock badge, click → `/upgrade?from=<route>`.
- `variant="inline"` — replaces an inline value (e.g. an entry level) with a small "members" pill + CTA.

Tier resolution: reuses `canAccess()` from `lib/admin.ts` server-side, and a small `useEffectiveTier()` hook client-side that reads the cached profile.

### Where to apply (initial pass — informs implementation slice)
- Workspace (`/workspace`) — Pro+ for multi-chart, VIP for unlimited tabs
- Execution Desk (`/execution`) — VIP
- API Access page (`/api-keys`) — VIP
- Shadow Mode (`/shadow`) — Premium+
- Quant Builder (`/quant-builder`) — Premium+
- Premium Groups, Token Launchpad — already nav-gated; switch to visible `TierLock`

---

## 7. Implementation roadmap (PR-sized slices)

Each row = one PR; each PR ships + is verifiable end-to-end in one turn.

| # | Slice | Lines (est.) | Verifies |
|---|---|---|---|
| 1 | **Design tokens module** — `lib/design/tokens.ts` + a public `/design-system` page rendering swatches & type | ~300 | Tokens compile; `/design-system` 200 |
| 2 | **`<TierLock>` primitive** + apply to 5 highest-value gates (Workspace/Execution/API/Shadow/QuantBuilder) | ~450 | Free user sees blur+lock; Premium user sees content |
| 3 | **`<Panel>` + `IntelligenceRail`** — replace `InsightDrawer` with structured 4-group collapsible cards | ~500 | Right rail renders; cards collapse; matches design spec |
| 4 | **MobileTabBar 5-tab redesign** — replaces `MobileBottomNav`, routes to new `/m/home /m/chart /m/signals /m/intelligence /m/account` shells | ~400 | Mobile viewport shows 5-tab bar; each tab routes |
| 5 | **Mobile `/m/home`** — Net PnL · signals count · market bias · risk warnings | ~350 | Renders with live data; no fakes |
| 6 | **Mobile `/m/chart`** — full-bleed TV chart, swipe-to-switch-symbol, signal overlays | ~400 | Chart fills viewport; swipe gesture switches symbol |
| 7 | **Mobile `/m/signals`** — active signals stream, long-press → quick action sheet | ~300 | Live signals render; sheet opens |
| 8 | **Mobile `/m/intelligence`** — collapsible cards: Regime · SM · Volatility · Liquidity · Narrative | ~400 | Cards render with live data |
| 9 | **Mobile `/m/account`** — portfolio · performance · brokers · tier · settings | ~350 | All sections present |
| 10 | **Tier-based DashboardShell variants** — Starter guided / Pro workstation / VIP terminal compositions | ~600 | Switching tier in admin demo flips variant |
| 11 | **WorkspaceTabs center-pane** — Chart / Execution / Journal / Shadow tabbed inside main | ~350 | All 4 tabs reachable; state persists |
| 12 | **Motion polish + microinteractions** — page transitions, card expand/collapse, tab switching (Framer Motion or CSS-only) | ~300 | Reduced-motion respected; no jank |

**Total**: ~5,000 lines across 12 PRs ≈ 12 turns of focused work, each verifiable end-to-end.

---

## 8. What I recommend shipping first

**Slice #2 — `<TierLock>` primitive + apply to 5 gates.** Why first:

- **Direct revenue impact.** Visible upgrade pressure across the dashboard → drives Starter → Premium conversion. The platform exists; it doesn't visibly *sell* the upgrade yet.
- **Compounds.** Every subsequent slice (mobile, rail, tokens) can apply `TierLock` immediately. It's the foundation primitive the brief's "subscription-based UI states" rest on.
- **Small + verifiable.** One reusable component + 5 wrap-applications. Live-testable: log in as Free vs Premium; see the difference.
- **No design assets needed.** Pure code.

Alternative high-value first slices:
- **#1 Design tokens** — unblocks every later slice; lowest leverage today.
- **#4 MobileTabBar** — biggest user-visible change for the launch funnel (most discovery clicks land on mobile). High impact, larger scope.
- **#3 Intelligence Rail** — visible "institutional terminal" upgrade on desktop. Mid-leverage.

---

## 9. Honesty contract for this redesign

Same non-negotiables as the rest of the platform:
- **No fabricated data.** Every panel / card / metric is real or labelled `—`/`Awaiting`.
- **No fake "shipped" claims.** Each slice ships + verifies + PRs separately.
- **No degraded safety for UX.** `TierLock` is a *visual* gate; the authoritative tier check stays server-side (RLS + `canAccess`).
- **No silent regressions.** Each slice keeps the existing `(dashboard)/layout.tsx` working until its replacement is fully wired.

---

## 10. Out of scope for this redesign

- Brand identity changes (logo, name, colour palette overhaul) — handled by a designer, not me.
- Marketing-site redesign — separate program from product UI.
- Backend / engine changes — completely independent track.
- Auth / payment flow redesign — separate compliance-sensitive program.

---

## References

- `apps/web/src/app/(dashboard)/layout.tsx` — current shell
- `apps/web/src/components/dashboard/nav.ts` — nav registry
- `apps/web/src/components/dashboard/DesktopSidebar.tsx` — left rail
- `apps/web/src/components/dashboard/InsightDrawer.tsx` — current right rail
- `apps/web/src/components/dashboard/MobileBottomNav.tsx` — current mobile nav
- `apps/web/src/lib/admin.ts` — `canAccess()` tier gate (authoritative)
- `apps/web/src/app/globals.css` — current tokens
