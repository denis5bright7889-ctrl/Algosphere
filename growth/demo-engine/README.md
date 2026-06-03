# AlgoSphere Product Demo Engine — Phase 1

Programmatic capture of the live product → screenshots, screen recordings, and
auto-narrated demo videos. Built on Playwright + Chromium, piped into the same
Remotion stack as `marketing/videos/`.

## What this delivers in Phase 1

| Surface | Script | Output |
|---|---|---|
| Screenshots | `screenshots.mjs` | `apps/web/public/growth/screenshots/<viewport>/<route>.png` |
| Screen recordings | `record.mjs` | `growth/demo-engine/recordings/<flow>/recording.webm` + `steps.json` |
| Auto-narrated demo videos | `generate_demo.mjs <flow>` | `growth/demo-engine/out/<flow>/vertical.mp4` |

Not in Phase 1 (per the founder's roadmap): Founder Studio, Release Engine,
Weekly Reports, Case Studies, Attribution. Those build on the same Playwright
+ Remotion + edge-tts pipeline this phase establishes — extending into the
later phases is mechanical, not architectural.

## Setup (one-time)

```bash
cd growth/demo-engine
npm install
npx playwright install chromium
```

## Configure

```bash
# Where to point Playwright. Defaults to localhost:3000.
export DEMO_BASE_URL=https://algospherequant.com

# Required for protected routes (everything past /login).
# If unset, only public marketing pages are captured.
export DEMO_AUTH_EMAIL=...
export DEMO_AUTH_PASSWORD=...
```

Use a **dedicated demo account**, not your real trader account. The screenshot
script captures your live data — broker balances, journal entries, positions,
analytics. If you want pristine product shots, seed a demo account with
representative data first.

## Phase 1 capabilities

### Screenshot engine (`npm run screenshots`)

- 22 protected routes (Dashboard, AI Coach, Psychology, Performance, Risk,
  Alerts, Brokers, Journal, Intelligence + 4 V3 hubs + Correlations, Signals,
  Quant Builder, Backtester, Auto Trading, Watchlists, Community, Billing,
  Settings) — all the surfaces a user encounters.
- 7 public routes (Landing, Pricing, Terms, Privacy, Data Deletion, Login,
  Signup) — captured without login.
- 3 viewports (1440×900 desktop, 768×1024 tablet, 390×844 mobile).
- Full-page captures (entire scroll height, not just the fold).
- Saves under `apps/web/public/growth/screenshots/` so they're URL-addressable
  on the live site for blog posts, landing pages, and the future Founder
  Studio attribution panel.

### Screen recording engine (`npm run record`)

Pre-configured flows in `config.mjs:RECORDED_FLOWS`:

| Flow ID | What it shows |
|---|---|
| `broker-connect` | `/brokers` → Add → MT5 → server + login form |
| `place-trade` | `/signals` → Place trade modal → broker route + size |
| `intelligence-tour` | `/intelligence` → scroll → `/intelligence/correlations` |
| `journal-tour` | `/journal` → scroll → entry list |

Each flow saves a WebM at 540×960 (matches vertical short ratio) plus a
`steps.json` manifest with per-step timings — used by the demo generator to
sync voiceover cues to on-screen events.

Add a new flow by appending to `RECORDED_FLOWS` in `config.mjs`. Supported
actions: `navigate`, `click`, `fill`, `hover`, `scroll`, `wait`, `press`.

### Demo video generator (`npm run generate -- <flow-id>`)

1. Loads `recordings/<flow>/steps.json`.
2. Builds a narration script from `NARRATIONS[flowId]` in `generate_demo.mjs`.
3. Runs `marketing/videos/generate_voice.py` to produce edge-tts MP3s.
4. Copies the WebM recording into the Remotion `public/` tree.
5. Invokes Remotion to composite recording + voiceover + branded chrome.
6. Outputs `out/<flow>/vertical.mp4`.

Landscape (1920×1080) and square (1080×1080) variants follow the same
pattern — add the compositions to `marketing/videos/src/Root.tsx`.

## End-to-end run

```bash
cd growth/demo-engine

# 1. Screenshots — all routes × 3 viewports
DEMO_BASE_URL=http://localhost:3000 \
DEMO_AUTH_EMAIL=demo@you.com \
DEMO_AUTH_PASSWORD=*** \
  npm run screenshots

# 2. Recordings — drive Playwright through the configured flows
npm run record

# 3. Generate one demo video per flow
npm run generate -- broker-connect
npm run generate -- place-trade
npm run generate -- intelligence-tour
npm run generate -- journal-tour
```

## Roadmap to the rest of the founder spec

Phase 1 (this commit) establishes the pipeline. The remaining capabilities the
founder requested all build on it:

| Capability | Build on |
|---|---|
| **Founder Studio** (git commits → blog/threads) | New CLI consuming `git log` + LLM (Claude API) for narrative generation, output to `growth/founder-studio/<date>.md` |
| **Release Engine** (auto announce on feature ship) | GitHub Action triggers `record.mjs` + `generate_demo.mjs` on tagged release, posts to Discord/Telegram via webhook |
| **Case Study Engine** | Query Supabase for users with improved win-rate / PF / drawdown; produce capture pack via this engine; require consent gate |
| **Weekly Intelligence Report** | Cron-fed `/api/v1/diagnostics/full` + market data → markdown report + screenshots, distribute to Discord/Telegram/email |
| **Attribution** | New Supabase tables for `content_assets` + `attribution_events`; UTM-tagged URLs in the post copy generated here |
| **Content Command Center** | Next.js admin route at `/admin/growth` that browses everything this engine produces and tracks the attribution funnel |
