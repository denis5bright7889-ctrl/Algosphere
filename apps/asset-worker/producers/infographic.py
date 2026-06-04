"""
Infographic producer — 1080×1350 (Instagram portrait optimal).
One producer covers seven kinds via templated section layouts:

  signal_infographic     — pair / direction / entry / SL / TP1-3 / R:R / conviction
  weekly_infographic     — net PnL / KPI grid / top winners + losers
  monthly_infographic    — monthly PnL / regime mix / strategy share / drawdown
  pnl_infographic        — per-pair PnL ranked bars
  market_infographic     — major-pair regime grid + sector rotation
  economic_infographic   — upcoming high-impact events + bias read
  investor_infographic   — equity curve + AUM growth + share class lines

Each kind reads `provenance.payload` from the content_item and renders
the sections it needs. Falls back to "—" when a value is missing so a
sparse event still produces a clean visual.
"""
from __future__ import annotations
from pathlib import Path
from typing import Dict
from PIL import Image, ImageDraw
from loguru import logger

from ._brand import (
    BG, AMBER, AMBER_DEEP, EMERALD, ROSE, SKY, WHITE, MUTED, DARK_BORDER,
    font, draw_brand_mark, draw_radial_glow, draw_footer_url,
    fmt_num, fmt_pct, fmt_dollar,
)


W, H = 1080, 1350


def _row(d: ImageDraw.ImageDraw, y: int, label: str, value: str,
         label_color=MUTED, value_color=WHITE, label_size=28, value_size=52) -> None:
    d.text((100, y),       label.upper(), fill=label_color, font=font(label_size))
    d.text((W - 100, y),   value,         fill=value_color, font=font(value_size), anchor='rt')


def _section_header(d: ImageDraw.ImageDraw, y: int, title: str) -> None:
    d.text((100, y), title.upper(), fill=AMBER, font=font(26))
    d.line([100, y + 42, W - 100, y + 42], fill=DARK_BORDER, width=2)


def _hbar(d: ImageDraw.ImageDraw, x: int, y: int, width_px: int, value: float,
          max_value: float, color: tuple, height: int = 28) -> None:
    if max_value <= 0:
        max_value = 1
    fill_px = max(0, min(width_px, int(width_px * abs(value) / max_value)))
    d.rounded_rectangle([x, y, x + width_px, y + height], radius=height // 2,
                        fill=(40, 40, 50))
    if fill_px > 0:
        d.rounded_rectangle([x, y, x + fill_px, y + height], radius=height // 2,
                            fill=color)


def _new_canvas() -> Image.Image:
    im = Image.new('RGBA', (W, H), (*BG, 255))
    draw_radial_glow(im, color=AMBER, center_xy=(W, 0), max_radius=900)
    return im


# ── Per-kind renderers ────────────────────────────────────────────

