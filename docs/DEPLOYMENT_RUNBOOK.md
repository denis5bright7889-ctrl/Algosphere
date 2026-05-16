# AlgoSphere Quant — Deployment Runbook

Everything in this file requires **you** to run commands or click in external dashboards. Code is already shipped. Where I could automate, I did.

---

## 1. Generate the credential vault key (1 min, $0)

The broker_connections table encrypts API keys with AES-256-GCM. Pick a 32-byte random key once and keep it in your secret manager forever — **rotating it invalidates all stored broker keys.**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Example output: 8x9K2L+m...=
```

Add to Vercel → Project → Settings → Environment Variables:
```
CREDENTIAL_ENCRYPTION_KEY = <the output above>
```
Scope: **Production + Preview + Development.** Hit "Redeploy" after saving.

Also add it to your local `apps/web/.env.local` if you want `/brokers` to work in dev.

---

## 2. Deploy the signal-engine to Railway (15 min, $0 on hobby tier)

Railway is the fastest free path. The engine is already containerizable (`apps/signal-engine/railway.json` + `nixpacks.toml` exist).

### One-time setup
```bash
# Install Railway CLI
npm install -g @railway/cli
railway login

cd apps/signal-engine
railway init   # pick "Empty Project", name it "algosphere-engine"
railway up     # deploys what's in this directory
```

### Set env vars in Railway dashboard
After first deploy, go to **Variables tab** and add:
```
SUPABASE_URL                 = (same as Vercel)
SUPABASE_SERVICE_ROLE_KEY    = (same as Vercel)
ENGINE_API_KEY               = (pick any long random string — used to auth from Vercel)
ADMIN_EMAIL                  = (your email)
SIGNAL_ENGINE_ENABLED        = true
SYMBOLS                      = XAUUSD,EURUSD,GBPUSD,USDJPY,BTCUSDT,ETHUSDT
SCAN_INTERVAL_MINUTES        = 5
MIN_CONFIDENCE               = 55

# Optional — only if you want live execution from the engine
BINANCE_API_KEY              = (testnet first — testnet.binance.vision)
BINANCE_API_SECRET           =
BINANCE_TESTNET              = true

# Optional — risk config (sane defaults baked in)
RISK_DAILY_LOSS_LIMIT_PCT    = 0.05
RISK_MAX_TOTAL_DRAWDOWN_PCT  = 0.15
```

Railway will give you a public URL like `algosphere-engine.up.railway.app`.

### Wire it to Vercel
Add to **Vercel** env vars:
```
SIGNAL_ENGINE_URL = https://algosphere-engine.up.railway.app
ENGINE_API_KEY    = <same value you used in Railway>
```
**Redeploy** Vercel — only then can the copy-relay `full_auto` actually call the engine.

### Smoke-test the engine
```bash
curl https://algosphere-engine.up.railway.app/api/v1/health
# expect: {"status":"ok"}

curl -H "X-Engine-Key: <your key>" \
  https://algosphere-engine.up.railway.app/api/v1/execute/status
# expect: {"configured":true, "broker":"binance", "testnet":true, ...}
```

---

## 3. Sentry (5 min, $0 — 5k errors/month free)

1. Sign up at sentry.io → create a project → pick "JavaScript / Next.js"
2. Copy the **DSN** (looks like `https://abc123@o12345.ingest.sentry.io/67890`)
3. Add to Vercel env vars:
   ```
   SENTRY_DSN = https://abc123@o12345.ingest.sentry.io/67890
   ```
4. Redeploy. `lib/monitoring.ts` activates automatically — no code change needed.

The integration uses Sentry's raw HTTP store endpoint (zero npm bundle weight). To upgrade to full SDK features (session replay, source maps, performance), `npm i @sentry/nextjs` later and swap `lib/monitoring.ts` — every consumer keeps working.

---

## 4. VAPID keys (Web Push) — already configured ✓

The production smoke test confirmed `/api/alerts/push/vapid` returns 200, meaning you already have these set. If you ever rotate:

```bash
cd apps/web
npx web-push generate-vapid-keys
# Output:
#   Public Key:  BNbxxxxx
#   Private Key: fxvxxxxx
```

Update in Vercel:
```
VAPID_PUBLIC_KEY  = (the public)
VAPID_PRIVATE_KEY = (the private)
VAPID_SUBJECT     = mailto:you@yourdomain.com
```

---

## 5. AI (Gemini) — already configured ✓

Your `GEMINI_API_KEY` is already live (psychology coach + trade reviews + market narration all working). Free-tier limits:
- 15 requests / minute
- 1M tokens / day
- 1,500 requests / day

