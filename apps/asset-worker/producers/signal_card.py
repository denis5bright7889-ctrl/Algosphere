"""
Signal / trade / message card — PIL-rendered 1080x1080 JPEG.

One producer, multiple variants detected from asset_kind + payload:
  • signal / trade-entry  → pair + direction + ENTRY/STOP/TARGET grid + R:R
  • trade-result          → big P&L hero
  • achievement / feature / educational / psychology / message
                          → clean titled hero with a WRAPPED body (no
                            signal scaffold)

Output: 1080x1080 JPEG @ 88% quality. IG-compatible.

Fixed 2026-06-06: the feature/achievement branches used to fall through
to the ENTRY/STOP/TARGET grid, drawing the (unwrapped, overflowing)
description on top of the signal scaffold. Text variants are now fully
self-contained, with word-wrapped bodies and auto-fitted titles.
"""
from pathlib import Path
from typing import Dict, List
from PIL import Image, ImageDraw, ImageFont
from loguru import logger


# Brand palette — matches marketing/videos and apps/web/.../diagnostics
BG          = (6, 7, 10)
AMBER       = (252, 211, 77)
AMBER_DEEP  = (245, 158, 11)
EMERALD     = (52, 211, 153)
ROSE        = (244, 63, 94)
SKY         = (96, 165, 250)
WHITE       = (245, 245, 245)
MUTED       = (160, 160, 170)

W, H = 1080, 1080


def _font(size: int) -> ImageFont.FreeTypeFont:
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


def _wrap(d: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont,
          max_w: int) -> List[str]:
    """Greedy word-wrap to a pixel width."""
    out: List[str] = []
    for para in str(text).split('\n'):
        line = ''
        for word in para.split():
            t = (line + ' ' + word).strip()
            if d.textlength(t, font=fnt) <= max_w:
                line = t
            else:
                if line:
                    out.append(line)
                line = word
        out.append(line)
    return [ln for ln in out if ln != ''] or ['']


def _fit_font(d: ImageDraw.ImageDraw, text: str, max_w: int,
              start: int, min_size: int = 52) -> ImageFont.FreeTypeFont:
    """Largest font (≤ start) that fits text on one line, down to min_size."""
    size = start
    while size > min_size:
        f = _font(size)
        if d.textlength(text, font=f) <= max_w:
            return f
        size -= 4
    return _font(min_size)


def _draw_brand_mark(d: ImageDraw.ImageDraw) -> None:
    d.ellipse([60, 60, 78, 78], fill=AMBER)
    d.text((100, 60), 'ALGOSPHERE', fill=AMBER, font=_font(28))
    d.text((100, 92), 'QUANT',       fill=WHITE, font=_font(24))


