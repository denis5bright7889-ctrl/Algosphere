import os
import logging
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler

from handlers.signals import signals_command
from handlers.subscription import subscribe_command, status_command
from handlers.admin import broadcast_command
from services.signal_broadcaster import poll_and_broadcast

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

    # Auto-broadcaster: poll the signals table and push new signals to the
    # channel + linked subscribers. Requires the job-queue extra (in
    # requirements). Interval is env-tunable; default 60s.
    interval = int(os.environ.get("SIGNAL_POLL_INTERVAL_S", "60"))
    if app.job_queue is not None:
        app.job_queue.run_repeating(poll_and_broadcast, interval=interval, first=15)
        logger.info(f"Signal auto-broadcaster scheduled every {interval}s")
    else:
        logger.warning("JobQueue unavailable — auto-broadcaster disabled "
                       "(install python-telegram-bot[job-queue])")

    logger.info("Bot starting...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
