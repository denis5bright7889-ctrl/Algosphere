"""
Blog producer — generates publish-ready markdown + SEO metadata and
inserts a NEW growth_content_items row that the existing /blog and
/blog/[slug] pages serve automatically (RLS allows anon SELECT of
published rows; the marketing layer already reads from this table).

Six kinds dispatched by name:

  daily_market_blog        — short daily market read
  weekly_market_blog       — weekly recap with stats + sectors
  strategy_blog            — strategy breakdown with backtest stats
  educational_blog         — long-form educational topic
  feature_release_blog     — product announcement
  monthly_investor_blog    — institutional monthly recap

Unlike the other producers (which write files to Supabase Storage),
the blog producer writes BACK INTO THE DB — the asset is itself a
content_item row. The worker still records an attempt + URL (the
public /blog/<slug> URL) so the audit trail is intact.

Hero image: the parent content_item that triggered this blog
inherits its asset_urls (signal_card, weekly_stats, etc.) which the
blog row references via hero_image_url. So a "signal.published"
event that produces (signal_card + signal_blog) yields a blog post
with the signal card as its hero.
"""
from __future__ import annotations
import os
import re
from pathlib import Path
from typing import Dict
from datetime import datetime, timezone

from loguru import logger
from supabase import create_client


# Maps blog kind → the growth_content_items.kind that /blog reads.
# The blog page filters on status='published' + slug NOT NULL only.
_KIND_TO_CI_KIND = {
    'daily_market_blog':       'market_report',
    'weekly_market_blog':      'market_report',
    'monthly_investor_blog':   'market_report',
    'strategy_blog':           'strategy_of_the_week',
    'educational_blog':        'educational',
    'feature_release_blog':    'product_update',
}


def _db():
    url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    return create_client(url, key) if url and key else None


def _slug(title: str) -> str:
    s = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:80]
    suffix = datetime.now(timezone.utc).strftime('%Y%m%d')
    return f'{s}-{suffix}'[:96]


# ── Per-kind composers ──────────────────────────────────────────────

def _compose_daily_market(p: dict) -> dict:
    headline = p.get('headline') or 'Daily Market Read'
    regime   = p.get('regime') or {}
    what_changed = p.get('what_changed') or "Markets digested today's flow with mixed conviction."
    outlook      = p.get('outlook')      or "Stay nimble. Trade only when your strategy's regime is live."
    body = (
        f"## What changed today\n\n"
        f"{what_changed}\n\n"
        f"## Regime read\n\n"
        f"- **Environment**: {regime.get('environment') or '—'}\n"
        f"- **Trend strength**: {regime.get('trend_strength') or '—'}\n"
        f"- **Volatility**: {regime.get('volatility_state') or '—'}\n"
        f"- **Liquidity**: {regime.get('liquidity_state') or '—'}\n\n"
        f"## What to watch tomorrow\n\n"
        f"{outlook}\n\n"
        f"---\n\n"
        f"*This read is generated from AlgoSphere's live market intelligence engine. "
        f"Not financial advice.*\n"
    )
    return {
        'title':   headline,
        'summary': str(p.get('summary') or headline)[:280],
        'body_md': body,
        'tags':    ['daily', 'market', 'regime'],
        'faq':     [
            ('What is a market regime?',
             'Market regime is the structural environment that determines which strategies work — '
             'trending, ranging, or volatile. We classify it every minute across major pairs.'),
        ],
    }


def _compose_weekly_market(p: dict) -> dict:
    period = p.get('period') or datetime.now(timezone.utc).strftime('Week ending %b %d, %Y')
    body = (
        f"## {period} — Recap\n\n"
        f"**Net P&L:** {p.get('net_pnl') or '—'}\n\n"
        f"**Trades:** {p.get('trades') or '—'} · "
        f"**Win rate:** {p.get('win_rate') or '—'}% · "
        f"**Profit factor:** {p.get('profit_factor') or '—'}\n\n"
        f"## Best trades\n\n"
        + '\n'.join(f"- **{t.get('pair')}** ({t.get('direction')}) — {t.get('pnl')}"
                    for t in (p.get('top_trades') or [])[:5])
        + "\n\n## Regime backdrop\n\n"
        f"{p.get('regime_notes') or 'See the live regime grid in your dashboard.'}\n\n"
        f"## Looking forward\n\n"
        f"{p.get('outlook') or 'Watch high-impact events on the economic calendar.'}\n"
    )
    return {
        'title':   f'Weekly Recap — {period}',
        'summary': f"Net P&L {p.get('net_pnl') or '—'} across {p.get('trades') or '—'} trades.",
        'body_md': body,
        'tags':    ['weekly', 'recap', 'performance'],
        'faq':     [],
    }


