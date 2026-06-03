"""
Signal / trade / weekly result card — PIL-rendered 1080x1080 JPEG.

One producer, three kinds (signal_card, trade_entry_card,
trade_result_card). The variant is detected from the row's kind +
provenance payload — e.g. a content_item generated from a
signal.published event carries the signal id, pair, direction, entry,
SL, TP and confidence under provenance.

Output: 1080x1080 JPEG @ 88% quality. IG-compatible.

Visual:
    [AlgoSphere brand mark — amber, top]
    [Pair badge — large, white]
    [Direction pill — green/red]
    [Numbers grid — entry / stop / tp1 / r:r]
    [Confidence dial — bottom-right]
    [URL — bottom centred]
"""
from pathlib import Path
from typing import Dict
from PIL import Image, ImageDraw, ImageFont
from loguru import logger


# Brand palette — matches marketing/videos and apps/web/.../diagnostics
BG          = (6, 7, 10)
AMBER       = (252, 211, 77)
AMBER_DEEP  = (245, 158, 11)
EMERALD     = (52, 211, 153)
ROSE        = (244, 63, 94)
WHITE       = (245, 245, 245)
MUTED       = (160, 160, 170)

W, H = 1080, 1080


def _font(size: int) -> ImageFont.FreeTypeFont:
    """Pick a font — prefer Inter / DejaVu, fall back to default."""
    for path in (
        '/usr/share/fonts/truetype/inter/Inter-Bold.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        'C:/Windows/Fonts/segoeuib.ttf',
        'arial.ttf',
    ):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()  # type: ignore[return-value]


def _draw_brand_mark(d: ImageDraw.ImageDraw) -> None:
    d.ellipse([60, 60, 78, 78], fill=AMBER)
    d.text((100, 60), 'ALGOSPHERE', fill=AMBER, font=_font(28))
    d.text((100, 92), 'QUANT',       fill=WHITE, font=_font(24))


def _draw_radial_glow(im: Image.Image) -> None:
    """Subtle amber radial in the upper-right so the card has depth."""
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for r in range(0, 800, 8):
        a = max(0, 30 - r // 25)
        if a == 0:
            break
        od.ellipse([W - r, -r, W + r, H - 400 + r], outline=(*AMBER, a))
    im.alpha_composite(overlay)


def _fmt_num(v) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return '—'
    if abs(f) >= 1000: return f'{f:,.2f}'
    if abs(f) >= 1:    return f'{f:.2f}'
    return f'{f:.5f}'


def produce(item: dict, out_dir: Path) -> Dict[str, Path]:
    """Render the card. Returns {kind: file_path} on success."""
    prov = item.get('provenance') or {}
    payload = prov.get('payload') or prov  # automation engine puts the
                                            # source event payload at
                                            # provenance.payload; older
                                            # rows have it inline.

    kind        = item.get('kind') or 'signal_card'
    pair        = str(payload.get('pair') or payload.get('symbol') or '—').upper()
    direction   = str(payload.get('direction') or '').lower()
    entry       = payload.get('entry') or payload.get('entry_price')
    stop_loss   = payload.get('stop_loss')
    take_profit = payload.get('take_profit') or payload.get('take_profit_1')
    rr          = payload.get('risk_reward')
    confidence  = payload.get('confidence') or payload.get('confidence_score')
    pnl         = payload.get('pnl') or payload.get('realized_pnl')

    is_win = pnl is not None and (isinstance(pnl, (int, float)) and pnl > 0)
    is_loss = pnl is not None and (isinstance(pnl, (int, float)) and pnl < 0)

    im = Image.new('RGBA', (W, H), (*BG, 255))
    _draw_radial_glow(im)
    d  = ImageDraw.Draw(im)

    _draw_brand_mark(d)

    # ── Pair + direction
    d.text((W // 2, 220), pair, fill=WHITE, font=_font(140), anchor='mm')
    dir_color = EMERALD if direction == 'buy' else ROSE if direction == 'sell' else MUTED
    dir_label = ('BUY' if direction == 'buy' else 'SELL' if direction == 'sell' else 'NEUTRAL')
    badge_w, badge_h = 220, 60
    bx0 = (W - badge_w) // 2
    by0 = 320
    d.rounded_rectangle([bx0, by0, bx0 + badge_w, by0 + badge_h], radius=30,
                        fill=(*dir_color, 38), outline=dir_color, width=3)
    d.text((W // 2, by0 + badge_h // 2 + 2), dir_label, fill=dir_color, font=_font(40), anchor='mm')

    # ── Numbers grid — three centred columns
    grid_y = 470
    if pnl is not None:
        # Trade-result variant: show big PnL number
        pnl_color = EMERALD if is_win else ROSE if is_loss else MUTED
        sign = '+' if (isinstance(pnl, (int, float)) and pnl > 0) else ''
        d.text((W // 2, grid_y + 50), f'{sign}{_fmt_num(pnl)}', fill=pnl_color,
               font=_font(160), anchor='mm')
        d.text((W // 2, grid_y + 170), 'P&L', fill=MUTED, font=_font(36), anchor='mm')
    else:
        # Signal/entry variant: entry / stop / target
        col_x = [W // 4, W // 2, 3 * W // 4]
        labels = ['ENTRY', 'STOP', 'TARGET']
        values = [_fmt_num(entry), _fmt_num(stop_loss), _fmt_num(take_profit)]
        colors = [WHITE, ROSE, EMERALD]
        for x, lab, val, col in zip(col_x, labels, values, colors):
            d.text((x, grid_y),       lab, fill=MUTED, font=_font(28), anchor='mm')
            d.text((x, grid_y + 60),  val, fill=col,  font=_font(64), anchor='mm')
        # R:R
        if rr is not None:
            d.text((W // 2, grid_y + 200), f'R:R  {_fmt_num(rr)}',
                   fill=AMBER, font=_font(46), anchor='mm')

    # ── Confidence (signal variant only)
    if confidence is not None and pnl is None:
        try:
            c = int(float(confidence))
        except (TypeError, ValueError):
            c = 0
        cy = 800
        d.text((W // 2, cy), f'Confidence {c}/100',
               fill=AMBER, font=_font(42), anchor='mm')
        bar_w = 540
        bx = (W - bar_w) // 2
        by = cy + 50
        d.rounded_rectangle([bx, by, bx + bar_w, by + 14], radius=7, fill=(40, 40, 50))
        d.rounded_rectangle([bx, by, bx + int(bar_w * c / 100), by + 14],
                            radius=7, fill=AMBER)

    # ── URL footer
    d.text((W // 2, H - 70), 'algospherequant.com',
           fill=AMBER, font=_font(34), anchor='mm')

    out = out_dir / f'{kind}.jpg'
    im.convert('RGB').save(out, 'JPEG', quality=88, optimize=True)
    logger.info(f"signal_card produced {out.name} ({out.stat().st_size} bytes)")
    return {kind: out}