Watch usage at https://aistudio.google.com → API key → "Show usage." When you outgrow free, swap to paid Gemini or Anthropic Claude — only `lib/ai.ts` changes.

---

## 6. Resend email (5 min, $0 — 3k/mo free)

1. Sign up at resend.com → create an API key
2. Add a sender domain (use `resend.dev` for testing, your own domain for prod)
3. Add to Vercel:
   ```
   RESEND_API_KEY = re_xxxxxxxx
   RESEND_FROM    = AlgoSphere <noreply@yourdomain.com>
   ```

---

## 7. Update community invite URLs (5 min)

The `official_communities` table seeded with placeholder Telegram/WhatsApp links. Update them via SQL:

```sql
-- Run in Supabase SQL editor
UPDATE public.official_communities SET invite_url = 'https://t.me/your-real-link' WHERE slug = 'telegram-free';
UPDATE public.official_communities SET invite_url = 'https://t.me/+real-starter' WHERE slug = 'telegram-starter';
UPDATE public.official_communities SET invite_url = 'https://t.me/+real-pro'     WHERE slug = 'telegram-pro';
UPDATE public.official_communities SET invite_url = 'https://t.me/+real-vip'     WHERE slug = 'telegram-vip';
UPDATE public.official_communities SET invite_url = 'https://chat.whatsapp.com/real-vip' WHERE slug = 'whatsapp-vip';
UPDATE public.official_communities SET invite_url = 'https://discord.gg/your-real-link'  WHERE slug = 'discord-pro';
```

Or just delete + re-insert rows you don't need. The `/rooms` page hides invite URLs from under-tier users at the **RPC layer**, not the table layer — so the secrets are safe even if RLS is mis-set.

---

## 8. After all env vars are set — full smoke test

```bash
cd <repo root>
node scripts/smoke-test.mjs https://algospherequant.com
```

Expected (after engine + Sentry + community URLs configured):
```
13/13 passed · ✓ all green
```

---

## 9. What CANNOT be done from this runbook

These require business / external partner action — code is ready, but you drive these calendars:

| Item | What you need to do |
|---|---|
| **Bybit / OKX adapters** | Apply for testnet API keys + I'll wire them when you have the credentials (template matches Binance pattern exactly) |
| **MT5 adapter** | Spin up Oracle Cloud Always-Free VM (Windows or Wine on Linux), install MT5 terminal + AlgoSphere EA, broker demo account |
| **cTrader adapter** | Apply for cTrader Open API at connect.spotware.com — 5 business days approval |
| **Real smart-contract token launch** | Hire audit firm ($15k–$50k: Trail of Bits, ConsenSys Diligence, Zellic). Set up Fireblocks for signing infra. Until then, /launchpad is a SaaS lead-capture flow + admin-managed deploys |
| **Native mobile app** | Separate codebase (React Native + Expo OR Capacitor wrapping the existing Next.js). PWA is shipping today and covers 80% of mobile needs at $0 |
| **Tauri desktop wrapper** | Separate codebase (`npm create tauri-app`) — wraps the existing web app. ~3 days |
| **WhatsApp Business API** | Twilio account + Meta Business verification + template approval (1–4 weeks) |
| **Multi-region Postgres** | Upgrade Supabase to paid plan that supports read replicas |
| **SOC 2 / ISO 27001** | 6–9 months with a firm like Drata or Vanta — required for enterprise contracts above ~$50k ARR |
| **FIX API** | Direct broker partnership negotiations — typically requires demonstrated AUM |
| **Telegram voice sessions** | Native Telegram feature — already free in any group. Just have an admin start a voice chat in your `/rooms` Telegram group. Bot can announce via the existing `apps/telegram-bot/` |

---

## TL;DR: things I just shipped that activate as you set env vars

| Feature | Activates when you set |
|---|---|
| Broker credential vault | `CREDENTIAL_ENCRYPTION_KEY` |
| Live execution (signal-engine on Railway) | `SIGNAL_ENGINE_URL` + `ENGINE_API_KEY` on both Vercel + Railway |
| Error monitoring | `SENTRY_DSN` |
| AI trade reviews + psychology + narration + commentary | `GEMINI_API_KEY` ✓ already set |
| Web Push | `VAPID_*` ✓ already set |
| Email | `RESEND_API_KEY` |

Everything else (broker_connections UI, shadow mode dashboard, /rooms VIP gating, /api-docs Swagger UI, AI signal commentary auto-posts) **works the moment you deploy** — no env var needed.
