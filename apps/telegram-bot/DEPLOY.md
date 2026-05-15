# Railway Deployment — Telegram Bot

## One-time setup (run from apps/telegram-bot/)

```bash
# 1. Login
railway login

# 2. Create a new project (call it "ai-trading-hub-bot")
railway init

# 3. Set all environment variables
railway variables set TELEGRAM_BOT_TOKEN="your-bot-token-from-botfather"
railway variables set TELEGRAM_ADMIN_CHAT_ID="your-telegram-user-id"
railway variables set SUPABASE_URL="https://your-project.supabase.co"
railway variables set SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
railway variables set APP_URL="https://your-app.vercel.app"

# 4. Deploy
railway up --detach
```

## Redeploy after code changes

```bash
railway up --detach
```

## View logs

```bash
railway logs
```

## Getting your values

- TELEGRAM_BOT_TOKEN  →  from @BotFather on Telegram (/newbot)
- TELEGRAM_ADMIN_CHAT_ID  →  message @userinfobot on Telegram to get your user ID
- SUPABASE_URL + SERVICE_ROLE_KEY  →  Supabase dashboard → Settings → API
- APP_URL  →  your Vercel deployment URL
