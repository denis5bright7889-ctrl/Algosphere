from database import get_db


def get_profile_by_chat_id(chat_id: int) -> dict | None:
    """Return the profile row for a given Telegram chat ID, or None."""
    db = get_db()
    result = (
        db.table("profiles")
        .select("id, full_name, subscription_tier, subscription_status")
        .eq("telegram_chat_id", chat_id)
        .maybe_single()
        .execute()
    )
    return result.data


def is_subscribed(chat_id: int) -> bool:
    """Return True if the user has an active paid subscription."""
    profile = get_profile_by_chat_id(chat_id)
    if not profile:
        return False
    return (
        profile.get("subscription_tier") in ("starter", "premium")
        and profile.get("subscription_status") in ("active", "trialing")
    )


def link_telegram(user_id: str, chat_id: int) -> None:
    """Associate a Telegram chat ID with a profile."""
    db = get_db()
    db.table("profiles").update({"telegram_chat_id": chat_id}).eq("id", user_id).execute()
