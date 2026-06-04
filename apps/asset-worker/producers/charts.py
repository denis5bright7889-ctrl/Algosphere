"""
Matplotlib chart producer — publication-quality PNGs.
One producer handles seven chart kinds via dispatch:

  equity_curve_image          — cumulative equity line over time
  capital_growth_chart        — multi-line growth vs benchmark
  drawdown_chart              — equity highs / drawdown shading
  portfolio_performance_chart — per-instrument cumulative bars
  monthly_performance_chart   — month-by-month return bars
  asset_allocation_chart      — donut of allocation by symbol/class
  strategy_comparison_chart   — multi-line equity curves of strategies

Reads `provenance.payload` for the series. Falls back to a clean
"no data yet" placeholder if no series present so the row still
produces.
"""
from __future__ import annotations
from pathlib import Path
from typing import Dict, List
from loguru import logger

import matplotlib
matplotlib.use('Agg')  # headless backend, no display required
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import Wedge
from datetime import datetime


# Brand palette — matplotlib hex strings matching apps/web/scenes.tsx
BG_DARK     = '#06070A'
PANEL       = '#0f1014'
AMBER       = '#fcd34d'
AMBER_DEEP  = '#f59e0b'
EMERALD     = '#34d399'
ROSE        = '#f43f5e'
SKY         = '#60a5fa'
GRID        = '#2a2a35'
WHITE       = '#f5f5f5'
MUTED       = '#a0a0aa'


def _brand_axes(ax, title: str | None = None) -> None:
    ax.set_facecolor(PANEL)
    for s in ('top', 'right'): ax.spines[s].set_visible(False)
    for s in ('left', 'bottom'):
        ax.spines[s].set_color(MUTED); ax.spines[s].set_linewidth(0.8)
    ax.tick_params(colors=MUTED, labelsize=11)
    ax.grid(True, alpha=0.25, color=GRID, linewidth=0.7)
    if title:
        ax.set_title(title, color=WHITE, fontsize=18, fontweight='bold', pad=20)


def _new_fig(w: float = 12, h: float = 7) -> tuple:
    fig = plt.figure(figsize=(w, h), facecolor=BG_DARK)
    ax = fig.add_subplot(111)
    return fig, ax


def _footer_brand(fig) -> None:
    fig.text(0.5, 0.02, 'AlgoSphere Quant  ·  algospherequant.com',
             ha='center', color=AMBER, fontsize=10, fontweight='bold', alpha=0.85)


def _empty_chart(ax, message: str = 'No data available yet') -> None:
    ax.text(0.5, 0.5, message, transform=ax.transAxes,
            ha='center', va='center', color=MUTED, fontsize=18)
    ax.set_xticks([]); ax.set_yticks([])


def _parse_series(rows: List[dict], ts_key: str, val_key: str) -> tuple:
    """Return (xs_datetime, ys_float). Coerces strings → datetime / float
    and skips malformed entries silently."""
    xs, ys = [], []
    for r in rows or []:
        ts = r.get(ts_key)
        v  = r.get(val_key)
        try:
            if isinstance(ts, (int, float)):
                xs.append(datetime.fromtimestamp(float(ts)))
            elif isinstance(ts, str):
                xs.append(datetime.fromisoformat(ts.replace('Z', '+00:00')))
            else:
                continue
            ys.append(float(v))
        except (TypeError, ValueError):
            continue
    return xs, ys


# ── Renderers ────────────────────────────────────────────────────────

def _equity_curve(ax, fig, payload: dict) -> None:
    series = payload.get('equity_series') or payload.get('series') or []
    xs, ys = _parse_series(series, 'ts', 'equity')
    if not xs:
        _empty_chart(ax, 'No equity history in window')
        return
    ax.fill_between(xs, ys, min(ys), alpha=0.25, color=AMBER, linewidth=0)
    ax.plot(xs, ys, color=AMBER, linewidth=2.5)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
    ax.set_ylabel('Equity', color=MUTED, fontsize=12)
    _brand_axes(ax, 'Equity Curve')


def _capital_growth(ax, fig, payload: dict) -> None:
    """Multi-line growth: strategy vs benchmark (e.g. BTC, SPX)."""
    growth = payload.get('growth_series') or payload.get('series') or {}
    if not isinstance(growth, dict) or not growth:
        _empty_chart(ax, 'No growth series')
        return
    colors = [AMBER, SKY, EMERALD, ROSE]
    for i, (label, rows) in enumerate(growth.items()):
        xs, ys = _parse_series(rows, 'ts', 'value')
        if xs:
            ax.plot(xs, ys, color=colors[i % len(colors)], linewidth=2.2,
                    label=str(label))
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=WHITE, fontsize=11)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
    ax.set_ylabel('Return  (%)', color=MUTED, fontsize=12)
    _brand_axes(ax, 'Capital Growth')


def _drawdown(ax, fig, payload: dict) -> None:
    series = payload.get('drawdown_series') or payload.get('series') or []
    xs, ys = _parse_series(series, 'ts', 'dd_pct')
    if not xs:
        _empty_chart(ax, 'No drawdown series')
        return
    ax.fill_between(xs, ys, 0, alpha=0.45, color=ROSE, linewidth=0)
    ax.plot(xs, ys, color=ROSE, linewidth=2.5)
    ax.axhline(0, color=MUTED, linewidth=1, alpha=0.4)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
    ax.set_ylabel('Drawdown  (%)', color=MUTED, fontsize=12)
    _brand_axes(ax, 'Drawdown')