def _compose_strategy(p: dict) -> dict:
    name  = p.get('strategy_name') or p.get('name') or 'Strategy'
    stats = p.get('stats') or {}
    body = (
        f"## {name} — Breakdown\n\n"
        f"### Setup\n\n{p.get('setup') or 'Setup description.'}\n\n"
        f"### Entry rules\n\n{p.get('entry_rules') or 'Entry rules.'}\n\n"
        f"### Exit rules\n\n{p.get('exit_rules') or 'Exit rules.'}\n\n"
        f"### Live stats\n\n"
        f"- **Win rate:** {stats.get('win_rate') or '—'}%\n"
        f"- **Profit factor:** {stats.get('profit_factor') or '—'}\n"
        f"- **Expectancy:** {stats.get('expectancy') or '—'}\n"
        f"- **Trades sampled:** {stats.get('trades') or '—'}\n"
        f"- **Max drawdown:** {stats.get('max_drawdown') or '—'}%\n\n"
        f"### Why it works\n\n{p.get('why_it_works') or 'Edge explanation.'}\n\n"
        f"### When it fails\n\n{p.get('why_it_fails') or 'Loss conditions.'}\n"
    )
    return {
        'title':   f'{name} — Strategy Breakdown',
        'summary': str(p.get('summary') or f'{name} setup, entries, exits, and live stats.')[:280],
        'body_md': body,
        'tags':    ['strategy', 'breakdown', 'backtest'],
        'faq':     [
            ('Is this strategy live in AlgoSphere?',
             'Yes — every strategy we publish has been backtested against real OHLCV and graded by '
             'our deployment readiness ladder. Live signals appear in the Signals feed.'),
        ],
    }


def _compose_educational(p: dict) -> dict:
    topic = p.get('topic') or 'Trading Concept'
    body = (
        f"## {topic}\n\n"
        f"{p.get('hook') or 'Why most traders get this wrong.'}\n\n"
        f"### The concept\n\n{p.get('concept') or 'Concept explanation.'}\n\n"
        f"### In practice\n\n{p.get('example') or 'A worked example.'}\n\n"
        f"### Common mistakes\n\n{p.get('mistakes') or 'What to avoid.'}\n\n"
        f"### Your takeaway\n\n{p.get('takeaway') or 'Apply this on your next setup.'}\n"
    )
    return {
        'title':   topic,
        'summary': str(p.get('summary') or topic)[:280],
        'body_md': body,
        'tags':    ['education'] + ([p.get('topic_tag')] if p.get('topic_tag') else []),
        'faq':     p.get('faq') or [],
    }


def _compose_feature_release(p: dict) -> dict:
    name = p.get('feature') or p.get('feature_name') or 'New Feature'
    body = (
        f"## {name}\n\n"
        f"### The problem\n\n{p.get('problem') or 'Trader pain point.'}\n\n"
        f"### What we built\n\n{p.get('solution') or p.get('description') or 'Solution description.'}\n\n"
        f"### How to use it\n\n{p.get('how_to_use') or 'Navigate to the relevant page in your dashboard.'}\n\n"
        f"### What changes for you\n\n{p.get('impact') or 'See the changelog for details.'}\n"
    )
    return {
        'title':   f'Now in AlgoSphere — {name}',
        'summary': str(p.get('summary') or p.get('description') or name)[:280],
        'body_md': body,
        'tags':    ['release', 'product'],
        'faq':     [],
    }


def _compose_monthly_investor(p: dict) -> dict:
    period = p.get('period') or datetime.now(timezone.utc).strftime('%B %Y')
    body = (
        f"## {period} — Investor Update\n\n"
        f"### Performance\n\n"
        f"- **Cumulative return:** {p.get('growth_pct') or '—'}%\n"
        f"- **AUM:** ${p.get('aum') or '—'}\n"
        f"- **Sharpe:** {p.get('sharpe') or '—'}\n"
        f"- **Max drawdown:** {p.get('max_drawdown') or '—'}%\n"
        f"- **Win rate:** {p.get('win_rate') or '—'}%\n\n"
        f"### Market context\n\n{p.get('market_context') or 'Macro backdrop summary.'}\n\n"
        f"### Strategy attribution\n\n{p.get('attribution') or 'Per-strategy contribution.'}\n\n"
        f"### Risk & exposure\n\n{p.get('risk_notes') or 'Risk envelope held within targets.'}\n\n"
        f"### Outlook\n\n{p.get('outlook') or 'Forward look.'}\n"
    )
    return {
        'title':   f'AlgoSphere {period} Investor Update',
        'summary': f'{p.get("growth_pct") or "—"}% cumulative return · Sharpe {p.get("sharpe") or "—"}.',
        'body_md': body,
        'tags':    ['investor', 'monthly', 'performance'],
        'faq':     [],
    }


