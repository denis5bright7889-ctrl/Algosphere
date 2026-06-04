"""
Producer registry — maps an asset_kind string to a producer callable.

Every producer takes (item: dict, out_dir: Path, asset_kind: str) and
returns a {produced_kind → local Path} mapping. The worker uploads
each returned file to Supabase Storage and writes the resulting URLs
back to growth_content_items.asset_urls.

Adding a new producer:
  1. Implement (item, out_dir, asset_kind) -> dict[str, Path]
  2. Register every asset_kind it covers in REGISTRY below.
  3. Push — Railway redeploys; no schema change required.

Every entry in this registry has a working producer.
"""
from pathlib import Path
from typing import Callable, Dict

from .signal_card    import produce as produce_card
from .weekly_stats   import produce as produce_weekly_stats
from .screenshot     import produce as produce_screenshot
from .infographic    import produce as produce_infographic
from .charts         import produce as produce_chart
from .carousel       import produce as produce_carousel
from .blog           import produce as produce_blog
from .pdf_report     import produce as produce_pdf
from .video          import produce as produce_video


Producer = Callable[[dict, Path, str], Dict[str, Path]]


REGISTRY: Dict[str, Producer] = {
    # ── Card images (PIL 1080×1080 JPEG) ───────────────────────────
    'signal_card':                  produce_card,
    'trade_entry_card':             produce_card,
    'trade_result_card':            produce_card,
    'achievement_card':             produce_card,
    'feature_card':                 produce_card,
    'weekly_stats_card':            produce_weekly_stats,

    # ── Screenshots (Playwright PNG + WEBP, desktop + mobile,
    #    auth-aware, skeleton-hidden). Phase 6C — Visual Content
    #    Engine. Every kind below produces 4 files (desktop_png +
    #    desktop_webp + mobile_png + mobile_webp) in one capture run.
    'signal_chart_screenshot':       produce_screenshot,
    'trade_chart_screenshot':        produce_screenshot,
    'dashboard_screenshot':          produce_screenshot,
    'portfolio_snapshot':            produce_screenshot,
    'feature_screenshot':            produce_screenshot,
    'signals_screenshot':            produce_screenshot,
    'psychology_screenshot':         produce_screenshot,
    'journal_screenshot':            produce_screenshot,
    'strategy_builder_screenshot':   produce_screenshot,
    'performance_screenshot':        produce_screenshot,
    'risk_engine_screenshot':        produce_screenshot,
    'education_hub_screenshot':      produce_screenshot,
    'market_intelligence_screenshot':produce_screenshot,
    'leaderboard_screenshot':        produce_screenshot,

    # ── Infographics (PIL 1080×1350 JPEG, Instagram portrait) ──────
    'signal_infographic':           produce_infographic,
    'weekly_infographic':           produce_infographic,
    'monthly_infographic':          produce_infographic,
    'pnl_infographic':              produce_infographic,
    'market_infographic':           produce_infographic,
    'economic_infographic':         produce_infographic,
    'investor_infographic':         produce_infographic,

    # ── Matplotlib charts (publication-quality PNG) ────────────────
    'equity_curve_image':           produce_chart,
    'capital_growth_chart':         produce_chart,
    'drawdown_chart':               produce_chart,
    'portfolio_performance_chart':  produce_chart,
    'monthly_performance_chart':    produce_chart,
    'asset_allocation_chart':       produce_chart,
    'strategy_comparison_chart':    produce_chart,
    'before_after_chart':           produce_chart,

    # ── Carousels (PIL multi-slide, 1080×1350 each) ────────────────
    'educational_carousel':         produce_carousel,
    'strategy_breakdown_carousel':  produce_carousel,
    'weekly_recap_carousel':        produce_carousel,
    'market_recap_carousel':        produce_carousel,
    'feature_release_carousel':     produce_carousel,

    # ── Blog (markdown + INSERT growth_content_items → /blog) ──────
    'daily_market_blog':            produce_blog,
    'weekly_market_blog':           produce_blog,
    'strategy_blog':                produce_blog,
    'educational_blog':             produce_blog,
    'feature_release_blog':         produce_blog,
    'monthly_investor_blog':        produce_blog,

    # ── PDFs (WeasyPrint, A4) ──────────────────────────────────────
    'trade_report_pdf':             produce_pdf,
    'weekly_report_pdf':            produce_pdf,
    'monthly_report_pdf':           produce_pdf,
    'investor_report_pdf':          produce_pdf,
    'risk_report_pdf':              produce_pdf,
    'strategy_report_pdf':          produce_pdf,
    'changelog_pdf':                produce_pdf,

    # ── Videos (Remotion event_video composition + edge-tts +
    #            FFmpeg thumbnail). Each entry produces MP4 + JPG.
    'signal_reel':                  produce_video,
    'trade_recap_video':            produce_video,
    'weekly_recap_video':           produce_video,
    'monthly_recap_video':          produce_video,
    'daily_market_video':           produce_video,
    'educational_video':            produce_video,
    'feature_demo_video':           produce_video,
    'achievement_video':            produce_video,
    'investor_update_video':        produce_video,
}


def has(kind: str) -> bool:
    return kind in REGISTRY


def get(kind: str) -> Producer:
    return REGISTRY[kind]


def known_kinds() -> list[str]:
    return sorted(REGISTRY.keys())