def _portfolio_performance(ax, fig, payload: dict) -> None:
    rows = payload.get('by_instrument') or payload.get('by_pair') or []
    if not rows:
        _empty_chart(ax, 'No instrument breakdown')
        return
    rows_sorted = sorted(
        rows, key=lambda r: float(r.get('pnl') or 0), reverse=True
    )[:12]
    labels = [str(r.get('pair') or r.get('symbol') or '—') for r in rows_sorted]
    values = [float(r.get('pnl') or 0) for r in rows_sorted]
    colors = [EMERALD if v >= 0 else ROSE for v in values]
    ax.barh(range(len(labels)), values, color=colors, edgecolor=GRID, linewidth=0.5)
    ax.set_yticks(range(len(labels))); ax.set_yticklabels(labels, color=WHITE)
    ax.invert_yaxis()
    ax.set_xlabel('PnL  ($)', color=MUTED, fontsize=12)
    _brand_axes(ax, 'Portfolio Performance')


def _monthly_performance(ax, fig, payload: dict) -> None:
    by_month = payload.get('by_month') or []
    if not by_month:
        _empty_chart(ax, 'No monthly returns')
        return
    labels = [str(r.get('month') or '—') for r in by_month]
    values = [float(r.get('return_pct') or 0) for r in by_month]
    colors = [EMERALD if v >= 0 else ROSE for v in values]
    ax.bar(range(len(labels)), values, color=colors, edgecolor=GRID, linewidth=0.5)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, color=WHITE, rotation=45, ha='right')
    ax.set_ylabel('Return  (%)', color=MUTED, fontsize=12)
    ax.axhline(0, color=MUTED, linewidth=1, alpha=0.5)
    _brand_axes(ax, 'Monthly Performance')


def _asset_allocation(ax, fig, payload: dict) -> None:
    rows = payload.get('allocation') or payload.get('by_class') or []
    if not rows:
        _empty_chart(ax, 'No allocation data')
        return
    sizes  = [max(0, float(r.get('pct') or r.get('weight') or 0)) for r in rows]
    labels = [str(r.get('name') or r.get('class') or '—') for r in rows]
    total = sum(sizes)
    if total <= 0:
        _empty_chart(ax, 'Allocation values are zero')
        return
    colors = [AMBER, EMERALD, SKY, ROSE, AMBER_DEEP, MUTED]
    wedges, texts, autotexts = ax.pie(
        sizes, labels=labels, colors=colors[:len(sizes)],
        autopct='%1.1f%%',
        wedgeprops={'edgecolor': BG_DARK, 'linewidth': 3, 'width': 0.45},
        textprops={'color': WHITE, 'fontsize': 12, 'fontweight': 'bold'},
        pctdistance=0.78,
    )
    for at in autotexts:
        at.set_color(BG_DARK); at.set_fontweight('bold')
    ax.set_title('Asset Allocation', color=WHITE, fontsize=18, fontweight='bold', pad=20)


def _strategy_comparison(ax, fig, payload: dict) -> None:
    by_strat = payload.get('strategies') or {}
    if not isinstance(by_strat, dict) or not by_strat:
        _empty_chart(ax, 'No strategy comparison data')
        return
    colors = [AMBER, EMERALD, SKY, ROSE, AMBER_DEEP]
    for i, (name, rows) in enumerate(by_strat.items()):
        xs, ys = _parse_series(rows, 'ts', 'value')
        if xs:
            ax.plot(xs, ys, color=colors[i % len(colors)], linewidth=2.2,
                    label=str(name)[:20])
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=WHITE, fontsize=11)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
    ax.set_ylabel('Cumulative Return  (%)', color=MUTED, fontsize=12)
    _brand_axes(ax, 'Strategy Comparison')


_RENDERERS = {
    'equity_curve_image':           _equity_curve,
    'capital_growth_chart':         _capital_growth,
    'drawdown_chart':                _drawdown,
    'portfolio_performance_chart':   _portfolio_performance,
    'monthly_performance_chart':     _monthly_performance,
    'asset_allocation_chart':        _asset_allocation,
    'strategy_comparison_chart':     _strategy_comparison,
    # before_after_chart — two-line chart of "what would have happened
    # without the engine" vs "what did happen". Maps to capital_growth
    # if the payload has growth_series with two members.
    'before_after_chart':            _capital_growth,
}


def produce(item: dict, out_dir: Path, asset_kind: str = 'equity_curve_image') -> Dict[str, Path]:
    renderer = _RENDERERS.get(asset_kind, _equity_curve)
    prov = item.get('provenance') or {}
    payload = prov.get('payload') or prov

    fig, ax = _new_fig()
    try:
        renderer(ax, fig, payload)
        _footer_brand(fig)
        fig.subplots_adjust(top=0.90, bottom=0.12, left=0.10, right=0.96)
        out = out_dir / f'{asset_kind}.png'
        fig.savefig(out, dpi=140, facecolor=BG_DARK, edgecolor='none',
                    bbox_inches='tight', pad_inches=0.2)
        logger.info(f"chart {asset_kind} produced ({out.stat().st_size} bytes)")
        return {asset_kind: out}
    finally:
        plt.close(fig)
