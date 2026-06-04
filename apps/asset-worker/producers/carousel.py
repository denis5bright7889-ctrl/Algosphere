"""
Carousel producer — 3-10 slides per content_item, 1080x1350 each
(Instagram portrait optimal). Five kinds dispatched by name:

  educational_carousel       — 5 slides: hook / concept / example / takeaway / CTA
  strategy_breakdown_carousel — 6 slides: name / setup / entry / exit / stats / CTA
  weekly_recap_carousel       — 5 slides: hero PnL / KPIs / top trades / regime / CTA
  market_recap_carousel       — 5 slides: hero quote / regime / sectors / events / CTA
  feature_release_carousel    — 4 slides: hero / problem / solution / CTA

Each slide is uploaded individually; the worker's batch upload picks
them up under produced kind `<asset_kind>_slide_N`. The IG adapter
then composes them into a carousel post by reading consecutive slides
from asset_urls.

Auto-publish wire: when an automation rule lists a carousel asset_kind,
the scheduler reads asset_urls['<kind>_slide_0'] as the hero (single
image), AND attaches the full slide list as `media_urls` so the IG
adapter switches into carousel mode.
"""
from __future__ import annotations
from pathlib import Path
from typing import Dict, List, Callable
from PIL import Image, ImageDraw
from loguru import logger

from ._brand import (
    BG, AMBER, AMBER_DEEP, EMERALD, ROSE, SKY, WHITE, MUTED, DARK_BORDER,
    font, draw_brand_mark, draw_radial_glow, draw_footer_url,
    fmt_num, fmt_pct, fmt_dollar,
)


W, H = 1080, 1350


def _new_canvas(glow_color=AMBER, glow_xy=(W, 0)) -> Image.Image:
    im = Image.new('RGBA', (W, H), (*BG, 255))
    draw_radial_glow(im, color=glow_color, center_xy=glow_xy, max_radius=900)
    return im


def _page_pill(d: ImageDraw.ImageDraw, idx: int, total: int) -> None:
    """Top-right slide indicator (e.g. 3 / 5)."""
    text = f'{idx + 1} / {total}'
    d.rounded_rectangle([W - 200, 50, W - 60, 100], radius=25,
                        fill=(*AMBER, 30), outline=AMBER, width=2)
    d.text((W - 130, 75), text, fill=AMBER, font=font(28), anchor='mm')


def _slide_shell(idx: int, total: int, glow_color=AMBER) -> tuple:
    im = _new_canvas(glow_color=glow_color)
    d = ImageDraw.Draw(im)
    draw_brand_mark(d)
    _page_pill(d, idx, total)
    return im, d


def _wrapped(d: ImageDraw.ImageDraw, x: int, y: int, text: str,
             max_w: int, font_obj, line_h: int = 60,
             fill=WHITE, anchor='lm') -> int:
    """Crude word-wrap that respects max_w. Returns the y of the next
    line below the last rendered line. Centered or left depending on
    anchor."""
    words = (text or '').split()
    if not words:
        return y
    lines: List[str] = []
    cur = words[0]
    for w in words[1:]:
        trial = f'{cur} {w}'
        bbox = d.textbbox((0, 0), trial, font=font_obj)
        if bbox[2] - bbox[0] > max_w:
            lines.append(cur); cur = w
        else:
            cur = trial
    lines.append(cur)
    yy = y
    for ln in lines:
        d.text((x, yy), ln, fill=fill, font=font_obj, anchor=anchor)
        yy += line_h
    return yy


def _slide_title_only(idx: int, total: int, title: str, subtitle: str = '',
                      glow_color=AMBER) -> Image.Image:
    im, d = _slide_shell(idx, total, glow_color)
    _wrapped(d, W // 2, 480, title, W - 200, font(90),
             line_h=110, fill=WHITE, anchor='mm')
    if subtitle:
        _wrapped(d, W // 2, 880, subtitle, W - 200, font(38),
                 line_h=55, fill=MUTED, anchor='mm')
    draw_footer_url(d, W, H)
    return im


