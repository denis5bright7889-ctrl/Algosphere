import os
import logging
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler

from handlers.signals import signals_command
from handlers.subscription import subscribe_command, status_command
from handlers.admin import broadcast_command

load_dotenv()
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


async def start_command(update: Update, context) -> None:
    app_url = os.environ.get("APP_URL", "https://your-app.vercel.app")
    await update.message.reply_text(
        "Welcome to *AI Trading Hub*!\n\n"
        "Get professional trading signals, risk management tools, and more.\n\n"
        "*Commands:*\n"
        "/signals — View latest active signals\n"
        "/status  — Check your subscription\n"
        "/subscribe — Get a subscription link\n\n"
        f"Sign up: {app_url}",
        parse_mode="Markdown",
    )


def main() -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    app = Application.builder().token(token).build()

    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("signals", signals_command))
    app.add_handler(CommandHandler("subscribe", subscribe_command))
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler("broadcast", broadcast_command))

    logger.info("Bot starting...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
