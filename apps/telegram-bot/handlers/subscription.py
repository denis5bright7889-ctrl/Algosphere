import os
from telegram import Update
from telegram.ext import ContextTypes
from services.subscription_service import get_profile_by_chat_id


async def subscribe_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    app_url = os.environ.get("APP_URL", "https://your-app.vercel.app")
    await update.message.reply_text(
        "Subscribe to AI Trading Hub to unlock daily signals and more:\n"
        f"{app_url}/upgrade\n\n"
        "After subscribing, link your Telegram by setting your chat ID in account settings."
    )


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    profile = get_profile_by_chat_id(chat_id)

    if not profile:
        await update.message.reply_text(
            "Your Telegram account is not linked to any AI Trading Hub account.\n"
            "Sign up at /subscribe and link your Telegram in settings."
        )
        return

    tier = profile.get("subscription_tier", "free").title()
    status = profile.get("subscription_status") or "inactive"
    name = profile.get("full_name") or "Trader"

    await update.message.reply_text(
        f"Hi {name}!\n\n"
        f"Plan: *{tier}*\n"
        f"Status: *{status.title()}*",
        parse_mode="Markdown",
    )
