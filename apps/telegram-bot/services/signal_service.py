from database import get_db


def get_active_signals(limit: int = 5) -> list[dict]:
    """Fetch the most recent active signals."""
    db = get_db()
    result = (
        db.table("signals")
        .select("*")
        .eq("status", "active")
        .order("published_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data or []


def format_signal(signal: dict) -> str:
    direction_emoji = "🟢" if signal["direction"] == "buy" else "🔴"
    lines = [
        f"{direction_emoji} *{signal['pair']}* — {signal['direction'].upper()}",
        f"Entry: `{signal['entry_price']}`",
        f"SL: `{signal['stop_loss']}`",
        f"TP1: `{signal['take_profit_1']}`",
    ]
    if signal.get("take_profit_2"):
        lines.append(f"TP2: `{signal['take_profit_2']}`")
    if signal.get("risk_reward"):
        lines.append(f"R:R — {signal['risk_reward']}")
    return "\n".join(lines)