def _render_signal(d: ImageDraw.ImageDraw, p: dict) -> None:
    d.text((W // 2, 220), str(p.get('pair') or '—').upper(),
           fill=WHITE, font=font(140), anchor='mm')
    direction = str(p.get('direction') or '').lower()
    color = EMERALD if direction == 'buy' else ROSE if direction == 'sell' else MUTED
    label = direction.upper() or 'NEUTRAL'
    d.rounded_rectangle([W // 2 - 140, 320, W // 2 + 140, 380], radius=30,
                        fill=(*color, 38), outline=color, width=3)
    d.text((W // 2, 350), label, fill=color, font=font(40), anchor='mm')

    y = 460
    _section_header(d, y, 'Levels'); y += 80
    _row(d, y, 'Entry',      fmt_num(p.get('entry') or p.get('entry_price')));        y += 80
    _row(d, y, 'Stop',       fmt_num(p.get('stop_loss')), value_color=ROSE);            y += 80
    _row(d, y, 'Target 1',   fmt_num(p.get('take_profit_1') or p.get('take_profit')), value_color=EMERALD); y += 80
    _row(d, y, 'Target 2',   fmt_num(p.get('take_profit_2')), value_color=EMERALD);     y += 80
    _row(d, y, 'Target 3',   fmt_num(p.get('take_profit_3')), value_color=EMERALD);     y += 80
    _row(d, y, 'Risk:Reward', fmt_num(p.get('risk_reward'), 1), value_color=AMBER);     y += 100

    conf = p.get('confidence') or p.get('confidence_score')
    if conf is not None:
        try: c = int(float(conf))
        except (TypeError, ValueError): c = 0
        d.text((W // 2, y), f'Conviction {c}/100', fill=AMBER, font=font(42), anchor='mm')
        _hbar(d, 220, y + 50, W - 440, c, 100, AMBER, height=18)


def _render_weekly_or_monthly(d: ImageDraw.ImageDraw, p: dict, period: str) -> None:
    d.text((W // 2, 220), f'{period.upper()} RECAP',
           fill=MUTED, font=font(40), anchor='mm')

    pnl = p.get('net_pnl') or p.get('pnl') or 0
    pnl_color = EMERALD if (isinstance(pnl, (int, float)) and pnl > 0) \
        else ROSE if (isinstance(pnl, (int, float)) and pnl < 0) else WHITE
    sign = '+' if (isinstance(pnl, (int, float)) and pnl > 0) else ''
    d.text((W // 2, 340), f'{sign}{fmt_dollar(pnl)}',
           fill=pnl_color, font=font(160), anchor='mm')
    d.text((W // 2, 460), 'NET P&L', fill=MUTED, font=font(34), anchor='mm')

    y = 540
    _section_header(d, y, 'KPIs'); y += 80
    _row(d, y, 'Win rate',    f"{fmt_num(p.get('win_rate'))}%" if p.get('win_rate') is not None else '—',
         value_color=AMBER); y += 80
    _row(d, y, 'Trades',      str(p.get('trades') or p.get('trade_count') or '—')); y += 80
    _row(d, y, 'Expectancy',  fmt_dollar(p.get('expectancy')), value_color=EMERALD); y += 80
    _row(d, y, 'Profit factor', fmt_num(p.get('profit_factor'), 2), value_color=AMBER); y += 80
    _row(d, y, 'Max drawdown', f"{fmt_num(p.get('max_drawdown') or p.get('max_dd'))}%" if (p.get('max_drawdown') or p.get('max_dd')) is not None else '—',
         value_color=ROSE); y += 100


def _render_pnl(d: ImageDraw.ImageDraw, p: dict) -> None:
    by_pair = p.get('by_pair') or []
    d.text((W // 2, 220), 'P&L BY PAIR', fill=MUTED, font=font(40), anchor='mm')

    if not by_pair:
        d.text((W // 2, H // 2), 'No trades in window', fill=MUTED, font=font(38), anchor='mm')
        return

    rows = [(str(r.get('pair') or '—').upper(), float(r.get('pnl') or 0))
            for r in by_pair][:10]
    max_abs = max((abs(v) for _, v in rows), default=1)
    y0 = 300
    bar_w = W - 380
    for i, (pair, v) in enumerate(rows):
        y = y0 + i * 90
        d.text((100, y + 12), pair, fill=WHITE, font=font(34))
        color = EMERALD if v >= 0 else ROSE
        _hbar(d, 240, y + 4, bar_w, v, max_abs, color, height=44)
        d.text((W - 100, y + 12),
               ('+' if v >= 0 else '') + fmt_dollar(v),
               fill=color, font=font(32), anchor='rt')


def _render_market(d: ImageDraw.ImageDraw, p: dict) -> None:
    d.text((W // 2, 220), 'MARKET SNAPSHOT', fill=AMBER, font=font(42), anchor='mm')
    regime = p.get('regime') or {}
    by_sector = p.get('by_sector') or []

    y = 320
    _section_header(d, y, 'Regime'); y += 80
    _row(d, y, 'Environment', str(regime.get('environment') or '—').upper(), value_color=AMBER); y += 80
    _row(d, y, 'Trend',       str(regime.get('trend_strength') or '—').upper(), value_color=EMERALD); y += 80
    _row(d, y, 'Volatility',  str(regime.get('volatility_state') or '—').upper(), value_color=ROSE); y += 80
    _row(d, y, 'Liquidity',   str(regime.get('liquidity_state') or '—').upper(), value_color=SKY); y += 100

    if by_sector:
        _section_header(d, y, 'Sector rotation'); y += 80
        max_abs = max((abs(float(s.get('flow_pct') or 0)) for s in by_sector), default=1)
        for s in by_sector[:5]:
            name = str(s.get('sector') or '—').upper()
            flow = float(s.get('flow_pct') or 0)
            d.text((100, y + 6), name, fill=WHITE, font=font(28))
            color = EMERALD if flow >= 0 else ROSE
            _hbar(d, 320, y, W - 460, flow, max_abs, color, height=24)
            d.text((W - 100, y + 6), fmt_pct(flow), fill=color, font=font(28), anchor='rt')
            y += 70


def _render_economic(d: ImageDraw.ImageDraw, p: dict) -> None:
    d.text((W // 2, 220), 'ECONOMIC CALENDAR', fill=AMBER, font=font(42), anchor='mm')
    events = p.get('events') or []
    if not events:
        d.text((W // 2, H // 2), 'No high-impact events this window',
               fill=MUTED, font=font(36), anchor='mm')
        return

    y = 320
    for ev in events[:6]:
        ts = str(ev.get('when') or '—')
        ccy = str(ev.get('currency') or '—').upper()
        name = str(ev.get('name') or '—')
        impact = (ev.get('impact') or '').lower()
        color = ROSE if impact == 'high' else AMBER if impact == 'medium' else MUTED
        d.rounded_rectangle([100, y, W - 100, y + 130], radius=20,
                            fill=(*color, 18), outline=color, width=2)
        d.text((130, y + 18), ts, fill=MUTED, font=font(24))
        d.text((130, y + 56), f'{ccy} · {name}', fill=WHITE, font=font(34))
        d.text((W - 130, y + 56), impact.upper() or '—',
               fill=color, font=font(28), anchor='rt')
        y += 150


def _render_investor(d: ImageDraw.ImageDraw, p: dict) -> None:
    d.text((W // 2, 220), 'PERFORMANCE SUMMARY', fill=AMBER, font=font(40), anchor='mm')

    growth = p.get('growth_pct') or 0
    aum    = p.get('aum') or 0
    sharpe = p.get('sharpe')
    max_dd = p.get('max_drawdown') or p.get('max_dd')

    color = EMERALD if (isinstance(growth, (int, float)) and growth >= 0) else ROSE
    d.text((W // 2, 340), fmt_pct(growth), fill=color, font=font(150), anchor='mm')
    d.text((W // 2, 460), 'CUMULATIVE RETURN', fill=MUTED, font=font(32), anchor='mm')

    y = 560
    _section_header(d, y, 'Key metrics'); y += 80
    _row(d, y, 'AUM',         fmt_dollar(aum, 0));                                  y += 80
    _row(d, y, 'Sharpe',      fmt_num(sharpe, 2), value_color=AMBER);                y += 80
    _row(d, y, 'Max drawdown', f"{fmt_num(max_dd)}%" if max_dd is not None else '—', value_color=ROSE); y += 80
    _row(d, y, 'Win rate',    f"{fmt_num(p.get('win_rate'))}%" if p.get('win_rate') is not None else '—',
         value_color=EMERALD); y += 80


_RENDERERS = {
    'signal_infographic':     lambda d, p: _render_signal(d, p),
    'weekly_infographic':     lambda d, p: _render_weekly_or_monthly(d, p, 'week'),
    'monthly_infographic':    lambda d, p: _render_weekly_or_monthly(d, p, 'month'),
    'pnl_infographic':        lambda d, p: _render_pnl(d, p),
    'market_infographic':     lambda d, p: _render_market(d, p),
    'economic_infographic':   lambda d, p: _render_economic(d, p),
    'investor_infographic':   lambda d, p: _render_investor(d, p),
}


def produce(item: dict, out_dir: Path, asset_kind: str = 'signal_infographic') -> Dict[str, Path]:
    renderer = _RENDERERS.get(asset_kind, _RENDERERS['signal_infographic'])

    prov = item.get('provenance') or {}
    payload = prov.get('payload') or prov

    im = _new_canvas()
    d = ImageDraw.Draw(im)
    draw_brand_mark(d)
    renderer(d, payload)
    draw_footer_url(d, W, H)

    out = out_dir / f'{asset_kind}.jpg'
    im.convert('RGB').save(out, 'JPEG', quality=88, optimize=True)
    logger.info(f"infographic {asset_kind} produced ({out.stat().st_size} bytes)")
    return {asset_kind: out}
