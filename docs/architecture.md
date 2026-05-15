# Architecture Overview

## Services

| Service       | Location          | Hosting  | Description                                 |
|---------------|-------------------|----------|---------------------------------------------|
| Web frontend  | `apps/web`        | Vercel   | Next.js 14 App Router (dashboard + landing) |
| Telegram bot  | `apps/telegram-bot` | Railway | Python long-polling bot                     |
| Database      | Supabase          | Cloud    | PostgreSQL + Auth + Storage + RLS           |

## Data flow

```
User browser ──► Next.js (Vercel)
                    │
                    ▼
              Supabase (DB + Auth)
                    ▲
                    │
Telegram ──► Bot (Railway)
```

## Auth

- Supabase email + Google OAuth
- Session managed via `@supabase/ssr` cookies
- Middleware redirects unauthenticated requests to `/login`
- Subscription gating is always server-side

## Payment flow

1. User clicks upgrade → checkout session created server-side
2. User completes payment on Stripe/Flutterwave/etc.
3. Webhook fires → handler verifies signature → updates `profiles.subscription_tier`
4. Next request: middleware reads tier from DB, grants/denies access

## Security

- RLS enabled on all tables
- `SUPABASE_SERVICE_ROLE_KEY` only in server-side code and bots
- Stripe signature verified on every webhook
- No client-side subscription gating