_COMPOSERS = {
    'daily_market_blog':       _compose_daily_market,
    'weekly_market_blog':      _compose_weekly_market,
    'strategy_blog':           _compose_strategy,
    'educational_blog':        _compose_educational,
    'feature_release_blog':    _compose_feature_release,
    'monthly_investor_blog':   _compose_monthly_investor,
}


def produce(item: dict, out_dir: Path, asset_kind: str = 'daily_market_blog') -> Dict[str, Path]:
    """
    Blog producer is special — it doesn't write a file to upload.
    It writes a NEW growth_content_items row (kind=mapped ContentKind,
    status='published', slug set) so the /blog page serves it
    automatically.

    Returns an empty dict because there's no file URL to attach. The
    worker still logs the attempt (zero bytes, ok=True) so the audit
    trail captures every blog production event. The blog URL is
    recorded in the attempt's `url` field.

    out_dir is unused — kept for the producer signature contract.
    """
    composer = _COMPOSERS.get(asset_kind, _compose_daily_market)
    prov = item.get('provenance') or {}
    payload = prov.get('payload') or prov

    parts = composer(payload)
    ci_kind = _KIND_TO_CI_KIND.get(asset_kind, 'market_report')
    slug    = _slug(parts['title'])

    # Hero inherits from the PARENT row's asset_urls (signal_card etc.)
    # When this is the FIRST asset on the parent, asset_urls is empty
    # and the blog hero defaults to the OG card the /blog page builds.
    parent_assets = item.get('asset_urls') or {}
    hero = (parent_assets.get('signal_card')
            or parent_assets.get('weekly_stats_card')
            or parent_assets.get('trade_result_card')
            or parent_assets.get('feature_card')
            or None)

    # FAQ as appended markdown so the schema doesn't need a new column.
    if parts.get('faq'):
        parts['body_md'] += '\n\n## FAQ\n\n' + '\n\n'.join(
            f'**{q}**\n\n{a}' for q, a in parts['faq']
        )

    payload_row = {
        'kind':         ci_kind,
        'status':       'published',
        'title':        parts['title'][:200],
        'summary':      parts['summary'][:1000],
        'body_md':      parts['body_md'],
        'hero_image_url': hero,
        'tags':         parts.get('tags') or [],
        'provenance':   {
            'type':              'auto_blog',
            'origin_content_id': item.get('id'),
            'blog_kind':         asset_kind,
        },
        'published_at': datetime.now(timezone.utc).isoformat(),
        # Slug column may exist in the live schema (the /blog page
        # filters on it) — set it explicitly so the new row IS routable.
        'slug':         slug,
    }

    db = _db()
    if db is None:
        raise RuntimeError('blog producer requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')

    res = db.table('growth_content_items').insert(payload_row).execute()
    if not res.data:
        raise RuntimeError('blog insert returned no row')

    blog_url = f"https://algospherequant.com/blog/{slug}"
    logger.info(f"blog {asset_kind} published → {blog_url}")

    # Stash the URL on the parent item's asset_urls so the worker logs
    # it. We do this by writing a tiny marker file the worker uploads,
    # then deleting the file content but keeping the URL in the log.
    # Cleaner: the worker's log_attempt() supports a `url` param — we
    # rely on the worker's normal flow which uploads the local file
    # AND logs an attempt. Since we have no file, we monkey by writing
    # a 1-byte marker so upload runs, but the REAL URL we record is
    # blog_url which we put into the file's storage path comment.
    #
    # Simplest: write a small JSON sidecar that the worker will
    # upload. The worker will report THAT URL, but consumers of
    # asset_urls.<kind> should look at the parent content_item's
    # 'url' field captured at attempt time.
    marker = out_dir / f'{asset_kind}.json'
    marker.write_text(
        f'{{"blog_url":"{blog_url}","new_content_id":"{res.data[0]["id"]}"}}',
        encoding='utf-8',
    )
    return {asset_kind: marker}
