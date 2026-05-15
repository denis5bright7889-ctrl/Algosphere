# Deployment Guide

## Prerequisites

- Node.js 18+, Python 3.11+
- Supabase project created at supabase.com
- Stripe account with products created
- Vercel account, Railway account

## 1. Clone and install

```bash
git clone <repo>
cd ai-trading-hub
npm install
```

## 2. Environment variables

```bash
cp .env.example apps/web/.env.local
# Fill in all values
```

For the Telegram bot:
```bash
cp apps/telegram-bot/.env.example apps/telegram-bot/.env
# Fill in values
```

## 3. Database

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
npx supabase db seed  # optional dev seed
```

## 4. Deploy frontend (Vercel)

```bash
npx vercel deploy
# Set env vars in Vercel dashboard
```

## 5. Deploy Telegram bot (Railway)

```bash
cd apps/telegram-bot
# Push to a GitHub repo connected to Railway
# Set env vars in Railway dashboard
railway up
```

## 6. Stripe webhook

```bash
# Production: set endpoint in Stripe dashboard
# URL: https://your-app.vercel.app/api/webhooks/stripe
# Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted

# Local dev:
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
