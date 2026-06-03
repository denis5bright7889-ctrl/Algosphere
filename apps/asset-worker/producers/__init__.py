"""
Producer registry — maps an asset_kind string to a producer callable.

A producer takes the content_item row + an output Path and writes
one or more files there, returning the (kind → local file) map of
what it produced. The worker handles upload + DB writeback.

Adding a new producer:
  1. Implement it as `produce(item: dict, out_dir: Path) -> dict[str, Path]`.
  2. Register it in REGISTRY below under all kinds it covers.
  3. Push — Railway redeploys; no schema change.
"""
from pathlib import Path
from typing import Callable, Dict

from .signal_card  import produce as produce_signal_card
from .screenshot   import produce as produce_screenshot
from .weekly_stats import produce as produce_weekly_stats


Producer = Callable[[dict, Path], Dict[str, Path]]


# kind → producer. A producer can be registered under multiple kinds
# when the visual output is the same shape (e.g. signal_card,
# trade_entry_card and weekly_stats_card all render a 1080×1080 card
# from the row's title + summary + numbers).
REGISTRY: Dict[str, Producer] = {
    # Signal pipeline (event: signal.published)
    'signal_card':              produce_signal_card,
    'signal_chart_screenshot':  produce_screenshot,

    # Trade pipeline (events: trade.opened, trade.closed)
    'trade_entry_card':         produce_signal_card,
    'trade_result_card':        produce_signal_card,
    'trade_chart_screenshot':   produce_screenshot,

    # Market / weekly pipelines (events: cron.daily, performance.weekly)
    'weekly_stats_card':        produce_weekly_stats,
    'dashboard_screenshot':     produce_screenshot,

    # NOTE — Asset kinds NOT yet covered, with their build path:
    # - signal_infographic     → multi-panel PIL composite. Same pattern as signal_card.
    # - signal_reel_video      → Remotion render (offload via subprocess to /marketing/videos).
    # - signal_pdf_report      → weasyprint(html → pdf). Add weasyprint to requirements.
    # - trade_explanation_video → Remotion. Same as signal_reel_video.
    # - pnl_infographic        → PIL composite, same shape as signal_card.
    # - heatmap_image          → matplotlib heatmap → PNG.
    # - watchlist_graphic      → PIL composite of top movers.
    # - economic_calendar_image → PIL composite from /api/calendar.
    # - ai_market_video        → Remotion + edge-tts pipeline (already exists at /marketing/videos).
    # - equity_curve_image     → matplotlib equity line chart.
    # - portfolio_snapshot     → screenshot of /analytics page (Playwright).
    # - weekly_recap_video     → Remotion.
    # - investor_pdf           → weasyprint.
    # - institutional_report_pdf → weasyprint.
    # - capital_growth_chart   → matplotlib.
    # - risk_report            → weasyprint.
    # - investor_video         → Remotion.
    # - educational_carousel   → multiple PIL cards (3-5 frames) packaged as JPGs in a folder.
    # - educational_video      → Remotion.
    # - educational_infographic → PIL composite.
    # - feature_card           → PIL card from release notes.
    # - feature_screenshot     → Playwright tour of new feature.
    # - feature_demo_video     → Remotion + Playwright recording.
    # - changelog_pdf          → weasyprint from CHANGELOG.md.
    # - achievement_card       → PIL card.
    # - achievement_video      → Remotion.
    # - celebration_graphic    → PIL composite.
}


def has(kind: str) -> bool:
    return kind in REGISTRY


def get(kind: str) -> Producer:
    return REGISTRY[kind]


def known_kinds() -> list[str]:
    return sorted(REGISTRY.keys())
