# AlgoSphere Quant — what's actually left

> Last updated: 2026-05-16 after the multi-broker + Tauri ship.

## ✅ Just landed in this commit (`02ef098`)

| Surface | Status |
|---|---|
| Bybit USDT-perp adapter (pybit v5 unified) | Code shipped, lazy-imported |
| OKX swap adapter (python-okx, 3-cred passphrase) | Code shipped, lazy-imported |
| MT5 adapter (MetaTrader5 lib, thread-pooled with module lock) | Code shipped, requires Windows host |
| Python AES-256-GCM vault (byte-for-byte match with Node `lib/vault.ts`) | Shipped |
| Per-user adapter factory — reads `broker_connections`, decrypts via vault | Shipped |
| `/api/v1/execute` multi-broker router with env-singleton fallback | Shipped |
| `/api/v1/execute/invalidate` for credential-rotation cache flush | Shipped |
| Copy-relay forwards the follower's default broker to the engine | Shipped |
| Tauri 2 desktop wrapper scaffold (system tray, hide-to-tray, native push) | Shipped — needs `cargo tauri icon …` + a Rust toolchain to bundle |
| Production deploy + smoke test 13/13 green | Done |

## ✅ Closed in commit `6592549` (2026-05-16)

| # | Gap | How |
|---|---|---|
| 1 | Tauri auto-update route | `GET /api/desktop/update/[target]/[version]` serves Tauri v2 JSON from a static `public/releases/desktop.json`; 204 when absent/current. Verified live (204). |
| 2 | OKX passphrase UI | `/brokers` form now broker-aware; OKX shows the passphrase field, API validates it. |
| 3 | MT5 connection UI | Reconciled to the **$0 direct MetaTrader5** path — form collects login/password/server (mapped to api_key/api_secret/passphrase the factory expects). Dropped the paid MetaApi token requirement. |
| 5 | Per-user broker health probe | `worker/broker_health.py`, scheduled every 10 min — builds each adapter, `refresh_state()`, writes status/equity/error back to `broker_connections`. |
| 6 | Drift-monitor for engine closes | `lifecycle_monitor` now calls `/api/internal/settle-signal` (idempotent, X-Engine-Key auth) on every terminal auto-transition → settles copies + closes shadow rows + computes drift. Previously only admin closes did. |
| 7 | Live-mode flip safety gate | migration 22 `broker_execution_readiness()` RPC + `POST /api/brokers/[id]/promote-live` (only path that can set `is_testnet=false`, no override) + live gauge on each `/brokers` card. |

## ⏳ Code-side gaps you can still ship in chat (1–3 hours each)

| # | Gap | Why it matters | What it takes |
|---|---|---|---|
| 4 | **cTrader OAuth adapter** | We declared `'ctrader'` in the table check constraint but there's no Python adapter. cTrader uses OAuth refresh tokens (in `access_token_enc`), different shape from API-key brokers. | Implement `cTraderAdapter` + add to factory. ~2 hrs once you have a developer app at connect.spotware.com. |
| 8 | **Rate-limit per broker connection** in the execute router | Right now a runaway full_auto loop could DOS your Binance/Bybit API key. | Token bucket keyed on `(user_id, broker)`. |
| 9 | **Bot-side `/brokers` deep-link** from Telegram | Reduces friction for users connecting their first account. | A keyboard button in `subscription.py` that opens the web `/brokers` URL with a session-token query param. |
| 10 | **`apps/web/api/desktop/checksums`** for download-page integrity | When you ship the Tauri binaries, the download page should publish SHA-256s. | Static route reading from R2/S3 or just `public/releases/`. |

## 🛑 Cannot be done from chat — need you or external partners

| Item | What you need to do | Time |
|---|---|---|
| **Bybit / OKX testnet API keys** | Apply at testnet.bybit.com + okx.com/account/my-api → enable derivatives → restrict to your VPS IP, withdrawal disabled | 30 min each |
| **MT5 host VPS** | Oracle Free Tier *Always-Free* Windows VM (or any Windows VPS). Install MT5 terminal, log into broker demo. The signal-engine must also run on the same host (or a buddy host reachable from the MT5 box). | 1–2 hrs incl. firewall rules |
| **cTrader Open API approval** | Apply at connect.spotware.com — 5 business days review | 5 business days (calendar) |
| **Tauri code-signing certs** | Apple Developer ID ($99/yr) for macOS notarization; an EV cert from DigiCert/Sectigo (~$300/yr) to avoid SmartScreen on Windows | $400/yr + 1–2 weeks for EV verification |
| **Tauri icon generation** | One 1024×1024 PNG of the AlgoSphere mark, then `cargo tauri icon path/to/source.png` | 10 min |
| **Real smart-contract token launch** | Audit firm engagement ($15k–$50k: Trail of Bits / ConsenSys Diligence / Zellic). Fireblocks for signing infra. | 4–8 weeks + capital |
| **Native iOS / Android binaries** | Either expand the Tauri scaffold to Tauri Mobile (alpha — works but rough), or a parallel React Native + Expo codebase. The PWA covers ~80% of mobile use today at $0. | 2–4 weeks for proper native |
| **WhatsApp Business API** | Twilio account + Meta Business verification + template approval | 1–4 weeks (Meta-bottlenecked) |
| **Multi-region Postgres / read replicas** | Upgrade Supabase to a paid plan that supports it (~$25/mo entry) | Hours after billing change |
| **SOC 2 Type II / ISO 27001** | Engage Drata or Vanta. They run the audit, you supply policies + evidence over 6–9 months. | 6–9 months, $15k–$40k |
| **FIX API access** | Direct broker partnership — typically requires demonstrated AUM (~$10M+) | Months of relationship-building |

## What you should actually do next (in order)

1. **Set `ENGINE_API_KEY` on the web app (Vercel) too.** It was previously
   only web→engine; the new settlement callback is engine→web with the
   *same* shared secret. Until it's set on Vercel,
   `/api/internal/settle-signal` returns 503 (verified) and
   engine-autonomous closes won't settle copy-trades. Use the exact same
   value already in Railway's `ENGINE_API_KEY`.
2. **Set `WEB_APP_URL` in Railway** = `https://algospherequant.com` (the
   engine default already is this, so only needed if you use a custom domain).
3. **Set `CREDENTIAL_ENCRYPTION_KEY`** in Railway env if not already there — the Python vault helper reads it. (`docs/DEPLOYMENT_RUNBOOK.md §1`)
4. **`pybit==5.8.0`, `python-okx==0.3.5`, `cryptography==43.0.3`** are now in `requirements.txt`. Re-deploy signal-engine on Railway so they install.
5. **Apply for Bybit testnet key** at testnet.bybit.com → derivatives → no withdraw → IP whitelist to your Railway egress IP.
6. **Connect a test Bybit account through `/brokers`** in the web app. The health probe will turn the dot green within 10 min; `shadow_executions` accumulate as the relay fires.
7. Only after the `/brokers` readiness gauge is **all-green** for a connection, the **Go Live** button appears — that is the *only* way to flip to real money.

## Out-of-scope reminders

- Do not rotate `CREDENTIAL_ENCRYPTION_KEY`. Rotating invalidates every stored broker credential and there is no migration path.
- Do not flip `BINANCE_TESTNET=false` (or any other adapter's live flag) without `pnl_drift_pct < 2%` over 50+ shadow executions.
- Broker API keys at the exchange side must have withdrawal scope **disabled** and IP-whitelisted to your engine host.