def _draw_radial_glow(im: Image.Image, color=AMBER) -> None:
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for r in range(0, 800, 8):
        a = max(0, 30 - r // 25)
        if a == 0:
            break
        od.ellipse([W - r, -r, W + r, H - 400 + r], outline=(*color, a))
    im.alpha_composite(overlay)


def _fmt_num(v) -> str:
    """Trading-aware precision. Forex pairs ≥1 (EURUSD 1.1523) need 5dp or
    their entry/stop/target collapse to the same '1.15'; JPY pairs (~150)
    need 3dp; indices/crypto/metals (≥1000) get 2dp + thousands separator."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return '—'
    a = abs(f)
    if a >= 1000: return f'{f:,.2f}'
    if a >= 100:  return f'{f:.3f}'   # JPY pairs ~150
    if a >= 10:   return f'{f:.4f}'
    return f'{f:.5f}'                 # EURUSD 1.15230, AUDUSD 0.70421


def _footer(d: ImageDraw.ImageDraw) -> None:
    d.text((W // 2, H - 70), 'algospherequant.com', fill=AMBER, font=_font(34), anchor='mm')


def _render_message(d, header, title, description, accent):
    """Clean centred hero for text content (feature/achievement/education/
    psychology). Title auto-fits + wraps; body word-wraps; no scaffold."""
    d.text((W // 2, 300), header.upper(), fill=accent, font=_font(44), anchor='mm')

    title = str(title or '').strip()
    tf = _fit_font(d, title.upper(), W - 160, 120, 56)
    tlines = _wrap(d, title.upper(), tf, W - 140)[:2]
    line_h = int(tf.size * 1.08)
    ty = 440 - (len(tlines) - 1) * (line_h // 2)
    for ln in tlines:
        d.text((W // 2, ty), ln, fill=WHITE, font=tf, anchor='mm')
        ty += line_h

    # accent rule
    d.rectangle([W // 2 - 70, ty + 8, W // 2 + 70, ty + 14], fill=accent)

    desc = str(description or '').strip()
    if desc:
        df = _font(42)
        dlines = _wrap(d, desc, df, W - 200)[:5]
        dy = ty + 70
        for ln in dlines:
            d.text((W // 2, dy), ln, fill=MUTED, font=df, anchor='mm')
            dy += 58


def produce(item: dict, out_dir: Path, asset_kind: str = 'signal_card') -> Dict[str, Path]:
    prov = item.get('provenance') or {}
    payload = prov.get('payload') or prov

    kind        = asset_kind or item.get('kind') or 'signal_card'
    pair        = str(payload.get('pair') or payload.get('symbol') or '—').upper()
    direction   = str(payload.get('direction') or '').lower()
    entry       = payload.get('entry') or payload.get('entry_price')
    stop_loss   = payload.get('stop_loss')
    take_profit = payload.get('take_profit') or payload.get('take_profit_1')
    rr          = payload.get('risk_reward')
    confidence  = payload.get('confidence') or payload.get('confidence_score')
    pnl         = payload.get('pnl') or payload.get('realized_pnl')
    achievement = payload.get('achievement') or payload.get('milestone')
    feature     = payload.get('feature') or payload.get('feature_name')
    description = payload.get('description') or item.get('summary') or ''

    is_win  = isinstance(pnl, (int, float)) and pnl > 0
    is_loss = isinstance(pnl, (int, float)) and pnl < 0

    accent = AMBER if 'achievement' in kind else SKY
    im = Image.new('RGBA', (W, H), (*BG, 255))
    _draw_radial_glow(im, accent if ('feature' in kind or 'achievement' in kind) else AMBER)
    d  = ImageDraw.Draw(im)
    _draw_brand_mark(d)

    # ── Text variants (self-contained — return early, no signal scaffold) ──
    eyebrow = payload.get('eyebrow') or payload.get('label')
    if 'achievement' in kind and (achievement or description):
        _render_message(d, eyebrow or 'Milestone', achievement or (item.get('title') or ''), description, AMBER)
        _footer(d)
        out = out_dir / f'{kind}.jpg'
        im.convert('RGB').save(out, 'JPEG', quality=88, optimize=True)
        logger.info(f"signal_card produced {out.name} ({out.stat().st_size} bytes)")
        return {kind: out}

    if 'feature' in kind and (feature or description):
        # feature_card also serves educational / psychology / product copy —
        # the eyebrow makes the header honest (not always "New Feature").
        ttl = feature or item.get('title') or ''
        _render_message(d, eyebrow or 'New Feature', ttl, description, SKY)
        _footer(d)
        out = out_dir / f'{kind}.jpg'
        im.convert('RGB').save(out, 'JPEG', quality=88, optimize=True)
        logger.info(f"signal_card produced {out.name} ({out.stat().st_size} bytes)")
        return {kind: out}

    # ── Signal / trade hero ────────────────────────────────────────────────
    d.text((W // 2, 230), pair, fill=WHITE, font=_fit_font(d, pair, W - 200, 140, 70), anchor='mm')
    dir_color = EMERALD if direction == 'buy' else ROSE if direction == 'sell' else MUTED
    dir_label = ('BUY' if direction == 'buy' else 'SELL' if direction == 'sell' else 'SIGNAL')
    badge_w, badge_h = 240, 64
    bx0 = (W - badge_w) // 2
    by0 = 330
    # Solid pill + dark label (alpha fills don't composite on convert('RGB'),
    # and same-colour label on the pill was invisible).
    d.rounded_rectangle([bx0, by0, bx0 + badge_w, by0 + badge_h], radius=32, fill=dir_color)
    d.text((W // 2, by0 + badge_h // 2 + 2), dir_label, fill=BG, font=_font(40), anchor='mm')

    grid_y = 500
    if pnl is not None:
        pnl_color = EMERALD if is_win else ROSE if is_loss else MUTED
        sign = '+' if is_win else ''
        d.text((W // 2, grid_y + 50), f'{sign}{_fmt_num(pnl)}', fill=pnl_color, font=_font(160), anchor='mm')
        d.text((W // 2, grid_y + 175), 'P&L', fill=MUTED, font=_font(36), anchor='mm')
    else:
        # Wide column spacing + per-value auto-fit so long (5-decimal forex)
        # numbers never collide.
        col_x = [216, W // 2, W - 216]
        col_max = 300
        for x, lab, val, col in zip(col_x, ['ENTRY', 'STOP', 'TARGET'],
                                    [_fmt_num(entry), _fmt_num(stop_loss), _fmt_num(take_profit)],
                                    [WHITE, ROSE, EMERALD]):
            d.text((x, grid_y), lab, fill=MUTED, font=_font(30), anchor='mm')
            d.text((x, grid_y + 64), val, fill=col, font=_fit_font(d, val, col_max, 56, 30), anchor='mm')
        if rr is not None:
            try:
                rr_s = f'{float(rr):.2f}'
            except (TypeError, ValueError):
                rr_s = str(rr)
            d.text((W // 2, grid_y + 205), f'R:R  {rr_s}', fill=AMBER, font=_font(46), anchor='mm')

    if confidence is not None and pnl is None:
        try:
            c = max(0, min(100, int(float(confidence))))
        except (TypeError, ValueError):
            c = 0
        cy = 810
        d.text((W // 2, cy), f'Conviction {c}/100', fill=AMBER, font=_font(42), anchor='mm')
        bar_w = 540
        bx = (W - bar_w) // 2
        by = cy + 50
        d.rounded_rectangle([bx, by, bx + bar_w, by + 14], radius=7, fill=(40, 40, 50))
        if c > 0:
            d.rounded_rectangle([bx, by, bx + int(bar_w * c / 100), by + 14], radius=7, fill=AMBER)

    _footer(d)
    out = out_dir / f'{kind}.jpg'
    im.convert('RGB').save(out, 'JPEG', quality=88, optimize=True)
    logger.info(f"signal_card produced {out.name} ({out.stat().st_size} bytes)")
    return {kind: out}
