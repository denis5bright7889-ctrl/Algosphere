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

## ⏳ Code-side gaps you can still ship in chat (1–3 hours each)

| # | Gap | Why it matters | What it takes |
|---|---|---|---|
| 1 | **`/api/desktop/update/[target]/[version]`** Next route returning Tauri's signed-update JSON | Without it, the desktop binary has no auto-update path. Currently disabled in `tauri.conf.json`. | One route + a `releases` table or a static `releases.json` in `apps/web/public`. |
| 2 | **Web UI for OKX passphrase field** in `/brokers` connection form | OKX won't connect without it; the API exists and table has `passphrase_enc`. | Add a third password input + extend the encrypt-and-store handler. |
| 3 | **Web UI for MT5 connection (login + password + server + path)** | MT5 uses different credentials than the crypto trio; the factory expects login in `api_key_enc`, server in `passphrase_enc`. | New form variant under `/brokers`, plus the broker-type chooser already exists. |
| 4 | **cTrader OAuth adapter** | We declared `'ctrader'` in the table check constraint but there's no Python adapter. cTrader uses OAuth refresh tokens (in `access_token_enc`), different shape from API-key brokers. | Implement `cTraderAdapter` + add to factory. ~2 hrs once you have a developer app at connect.spotware.com. |
| 5 | **Engine `/health/per-user`** endpoint that probes each user's broker on a cron | Lets `/brokers` show the live red/green dot we already have a column for (`status`, `equity_usd`, `error_message`). | One scheduled job in `worker/`, iterates connections, calls `adapter.refresh_state()`, writes back. |
| 6 | **Drift-monitor cron** that pairs shadow_executions with their leader signals and computes `pnl_drift_pct` once both close | Required for the live-mode readiness gate the runbook references. | Schedule + JOIN on `signal_id`, write back to `shadow_executions.pnl_drift_pct + closed_at`. |
| 7 | **Live-mode flip safety gate** (`/admin/execution-readiness`) | Surfaces the four criteria — 50+ execs, ≥95% fill, <0.1% slip, <2% drift — and refuses to flip `is_testnet → false` until they're all green. | One admin page + an RPC. |
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

1. **Set `CREDENTIAL_ENCRYPTION_KEY`** in Railway env if not already there — the new Python vault helper reads it. (`docs/DEPLOYMENT_RUNBOOK.md §1`)
2. **Add `pybit==5.8.0` and `python-okx==0.3.5`** are now in `requirements.txt`. Re-deploy signal-engine on Railway so they install.
3. **Apply for Bybit testnet key** at testnet.bybit.com → derivatives → no withdraw → IP whitelist to your Railway egress IP.
4. **Connect a test Bybit account through `/brokers`** in the web app. Then watch `shadow_executions` accumulate.
5. **Build gap #1 (Tauri update endpoint)** before you cut the first desktop release.
6. **Build gap #7 (live-mode readiness gate)** before you flip *any* `is_testnet=false`.

## Out-of-scope reminders

- Do not rotate `CREDENTIAL_ENCRYPTION_KEY`. Rotating invalidates every stored broker credential and there is no migration path.
- Do not flip `BINANCE_TESTNET=false` (or any other adapter's live flag) without `pnl_drift_pct < 2%` over 50+ shadow executions.
- Broker API keys at the exchange side must have withdrawal scope **disabled** and IP-whitelisted to your engine host.
