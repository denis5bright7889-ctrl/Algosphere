"""
Page screenshot producer — Playwright captures live AlgoSphere routes
and emits desktop + mobile PNG + WEBP variants per kind.

Phase 6C — Visual Content Engine. Producer serves the full kind table:

  dashboard_screenshot, signals_screenshot, psychology_screenshot,
  journal_screenshot, strategy_builder_screenshot,
  performance_screenshot, risk_engine_screenshot,
  education_hub_screenshot, market_intelligence_screenshot,
  leaderboard_screenshot, feature_screenshot — and the legacy aliases
  (signal_chart_screenshot, trade_chart_screenshot, portfolio_snapshot).

Auth: when DEMO_AUTH_EMAIL + DEMO_AUTH_PASSWORD are set, the worker
runs the login flow once and reuses a storage_state.json cookie jar
across captures. For unauthenticated routes (/, /pricing) auth is
skipped.

Stability:
  - wait_for_load_state('networkidle') + fixed 1200ms settling delay
    for grid composers (dashboard tiles, charts).
  - CSS injection hides skeleton shimmers, debug banners, scrollbars,
    and any element flagged data-screenshot-hide so the captures
    never include in-flight loading states.

Output (per kind):
  {kind}                  → desktop PNG  (1440×900 full-page)
  {kind}_desktop_webp     → desktop WEBP (lossy 85)
  {kind}_mobile           → mobile  PNG  (414×896 full-page)
  {kind}_mobile_webp      → mobile  WEBP

The first entry uses the EXACT requested asset_kind so the worker's
finalise() marks the row 'ready'. Extras populate asset_urls with
discriminated keys for the publisher to pick the right variant per
channel (Instagram = mobile WEBP, LinkedIn = desktop PNG, etc.).
"""
import asyncio
import os
from pathlib import Path
from typing import Dict, Optional
from loguru import logger

from PIL import Image

from playwright.async_api import async_playwright, Browser, BrowserContext, Page


BASE_URL = (os.environ.get('DEMO_BASE_URL') or 'https://algospherequant.com').rstrip('/')
AUTH_EMAIL    = os.environ.get('DEMO_AUTH_EMAIL', '')
AUTH_PASSWORD = os.environ.get('DEMO_AUTH_PASSWORD', '')
STATE_PATH    = Path('/tmp/asset-worker-state.json')

DESKTOP_VIEWPORT = {'width': 1440, 'height': 900}
MOBILE_VIEWPORT  = {'width': 414,  'height': 896}     # iPhone-XR-ish

# Per-kind defaults: route + auth requirement. Routes here MUST exist
# in the deployed web app — if you rename a page, update this table.
KIND_PROFILES: dict[str, dict] = {
    # ── Phase 6C canonical kinds ───────────────────────────────────
    'dashboard_screenshot':              {'path': '/overview',               'auth': True},
    'signals_screenshot':                {'path': '/signals',                'auth': True},
    'psychology_screenshot':             {'path': '/intelligence/me',        'auth': True},
    'journal_screenshot':                {'path': '/journal',                'auth': True},
    'strategy_builder_screenshot':       {'path': '/strategies',             'auth': True},
    'performance_screenshot':            {'path': '/analytics',              'auth': True},
    'risk_engine_screenshot':            {'path': '/risk',                   'auth': True},
    'education_hub_screenshot':          {'path': '/learn',                  'auth': False},
    'market_intelligence_screenshot':    {'path': '/intelligence/markets',   'auth': True},
    'leaderboard_screenshot':            {'path': '/community',              'auth': True},
    'feature_screenshot':                {'path': '/intelligence',           'auth': True},

    # ── Legacy aliases (still wired in REGISTRY) ───────────────────
    'signal_chart_screenshot':           {'path': '/signals',                'auth': True},
    'trade_chart_screenshot':            {'path': '/journal',                'auth': True},
    'portfolio_snapshot':                {'path': '/analytics',              'auth': True},
}


# Injected before every screenshot — hides loading shimmers, debug
# banners, scrollbars, and any author-flagged hide markers. Lives here
# (not as a CSS file) so the producer is self-contained.
HIDE_CSS = """
  /* Loading skeletons (tailwind animate-pulse + radix data-state) */
  .animate-pulse,
  [data-skeleton],
  [aria-busy="true"],
  [data-state="loading"] { visibility: hidden !important; }

  /* Debug / dev banners, fps overlays, axe accessibility overlays */
  [data-debug],
  [data-dev-banner],
  iframe[title*="React Devtools"],
  iframe[title*="axe"]      { display: none !important; }

  /* Author-flagged elements (e.g. user emails in nav) */
  [data-screenshot-hide]    { display: none !important; }

  /* Hide scrollbars so they don't appear in the capture */
  *::-webkit-scrollbar      { display: none !important; }
  html, body                { scrollbar-width: none !important; }

  /* Pause animations so the still capture is consistent */
  *, *::before, *::after    { animation-play-state: paused !important;
                              transition: none !important; }
"""


def _resolve_profile(item: dict, kind: str) -> dict:
    """Resolve the route + auth flag. provenance.screenshot_path wins;
    otherwise pull from KIND_PROFILES; otherwise default to /overview
    (auth required)."""
    prov = item.get('provenance') or {}
    override = prov.get('screenshot_path')
    base = KIND_PROFILES.get(kind, {'path': '/overview', 'auth': True})
    return {
        'path': str(override) if override else base['path'],
        'auth': base.get('auth', True),
    }


