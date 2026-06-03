# AlgoSphereQuant Growth Engine

The Growth Engine is the marketing automation system. It runs entirely on the
Vercel web app + Supabase database + Vercel Cron — no separate service. The
signal-engine on Railway fires events into it via HTTP.

## Surfaces

| Surface | Where | Purpose |
|---|---|---|
| `/admin/growth` | apps/web | Main content dashboard |
| `/admin/growth/diagnostics` | apps/web | Env audit + in-UI smoke test |
| `/admin/growth/automation` | apps/web | Rule editor |
| `/admin/growth/calendar` | apps/web | Schedule view |
| `/admin/growth/brand` | apps/web | Brand voice settings |
| `/admin/growth/funnel` | apps/web | Attribution funnel |
| `/admin/growth/discovery` | apps/web | Reddit discovery feed |
| `/admin/growth/new` + `[id]` | apps/web | Create / edit content |
| `/blog` + `/blog/[slug]` | apps/web | Public blog (RLS-gated on published rows) |
| `/api/automation/events` | apps/web | Event ingress (signal-engine + crons) |
| `/api/admin/growth/diagnostics` | apps/web | Env audit JSON |
| `/api/admin/growth/smoke-test` | apps/web | Fire test posts to every configured channel |
| `/api/admin/growth/generate` | apps/web | Generate a content item from input |
| `/api/cron/growth-publish` | apps/web | Vercel cron — daily 09:00 UTC |
| `/api/cron/growth-discovery` | apps/web | Vercel cron — daily 07:00 UTC |
| `/api/cron/health-summary` | apps/web | Vercel cron — daily 08:00 UTC |
| `/api/cron/performance-recap` | apps/web | Vercel cron — daily 08:30 UTC |

## Channel adapters

`apps/web/src/lib/growth/adapters/`:

| Adapter | Channels | Env required |
|---|---|---|
| `discord.ts` | general, announcements, market_intel, algo_updates, education | `DISCORD_WEBHOOK_<TARGET>_URL` |
| `telegram.ts` | growth channel + DMs to linked subscribers | `TELEGRAM_BOT_TOKEN` + `GROWTH_TELEGRAM_CHANNEL_ID` |
| `meta.ts` | facebook page, instagram feed, instagram reels | `META_PAGE_ACCESS_TOKEN` + `META_FB_PAGE_ID` + `META_IG_USER_ID` |
| `linkedin.ts` | UGC posts (org or member) | `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_AUTHOR_URN` |
| `whatsapp.ts` | WhatsApp channel | `WHATSAPP_*` (Cloud API) |
| `x.ts` | X/Twitter | `X_*` |
| `youtube.ts` | YouTube + Shorts | `YT_*` |

## Smoke testing — terminal runner (this commit)

For when the admin UI is unreachable or you want to verify from CI:

```bash
# Load Vercel env to your local shell (vercel env pull > .env.local) then:
node growth/smoke-test.mjs              # all channels
node growth/smoke-test.mjs --dry         # show what WOULD post
node growth/smoke-test.mjs --only=discord                            # subset
node growth/smoke-test.mjs --only=discord:general,facebook,instagram # explicit
```

Exit code is non-zero if anything that was attempted (not skipped) failed —
so CI fails the job and the operator gets a real signal.

The terminal runner does NOT need Supabase credentials or the admin UI. It
just reads each channel's env, calls the provider directly, and prints
success/failure with external IDs for proof.

## Observability bridge (migration 20240101000065)

Every `growth_post_attempts` insert is mirrored into `system_event_log` via a
SECURITY DEFINER trigger so the unified ops feed at `/admin/intelligence-health`
shows growth publishes alongside engine + risk events. The mirror is fail-safe —
a malformed attempt row can never block the publish path.

Surfaces added:
- `growth_publish_ok`
- `growth_publish_failed`
- `growth_publish_attempt`
- `growth_smoke_test`

## What's NOT in this directory

These are referenced from the main Growth Engine but live elsewhere:

- `marketing/videos/` — Remotion + edge-tts video pipeline (5 explainer MP4s ready)
- `growth/demo-engine/` — Playwright screenshot + recording + auto-narration

The Playwright stack does **not** run on Vercel Functions (Chromium too heavy).
When the wire from `signal.published` → auto-asset-production is fully built,
it'll run on a Railway worker that drains content_items WHERE `assets_pending = true`,
produces screenshots/videos via Playwright + Remotion, uploads to Supabase Storage,
and flips `assets_pending = false`. Today the assets pipeline is manual.
