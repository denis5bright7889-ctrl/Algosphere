"""
Weekly stats card — variant of signal_card that renders aggregate
KPIs (win rate, trades, expectancy, max DD) from a content_item
whose provenance carries a weekly performance summary.

Same 1080x1080 layout / brand palette as signal_card.
"""
from pathlib import Path
from typing import Dict
from PIL import Image, ImageDraw, ImageFont
from loguru import logger

from .signal_card import _font, _draw_brand_mark, _draw_radial_glow, _fmt_num
from .signal_card import BG, AMBER, EMERALD, ROSE, WHITE, MUTED, W, H


def produce(item: dict, out_dir: Path) -> Dict[str, Path]:
    prov = item.get('provenance') or {}
    payload = prov.get('payload') or prov

    win_rate    = payload.get('win_rate')
    trades      = payload.get('trades') or payload.get('trade_count')
    expectancy  = payload.get('expectancy')
    max_dd      = payload.get('max_drawdown') or payload.get('max_dd')
    net_pnl     = payload.get('net_pnl') or payload.get('pnl')
    period      = str(payload.get('period') or 'week').upper()

    im = Image.new('RGBA', (W, H), (*BG, 255))
    _draw_radial_glow(im)
    d  = ImageDraw.Draw(im)

    _draw_brand_mark(d)

    # Header
    d.text((W // 2, 200), f'{period} RECAP', fill=MUTED, font=_font(40), anchor='mm')

    # Net PnL — hero number
    pnl_color = EMERALD if (isinstance(net_pnl, (int, float)) and net_pnl > 0) \
        else ROSE if (isinstance(net_pnl, (int, float)) and net_pnl < 0) \
        else WHITE
    sign = '+' if (isinstance(net_pnl, (int, float)) and net_pnl > 0) else ''
    d.text((W // 2, 360), f'{sign}{_fmt_num(net_pnl)}', fill=pnl_color,
           font=_font(170), anchor='mm')
    d.text((W // 2, 480), 'NET P&L', fill=MUTED, font=_font(34), anchor='mm')

    # KPI grid — 2x2 below the hero
    grid_top = 580
    grid_x   = [W // 4, 3 * W // 4]
    grid_y   = [grid_top, grid_top + 140]

    cells = [
        ('WIN RATE',   f'{_fmt_num(win_rate)}%' if win_rate is not None else '—', AMBER),
        ('TRADES',     f'{trades}'              if trades is not None else '—', WHITE),
        ('EXPECTANCY', _fmt_num(expectancy),                                   EMERALD),
        ('MAX DD',     f'{_fmt_num(max_dd)}%'   if max_dd is not None else '—', ROSE),
    ]
    for i, (label, value, color) in enumerate(cells):
        cx = grid_x[i % 2]
        cy = grid_y[i // 2]
        d.text((cx, cy),       label, fill=MUTED, font=_font(28), anchor='mm')
        d.text((cx, cy + 60),  value, fill=color, font=_font(70), anchor='mm')

    # URL footer
    d.text((W // 2, H - 70), 'algospherequant.com',
           fill=AMBER, font=_font(34), anchor='mm')

    out = out_dir / 'weekly_stats_card.jpg'
    im.convert('RGB').save(out, 'JPEG', quality=88, optimize=True)
    logger.info(f"weekly_stats produced {out.name} ({out.stat().st_size} bytes)")
    return {'weekly_stats_card': out}