async def _login(browser: Browser, viewport: dict) -> Optional[BrowserContext]:
    """Run /login once. Save storage state so subsequent shots reuse
    the cookie jar. Returns the context to use, or None if auth not
    configured / login failed."""
    if not (AUTH_EMAIL and AUTH_PASSWORD):
        return None
    if STATE_PATH.exists():
        try:
            return await browser.new_context(viewport=viewport,
                                              storage_state=str(STATE_PATH))
        except Exception as e:
            logger.warning(f"screenshot: storage state reuse failed — {e}; re-login")
            STATE_PATH.unlink(missing_ok=True)
    ctx = await browser.new_context(viewport=viewport)
    page = await ctx.new_page()
    try:
        await page.goto(f'{BASE_URL}/login', wait_until='networkidle', timeout=45_000)
        await page.fill('input[type="email"]', AUTH_EMAIL)
        await page.fill('input[type="password"]', AUTH_PASSWORD)
        await asyncio.wait_for(
            asyncio.gather(
                page.wait_for_url(lambda u: '/login' not in str(u), timeout=30_000),
                page.click('button[type="submit"]'),
            ),
            timeout=35,
        )
        await ctx.storage_state(path=str(STATE_PATH))
        return ctx
    except Exception as e:
        logger.error(f"screenshot: login failed — {e}")
        await ctx.close()
        return None
    finally:
        try: await page.close()
        except Exception: pass


async def _stabilise(page: Page) -> None:
    """Inject hide CSS, settle the page, dismiss any cookie banners."""
    try:
        await page.add_style_tag(content=HIDE_CSS)
    except Exception:
        pass
    # Common consent banners — try to dismiss but don't fail the shot
    # if they don't exist.
    for selector in ['button[data-consent-accept]', 'button:has-text("Accept")',
                     'button:has-text("Got it")', '[aria-label="Dismiss"]']:
        try:
            el = await page.query_selector(selector)
            if el and await el.is_visible():
                await el.click(timeout=1000)
                break
        except Exception:
            continue
    # Final settle — animations are paused but layout shifts can still
    # propagate one frame after CSS injection.
    await page.wait_for_timeout(1200)


async def _capture_one(ctx: BrowserContext, url: str, out_path: Path) -> Optional[Path]:
    page = await ctx.new_page()
    try:
        try:
            await page.goto(url, wait_until='networkidle', timeout=45_000)
        except Exception:
            # networkidle can time out on pages with long-polling WS
            # connections — fall back to domcontentloaded.
            try:
                await page.goto(url, wait_until='domcontentloaded', timeout=15_000)
            except Exception as e:
                logger.error(f"screenshot: goto {url} failed — {e}")
                return None
        await _stabilise(page)
        await page.screenshot(path=str(out_path), full_page=True)
        return out_path
    finally:
        try: await page.close()
        except Exception: pass


def _png_to_webp(png_path: Path, webp_path: Path, quality: int = 85) -> Optional[Path]:
    """Pillow re-encode. Worker keeps both so consumers pick by channel:
    WEBP for IG/FB (smaller payload), PNG for LinkedIn/Discord (lossless)."""
    try:
        with Image.open(png_path) as im:
            im.save(webp_path, 'WEBP', quality=quality, method=6)
        return webp_path
    except Exception as e:
        logger.warning(f"screenshot: webp encode failed — {e}")
        return None


async def _capture(item: dict, out_dir: Path, kind: str) -> Dict[str, Path]:
    profile = _resolve_profile(item, kind)
    url = f'{BASE_URL}{profile["path"]}'
    needs_auth = bool(profile['auth'])

    results: Dict[str, Path] = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            # ── Desktop pass ───────────────────────────────────────
            ctx = await _login(browser, DESKTOP_VIEWPORT) if needs_auth else None
            close_ctx = ctx is not None
            if ctx is None:
                ctx = await browser.new_context(viewport=DESKTOP_VIEWPORT)
                close_ctx = True
            try:
                desktop_png = out_dir / f'{kind}.png'
                if await _capture_one(ctx, url, desktop_png):
                    results[kind] = desktop_png
                    desktop_webp = out_dir / f'{kind}_desktop.webp'
                    if _png_to_webp(desktop_png, desktop_webp):
                        results[f'{kind}_desktop_webp'] = desktop_webp
            finally:
                if close_ctx:
                    await ctx.close()

            # ── Mobile pass ────────────────────────────────────────
            ctx_m = await _login(browser, MOBILE_VIEWPORT) if needs_auth else None
            close_ctx_m = ctx_m is not None
            if ctx_m is None:
                ctx_m = await browser.new_context(viewport=MOBILE_VIEWPORT,
                                                  device_scale_factor=2)
                close_ctx_m = True
            try:
                mobile_png = out_dir / f'{kind}_mobile.png'
                if await _capture_one(ctx_m, url, mobile_png):
                    results[f'{kind}_mobile'] = mobile_png
                    mobile_webp = out_dir / f'{kind}_mobile.webp'
                    if _png_to_webp(mobile_png, mobile_webp):
                        results[f'{kind}_mobile_webp'] = mobile_webp
            finally:
                if close_ctx_m:
                    await ctx_m.close()
        finally:
            await browser.close()

    if not results:
        raise RuntimeError(f'screenshot: every variant failed for kind={kind} url={url}')

    sizes = {k: p.stat().st_size for k, p in results.items()}
    logger.info(f"screenshot {kind} -> {len(results)} variants {sizes}")
    return results


def produce(item: dict, out_dir: Path, asset_kind: str = 'dashboard_screenshot') -> Dict[str, Path]:
    """Sync wrapper. Producers run sequentially in the worker loop, so
    a single asyncio.run() per call is correct."""
    return asyncio.run(_capture(item, out_dir, asset_kind))
