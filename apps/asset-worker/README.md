# AlgoSphere Asset Worker

Railway service that turns text content_items into the full media kit —
screenshots, image cards, infographics, videos, PDFs — out-of-band so
the Vercel publisher doesn't have to wait. Reads `growth_content_items
WHERE asset_state='pending'`, produces, uploads to Supabase Storage,
flips state to `ready`. The scheduler then attaches the asset URLs to
the publish payload automatically.

## Architecture

```text
Vercel /api/automation/events
  ↓ matches rule → INSERT growth_content_items (asset_state='pending', asset_kinds=[...])
  ↓
Railway asset-worker (this service)  ←─── polls every 15s
  ↓ produces every asset_kind via producers/<kind>.py
  ↓ uploads → Supabase Storage → growth-assets/<content_id>/<kind>.<ext>
  ↓ writes asset_urls + asset_state='ready' (or 'partial' / 'failed')
  ↓
Vercel cron /api/cron/growth-publish (daily 09:00 UTC)
  ↓ refuses to publish content_items with asset_state in ('pending','producing')
  ↓ reads asset_urls.signal_card → uses as hero on FB/IG posts
  ↓ fans out to Discord / Telegram / Meta adapters
  ↓ growth_post_attempts → mirror trigger → system_event_log (unified ops view)
```

## What's built (Phase 1)

| Producer | Asset kinds covered | Tech |
|---|---|---|
| `producers/signal_card.py` | `signal_card`, `trade_entry_card`, `trade_result_card` | PIL — 1080×1080 JPEG |
| `producers/weekly_stats.py` | `weekly_stats_card` | PIL — 1080×1080 JPEG |
| `producers/screenshot.py` | `signal_chart_screenshot`, `trade_chart_screenshot`, `dashboard_screenshot`, `portfolio_snapshot`, `feature_screenshot` | Playwright (Chromium) + login state caching |

## What's NOT yet built (Phase 2 backlog)

Every kind from the founder asset matrix that doesn't have a producer
in `producers/__init__.py:REGISTRY`. Each is enumerated in that file
with its build path. Concretely:

| Kind | Build path |
|---|---|
| `signal_infographic` | PIL composite layered on `signal_card` |
| `signal_reel_video` | Subprocess to `marketing/videos/` Remotion render |
| `signal_pdf_report` | Add `weasyprint` to requirements; html → pdf |
| `pnl_infographic` | PIL composite |
| `heatmap_image` | matplotlib heatmap → PNG |
| `educational_carousel` | Multi-image PIL (3-5 cards in one folder) |
| `*_video` (any kind) | Same Remotion subprocess as signal_reel_video |
| `*_pdf` (any kind) | Same weasyprint pattern as signal_pdf_report |

Adding any one is ~50 LOC + a registry entry. Same skeleton as the
existing producers.

## Deploy to Railway

```bash
# From repo root
cd apps/asset-worker

# Railway expects either railway.json + Dockerfile (this dir has both)
# OR `railway up` from this directory after `railway link`.

railway login
railway init                    # link to a new service in your project
railway up                      # builds the Dockerfile and deploys

# Set env vars in Railway dashboard:
#   SUPABASE_URL                    (the project URL)
#   SUPABASE_SERVICE_ROLE_KEY       (service-role JWT)
#   DEMO_AUTH_EMAIL                 (optional — for protected-route screenshots)
#   DEMO_AUTH_PASSWORD              (optional)
#   DEMO_BASE_URL                   (defaults to https://algospherequant.com)
#   ASSET_WORKER_POLL_S             (defaults to 15; lower for testing)
```

After deploy:

1. **Storage bucket** — the worker calls `ensure_bucket_exists()` on
   startup. If creation fails (existing bucket without public read,
   or permission issue), open Supabase Dashboard → Storage →
   `growth-assets` → enable public read.
2. **Activate a rule** — in `/admin/growth/automation`, set
   `asset_kinds = ['signal_card']` on at least one signal.published
   rule. The next signal event will trigger an asset production cycle.
3. **Verify** — Supabase Studio → `growth_asset_attempts` should show
   rows landing within seconds of an event. The mirror writes to
   `system_event_log` with surface = `growth_asset_ok` /
   `growth_asset_failed` so `/admin/intelligence-health` shows them
   in the unified feed.

## Storage layout

```
growth-assets/                                     (bucket, public read)
├── 7f3e8a..-content-uuid/
│   ├── signal_card.jpg                            (1080×1080 PIL)
│   ├── signal_chart_screenshot.png                (Playwright full-page)
│   └── trade_entry_card.jpg
├── 8c01b2..-another-content/
│   └── weekly_stats_card.jpg
└── ...
```

URL format (from `db.storage.from_(bucket).get_public_url()`):
`https://<project-ref>.supabase.co/storage/v1/object/public/growth-assets/<content_id>/<kind>.<ext>`

## Local development

```bash
cd apps/asset-worker
pip install -r requirements.txt
playwright install chromium

export SUPABASE_URL="https://...supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
export DEMO_BASE_URL="http://localhost:3000"   # for local screenshot testing
export DEMO_AUTH_EMAIL="demo@you.com"
export DEMO_AUTH_PASSWORD="..."

python worker.py
```

Insert a test content_item to trigger a production cycle:

```sql
INSERT INTO growth_content_items (
  kind, title, body_md, asset_state, asset_kinds, provenance
) VALUES (
  'market_report',
  'Test asset production',
  'Body here.',
  'pending',
  ARRAY['signal_card','signal_chart_screenshot'],
  '{"payload":{"pair":"EURUSD","direction":"buy","entry":1.0850,"stop_loss":1.0820,"take_profit":1.0910,"risk_reward":2,"confidence":78}}'::jsonb
);
```

Watch the worker log — within ~15s it should claim, produce both
assets, upload, and flip the row to `asset_state='ready'` with
`asset_urls = {"signal_card": "https://...", "signal_chart_screenshot": "https://..."}`.

## Architectural choices worth noting

- **Polling, not webhooks** — Vercel can't reliably push to Railway
  (no shared network). Polling at 15s + exponential backoff during
  idle periods is cheap and resilient to Vercel function timeouts.
- **5-min lease** — claim_one() stamps `asset_worker_lease_until`
  so a sibling replica can't race. A crashed worker's lease auto-
  expires after 5 minutes; the next claim cycle picks the row back up.
- **Asset failures don't block publish (mostly)** — `partial` and
  `failed` both fall through the publish gate. The publisher uses
  whatever URLs landed, text-only as fallback. The audit log makes
  the failure visible in `/admin/intelligence-health`.
- **Producers are sync** — the worker runs them sequentially. Adding
  concurrency means more memory + risk of Playwright/Remotion fights.
  Scale via Railway replicas instead.
