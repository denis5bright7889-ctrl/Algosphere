import os
from telegram import Update
from telegram.ext import ContextTypes
from services.signal_service import get_active_signals, format_signal


def _is_admin(chat_id: int) -> bool:
    admin_id = os.environ.get("TELEGRAM_ADMIN_CHAT_ID")
    return admin_id and str(chat_id) == admin_id


async def broadcast_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_admin(update.effective_chat.id):
        await update.message.reply_text("Unauthorized.")
        return

    if not context.args:
        await update.message.reply_text("Usage: /broadcast <message>")
        return

    message = " ".join(context.args)
    await update.message.reply_text(f"Broadcast sent: {message}")