def _slide_numbered_bullet(idx: int, total: int, label: str, headline: str,
                            sub: str = '', color=AMBER) -> Image.Image:
    im, d = _slide_shell(idx, total, glow_color=color)
    d.text((W // 2, 260), label.upper(), fill=color, font=font(36), anchor='mm')
    _wrapped(d, W // 2, 420, headline, W - 200, font(78),
             line_h=98, fill=WHITE, anchor='mm')
    if sub:
        _wrapped(d, W // 2, 880, sub, W - 200, font(32),
                 line_h=48, fill=MUTED, anchor='mm')
    draw_footer_url(d, W, H)
    return im


def _slide_cta(idx: int, total: int, headline: str, cta_text: str = 'Free trial',
               url: str = 'algospherequant.com') -> Image.Image:
    im, d = _slide_shell(idx, total, glow_color=AMBER)
    _wrapped(d, W // 2, 480, headline, W - 200, font(72),
             line_h=92, fill=WHITE, anchor='mm')
    btn_w, btn_h = 600, 110
    bx = (W - btn_w) // 2
    by = 800
    d.rounded_rectangle([bx, by, bx + btn_w, by + btn_h], radius=55,
                        fill=AMBER)
    d.text((W // 2, by + btn_h // 2), cta_text.upper(), fill=BG, font=font(46), anchor='mm')
    d.text((W // 2, 980), url, fill=AMBER, font=font(34), anchor='mm')
    d.text((W // 2, H - 80), 'LINK IN BIO', fill=MUTED, font=font(28), anchor='mm')
    return im


def _slide_metrics(idx: int, total: int, title: str, metrics: List[tuple]) -> Image.Image:
    """metrics = list of (label, value, color)."""
    im, d = _slide_shell(idx, total, glow_color=AMBER)
    d.text((W // 2, 260), title.upper(), fill=AMBER, font=font(36), anchor='mm')
    y = 400
    for label, value, color in metrics[:6]:
        d.text((100, y),       label.upper(), fill=MUTED, font=font(30))
        d.text((W - 100, y),   str(value),    fill=color, font=font(60), anchor='rt')
        y += 110
    draw_footer_url(d, W, H)
    return im


# ── Per-kind slide builders ───────────────────────────────────────

def _educational(p: dict) -> List[Image.Image]:
    topic    = str(p.get('topic') or 'TRADING CONCEPT').upper()
    hook     = str(p.get('hook') or p.get('title') or 'Most traders get this wrong')
    concept  = str(p.get('concept') or 'A trading concept explained.')
    example  = str(p.get('example') or 'Here is how it plays out in real trading.')
    takeaway = str(p.get('takeaway') or 'Apply this on your next setup.')
    return [
        _slide_title_only(0, 5, hook, topic, glow_color=AMBER),
        _slide_numbered_bullet(1, 5, 'Concept', concept, color=SKY),
        _slide_numbered_bullet(2, 5, 'In Practice', example, color=EMERALD),
        _slide_numbered_bullet(3, 5, 'Takeaway', takeaway, color=AMBER),
        _slide_cta(4, 5, 'Learn more on AlgoSphere'),
    ]


def _strategy_breakdown(p: dict) -> List[Image.Image]:
    name   = str(p.get('strategy_name') or p.get('name') or 'Strategy').upper()
    setup  = str(p.get('setup') or 'Setup description.')
    entry  = str(p.get('entry_rules') or 'Entry rules description.')
    exitr  = str(p.get('exit_rules') or 'Exit rules description.')
    stats  = p.get('stats') or {}
    return [
        _slide_title_only(0, 6, name, 'STRATEGY BREAKDOWN', glow_color=AMBER),
        _slide_numbered_bullet(1, 6, 'Setup',  setup,  color=SKY),
        _slide_numbered_bullet(2, 6, 'Entry',  entry,  color=EMERALD),
        _slide_numbered_bullet(3, 6, 'Exit',   exitr,  color=ROSE),
        _slide_metrics(4, 6, 'Live performance', [
            ('Win rate',     f"{fmt_num(stats.get('win_rate'))}%" if stats.get('win_rate') is not None else '—', AMBER),
            ('Profit factor', fmt_num(stats.get('profit_factor'), 2),                                          EMERALD),
            ('Expectancy',    fmt_dollar(stats.get('expectancy')),                                              EMERALD),
            ('Trades',        str(stats.get('trades') or '—'),                                                   WHITE),
            ('Max DD',        f"{fmt_num(stats.get('max_drawdown'))}%" if stats.get('max_drawdown') is not None else '—', ROSE),
        ]),
        _slide_cta(5, 6, 'Trade this strategy on AlgoSphere'),
    ]


def _weekly_recap(p: dict) -> List[Image.Image]:
    pnl       = p.get('net_pnl') or p.get('pnl') or 0
    pnl_color = EMERALD if (isinstance(pnl, (int, float)) and pnl > 0) else \
                ROSE if (isinstance(pnl, (int, float)) and pnl < 0) else WHITE
    sign      = '+' if (isinstance(pnl, (int, float)) and pnl > 0) else ''
    top_trades = p.get('top_trades') or []
    return [
        _slide_title_only(0, 5, f'{sign}{fmt_dollar(pnl)}', 'WEEKLY P&L', glow_color=AMBER),
        _slide_metrics(1, 5, 'Key metrics', [
            ('Win rate',    f"{fmt_num(p.get('win_rate'))}%" if p.get('win_rate') is not None else '—', AMBER),
            ('Trades',      str(p.get('trades') or '—'),                                               WHITE),
            ('Expectancy',  fmt_dollar(p.get('expectancy')),                                            EMERALD),
            ('Profit factor', fmt_num(p.get('profit_factor'), 2),                                       AMBER),
            ('Max DD',       f"{fmt_num(p.get('max_drawdown'))}%" if p.get('max_drawdown') is not None else '—', ROSE),
        ]),
        _slide_metrics(2, 5, 'Top trades', [
            (str(t.get('pair') or '—'), fmt_dollar(t.get('pnl')),
             EMERALD if (float(t.get('pnl') or 0)) >= 0 else ROSE)
            for t in (top_trades[:5] or [])
        ] or [('—', '—', MUTED)]),
        _slide_numbered_bullet(3, 5, 'Regime',
                               str(p.get('regime') or 'Mixed'),
                               color=SKY),
        _slide_cta(4, 5, 'Get next week\'s signals'),
    ]


def _market_recap(p: dict) -> List[Image.Image]:
    hook   = str(p.get('headline') or 'Markets recap')
    regime = p.get('regime') or {}
    sectors = p.get('sectors') or []
    events = p.get('events') or []
    return [
        _slide_title_only(0, 5, hook, 'MARKETS THIS WEEK', glow_color=AMBER),
        _slide_metrics(1, 5, 'Regime', [
            ('Environment', str(regime.get('environment') or '—').upper(), AMBER),
            ('Trend',       str(regime.get('trend_strength') or '—').upper(), EMERALD),
            ('Volatility',  str(regime.get('volatility_state') or '—').upper(), ROSE),
            ('Liquidity',   str(regime.get('liquidity_state') or '—').upper(), SKY),
        ]),
        _slide_metrics(2, 5, 'Sector rotation', [
            (str(s.get('sector') or '—'),
             fmt_pct(s.get('flow_pct')),
             EMERALD if (float(s.get('flow_pct') or 0)) >= 0 else ROSE)
            for s in (sectors[:5] or [('—', 0)])
        ]),
        _slide_metrics(3, 5, 'Upcoming high-impact', [
            (str(ev.get('when') or '—')[:18],
             f"{(ev.get('currency') or '')} {(ev.get('name') or '')[:18]}",
             ROSE if (ev.get('impact') == 'high') else AMBER)
            for ev in (events[:5] or [('—', '—', MUTED)])
        ]),
        _slide_cta(4, 5, 'Trade with the regime'),
    ]


def _feature_release(p: dict) -> List[Image.Image]:
    name        = str(p.get('feature') or p.get('feature_name') or 'New Feature').upper()
    problem     = str(p.get('problem') or 'A trader pain point.')
    solution    = str(p.get('solution') or p.get('description') or 'What AlgoSphere now does.')
    return [
        _slide_title_only(0, 4, name, 'NEW IN ALGOSPHERE', glow_color=SKY),
        _slide_numbered_bullet(1, 4, 'The problem', problem, color=ROSE),
        _slide_numbered_bullet(2, 4, 'What we built', solution, color=EMERALD),
        _slide_cta(3, 4, 'Try it now', cta_text='Open AlgoSphere'),
    ]


_BUILDERS: Dict[str, Callable[[dict], List[Image.Image]]] = {
    'educational_carousel':         _educational,
    'strategy_breakdown_carousel':  _strategy_breakdown,
    'weekly_recap_carousel':        _weekly_recap,
    'market_recap_carousel':        _market_recap,
    'feature_release_carousel':     _feature_release,
}


def produce(item: dict, out_dir: Path, asset_kind: str = 'educational_carousel') -> Dict[str, Path]:
    builder = _BUILDERS.get(asset_kind, _educational)
    prov = item.get('provenance') or {}
    payload = prov.get('payload') or prov

    slides = builder(payload)
    out: Dict[str, Path] = {}
    for i, im in enumerate(slides):
        path = out_dir / f'{asset_kind}_slide_{i}.jpg'
        im.convert('RGB').save(path, 'JPEG', quality=88, optimize=True)
        out[f'{asset_kind}_slide_{i}'] = path
    logger.info(f"carousel {asset_kind} produced {len(slides)} slides")
    return out
