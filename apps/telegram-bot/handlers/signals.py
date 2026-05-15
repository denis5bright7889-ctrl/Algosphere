from telegram import Update
from telegram.ext import ContextTypes
from services.signal_service import get_active_signals, format_signal
from services.subscription_service import is_subscribed


async def signals_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id

    if not is_subscribed(chat_id):
        await update.message.reply_text(
            "You need an active subscription to view signals.\n"
            "Use /subscribe to get started."
        )
        return

    signals = get_active_signals(limit=5)

    if not signals:
        await update.message.reply_text("No active signals right now. Check back soon!")
        return

    header = f"*Latest {len(signals)} Signal(s)*\n\n"
    body = "\n\n---\n\n".join(format_signal(s) for s in signals)
    await update.message.reply_text(header + body, parse_mode="Markdown")
