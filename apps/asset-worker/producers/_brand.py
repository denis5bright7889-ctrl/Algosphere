"""
Shared brand atoms used by every producer — palette, font loader,
common drawing primitives (radial glow, brand mark). One source of
truth so colour/font changes ripple through every visual asset.
"""
from __future__ import annotations
from PIL import Image, ImageDraw, ImageFont
from typing import Optional


# Brand palette — matches marketing/videos/src/scenes.tsx
BG          = (6, 7, 10)        # #06070A
AMBER       = (252, 211, 77)    # #fcd34d
AMBER_DEEP  = (245, 158, 11)    # #f59e0b
EMERALD     = (52, 211, 153)    # #34d399
ROSE        = (244, 63, 94)     # #f43f5e
SKY         = (96, 165, 250)    # #60a5fa
WHITE       = (245, 245, 245)
MUTED       = (160, 160, 170)
DARK_BORDER = (35, 35, 45)


_FONT_PATHS = (
    '/usr/share/fonts/truetype/inter/Inter-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'C:/Windows/Fonts/segoeuib.ttf',
    'arial.ttf',
)


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in _FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()  # type: ignore[return-value]


def draw_brand_mark(d: ImageDraw.ImageDraw, x: int = 60, y: int = 60) -> None:
    d.ellipse([x, y, x + 18, y + 18], fill=AMBER)
    d.text((x + 40, y), 'ALGOSPHERE', fill=AMBER, font=font(28))
    d.text((x + 40, y + 32), 'QUANT',  fill=WHITE, font=font(24))


def draw_radial_glow(im: Image.Image, color: tuple = AMBER,
                     center_xy: Optional[tuple] = None,
                     max_radius: int = 800) -> None:
    """Subtle radial glow — adds depth without distracting from copy."""
    w, h = im.size
    cx, cy = center_xy or (w, 0)
    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for r in range(0, max_radius, 8):
        a = max(0, 30 - r // 25)
        if a == 0:
            break
        od.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(*color, a))
    im.alpha_composite(overlay)


def draw_footer_url(d: ImageDraw.ImageDraw, w: int, h: int) -> None:
    d.text((w // 2, h - 70), 'algospherequant.com',
           fill=AMBER, font=font(34), anchor='mm')


def fmt_num(v, places: int = 2) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return '—'
    if abs(f) >= 1000: return f'{f:,.{places}f}'
    if abs(f) >= 1:    return f'{f:.{places}f}'
    return f'{f:.5f}'


def fmt_pct(v) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return '—'
    return f'{f:+.2f}%' if f else '0.00%'


def fmt_dollar(v, places: int = 2) -> str:
    s = fmt_num(v, places)
    if s == '—': return '—'
    return f'${s}'
