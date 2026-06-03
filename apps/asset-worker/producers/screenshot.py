"""
Page screenshot producer — Playwright captures a route on the live
web app and saves a PNG. Used for signal_chart_screenshot,
dashboard_screenshot, portfolio_snapshot, trade_chart_screenshot,
feature_screenshot.

The target route is read from item.provenance.screenshot_path with a
fallback per kind. For signal-specific captures, /signals?focus=<id>
is the canonical deep-link.

Auth: when DEMO_AUTH_EMAIL + DEMO_AUTH_PASSWORD are set, the worker
logs in once and reuses the storage state file across runs — same
pattern as growth/demo-engine/.
"""
import asyncio
import os
from pathlib import Path
from typing import Dict, Optional
from loguru import logger

from playwright.async_api import async_playwright, Browser, BrowserContext


BASE_URL = (os.environ.get('DEMO_BASE_URL') or 'https://algospherequant.com').rstrip('/')
AUTH_EMAIL    = os.environ.get('DEMO_AUTH_EMAIL', '')
AUTH_PASSWORD = os.environ.get('DEMO_AUTH_PASSWORD', '')
STATE_PATH    = Path('/tmp/asset-worker-state.json')


# kind → default deep-link path. The producer overrides with
# provenance.screenshot_path when present.
KIND_DEFAULT_PATH: dict[str, str] = {
    'signal_chart_screenshot':  '/signals',
    'trade_chart_screenshot':   '/journal',
    'dashboard_screenshot':     '/overview',
    'portfolio_snapshot':       '/analytics',
    'feature_screenshot':       '/intelligence',
}


async def _login(browser: Browser) -> Optional[BrowserContext]:
    """Run /login once. Save storage state so subsequent shots reuse
    the cookie jar. Returns the context to use, or None if auth not
    configured."""
    if not (AUTH_EMAIL and AUTH_PASSWORD):
        return None
    if STATE_PATH.exists():
        try:
            return await browser.new_context(viewport={'width': 1440, 'height': 900},
                                              storage_state=str(STATE_PATH))
        except Exception as e:
            logger.warning(f"screenshot: storage state reuse failed — {e}; re-login")
            STATE_PATH.unlink(missing_ok=True)
    ctx = await browser.new_context(viewport={'width': 1440, 'height': 900})
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


def _resolve_path(item: dict) -> str:
    prov = item.get('provenance') or {}
    path = prov.get('screenshot_path')
    if path:
        return str(path)
    payload = prov.get('payload') or {}
    signal_id = payload.get('signal_id') or payload.get('id')
    kind = item.get('kind') or 'dashboard_screenshot'
    default = KIND_DEFAULT_PATH.get(kind, '/overview')
    if signal_id and default == '/signals':
        return f'/signals?focus={signal_id}'
    return default


async def _capture(item: dict, out_dir: Path) -> Dict[str, Path]:
    kind = item.get('kind') or 'dashboard_screenshot'
    target_path = _resolve_path(item)
    url = f'{BASE_URL}{target_path}'

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            ctx = await _login(browser)
            close_ctx = ctx is not None
            if ctx is None:
                ctx = await browser.new_context(viewport={'width': 1440, 'height': 900})
                close_ctx = True

            page = await ctx.new_page()
            try:
                await page.goto(url, wait_until='networkidle', timeout=45_000)
                # Give async hydration + grid composers time to render.
                await page.wait_for_timeout(1200)
                out = out_dir / f'{kind}.png'
                await page.screenshot(path=str(out), full_page=True)
                logger.info(f"screenshot {kind} -> {out} ({out.stat().st_size} bytes)")
                return {kind: out}
            finally:
                await page.close()
                if close_ctx:
                    await ctx.close()
        finally:
            await browser.close()


def produce(item: dict, out_dir: Path) -> Dict[str, Path]:
    """Sync wrapper that the worker calls. Producers run sequentially
    in the worker loop, so a single asyncio.run() per call is fine."""
    return asyncio.run(_capture(item, out_dir))
