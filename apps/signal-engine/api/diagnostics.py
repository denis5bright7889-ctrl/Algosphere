"""
/api/v1/diagnostics/trading — single-call "why no signals?" answer.

Purpose
-------
Production debugging surface for the most common production failure mode:
"no signals all day, no idea why." Every silent gate in the worker
pipeline (signal_worker._pipeline) gets a row in this response. The
caller can immediately see WHICH gate blocked WHICH symbol, with the
exact data the gate consulted.

Public read (no engine key) so the web dashboard can poll it without the
shared secret. Returns honest "unavailable" markers when sub-systems
are off rather than fabricating a green status.

Sections
--------
    engine                — global config + scheduler liveness
    bars                  — per-symbol freshness from regime_snapshots
    institutional_risk    — kill switch / DD locks / open positions
    circuit_breakers      — per-symbol soft breakers (strategy layer)
    active_signals        — per-symbol count of lifecycle_state='active'
                            rows; the slot-starvation suspect
    last_signal_seen      — most recent published_at across signals
    rejection_trace_tail  — last N lines from logs/execution_trace.jsonl
                            (if the trace logger is on)
    summary               — single-sentence verdict + ranked suspects

Spec: docs/architecture/algo-execution-spec.md sections 11, 13.
"""
from __future__ import annotations
import asyncio
import json
import os
import pathlib
from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Any, Optional
from fastapi import APIRouter
from loguru import logger

from config import get_settings

router = APIRouter()


# ─── Trace file (mirrors trace_logger.TRACE_PATH) ─────────────────────

TRACE_PATH = pathlib.Path(os.environ.get('EXECUTION_TRACE_PATH', 'logs/execution_trace.jsonl'))


def _db():
    from supabase import create_client
    s = get_settings()
    if not s.has_supabase:
        return None
    return create_client(s.supabase_url, s.supabase_service_role_key)


# ─── Sub-section builders ─────────────────────────────────────────────

def _engine_section() -> dict:
    s = get_settings()
    return {
        'signal_engine_enabled': s.signal_engine_enabled,
        'signal_dry_run':        s.signal_dry_run,
        'symbols':               s.symbol_list,
        'symbol_count':          len(s.symbol_list),
        'timeframe':             s.timeframe,
        'scan_interval_min':     s.scan_interval_minutes,
        'min_confidence':        s.min_confidence,
        'max_active_per_symbol': s.max_active_per_symbol,
        'has_supabase':          s.has_supabase,
        'has_market_data':       s.has_market_data,
    }


async def _bars_section(db) -> dict:
    """Most recent regime_snapshots row per symbol = proof the worker
    actually ran a scan cycle on that symbol. If the freshest snapshot
    is hours old, the pipeline never reached the persist step → upstream
    failure (provider, bars, features)."""
    s = get_settings()
    if db is None:
        return {'available': False, 'note': 'supabase unavailable'}

    now = datetime.now(timezone.utc)
    per_symbol: dict[str, dict] = {}
    try:
        # One query, sorted; bucket the latest row per symbol in Python.
        res = await asyncio.to_thread(
            lambda: db.table('regime_snapshots')
            .select('symbol, regime, scanned_at')
            .order('scanned_at', desc=True)
            .limit(2000)
            .execute()
        )
        seen: set[str] = set()
        for row in res.data or []:
            sym = (row.get('symbol') or '').upper()
            if sym in seen or not sym:
                continue
            seen.add(sym)
            scanned = row.get('scanned_at')
            try:
                ts = datetime.fromisoformat(scanned.replace('Z', '+00:00'))
                age_s = int((now - ts).total_seconds())
            except Exception:
                age_s = None
            per_symbol[sym] = {
                'last_regime':  row.get('regime'),
                'scanned_at':   scanned,
                'age_seconds':  age_s,
            }
    except Exception as e:
        logger.warning(f"diagnostics bars query failed: {e}")
        return {'available': False, 'note': str(e)}

    stale_after_s = s.scan_interval_minutes * 60 * 2
    fresh = stale = critical = never = 0
    rows = []
    for sym in s.symbol_list:
        info = per_symbol.get(sym)
        if not info:
            never += 1
            rows.append({'symbol': sym, 'status': 'never_scanned', 'last_regime': None,
                         'scanned_at': None, 'age_seconds': None})
            continue
        age = info['age_seconds']
        if age is None:
            status = 'unknown'
            never += 1
        elif age <= stale_after_s:
            status, fresh = 'fresh', fresh + 1
        elif age <= stale_after_s * 3:
            status, stale = 'stale', stale + 1
        else:
            status, critical = 'critical', critical + 1
        rows.append({**info, 'symbol': sym, 'status': status})

    return {
        'available': True,
        'fresh': fresh, 'stale': stale, 'critical': critical, 'never_scanned': never,
        'symbols': rows,
    }


def _institutional_risk_section() -> dict:
    """Kill switch + DD locks + open positions. Single most useful
    short-circuit for 'why no trades' — if locked is True, every symbol
    failed gate 01."""
    try:
        from worker.registry import get_worker
        w = get_worker()
        if w is None:
            return {'available': False, 'reason': 'worker not initialised'}
        risk = w.capital_risk()
        if risk is None:
            return {'available': False, 'reason': 'risk subsystem not initialised'}
        t = risk.telemetry()
        return {
            'available':            True,
            'state':                t.get('state'),
            'locked':               t.get('locked'),
            'locked_reason':        t.get('locked_reason'),
            'kill_switch_active':   t.get('kill_switch_active'),
            'cooldown_until':       t.get('cooldown_until'),
            'open_positions':       t.get('open_positions'),
            'open_positions_by_symbol':
                getattr(risk.state, 'open_positions_by_symbol', {}),
            'current_equity':       t.get('current_equity'),
            'daily_drawdown_pct':   t.get('daily_drawdown_pct'),
            'weekly_drawdown_pct':  t.get('weekly_drawdown_pct'),
            'total_drawdown_pct':   t.get('total_drawdown_pct'),
            'consecutive_losses':   t.get('consecutive_losses'),
            'adaptive_multiplier':  t.get('adaptive_multiplier'),
            'broker_connected':     t.get('broker_connected'),
            'limits':               t.get('limits'),
        }
    except Exception as e:
        return {'available': False, 'reason': f'risk telemetry raised: {e}'}


def _circuit_breakers_section() -> dict:
    """Per-symbol strategy-layer breakers. Once open, stays open until
    reset_symbol — no auto-cooldown — so this is sticky and often the
    culprit after a bad run."""
    try:
        from worker.registry import get_worker
        w = get_worker()
        if w is None:
            return {'available': False}
        out: dict[str, dict] = {}
        s = get_settings()
        for sym in s.symbol_list:
            st = w._risk_engine.get_state(sym)
            out[sym] = {
                'is_open':            st.is_open,
                'reason':             st.reason,
                'consecutive_losses': st.consecutive_losses,
                'daily_losses':       st.daily_losses,
            }
        return {'available': True, 'symbols': out,
                'open_count': sum(1 for v in out.values() if v['is_open'])}
    except Exception as e:
        return {'available': False, 'reason': str(e)}


async def _active_signals_section(db) -> dict:
    """Per-symbol active counts split by engine_version. Only
    engine_version='algo_v1' counts toward the worker's slot cap —
    manual admin-curated signals (engine_version='manual') are not
    auto-closed by the lifecycle monitor and the worker correctly
    ignores them. We surface both so operators can see the full
    picture without misreading 'manual exists' as 'engine starved'."""
    s = get_settings()
    if db is None:
        return {'available': False, 'note': 'supabase unavailable'}
    try:
        res = await asyncio.to_thread(
            lambda: db.table('signals')
            .select('pair, lifecycle_state, published_at, engine_version')
            .eq('lifecycle_state', 'active')
            .order('published_at', desc=True)
            .limit(500)
            .execute()
        )
        algo_counts: Counter[str] = Counter()
        manual_counts: Counter[str] = Counter()
        oldest_algo: dict[str, str] = {}
        for row in res.data or []:
            pair = (row.get('pair') or '').upper()
            if not pair:
                continue
            ev = row.get('engine_version') or 'manual'
            if ev == 'algo_v1':
                algo_counts[pair] += 1
                ts = row.get('published_at')
                if ts and (pair not in oldest_algo or ts < oldest_algo[pair]):
                    oldest_algo[pair] = ts
            else:
                manual_counts[pair] += 1
        rows = []
        starved = 0
        for sym in s.symbol_list:
            algo_n = algo_counts.get(sym, 0)
            man_n  = manual_counts.get(sym, 0)
            is_starved = algo_n >= s.max_active_per_symbol
            if is_starved:
                starved += 1
            rows.append({
                'symbol':      sym,
                'active':      algo_n,        # engine-relevant count
                'manual':      man_n,
                'starved':     is_starved,
                'oldest_open': oldest_algo.get(sym),
            })
        return {
            'available':            True,
            'max_active_per_symbol': s.max_active_per_symbol,
            'starved_symbols':      starved,
            'total_active_algo':    sum(algo_counts.values()),
            'total_active_manual':  sum(manual_counts.values()),
            'symbols':              rows,
        }
    except Exception as e:
        return {'available': False, 'note': str(e)}


async def _last_signal_seen(db) -> dict:
    if db is None:
        return {'available': False}
    try:
        res = await asyncio.to_thread(
            lambda: db.table('signals')
            .select('id, pair, direction, confidence_score, regime, published_at')
            .order('published_at', desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return {'available': True, 'last_signal': None,
                    'note': 'no signals in table'}
        row = rows[0]
        try:
            ts = datetime.fromisoformat(row['published_at'].replace('Z', '+00:00'))
            age_s = int((datetime.now(timezone.utc) - ts).total_seconds())
        except Exception:
            age_s = None
        return {'available': True, 'last_signal': row, 'age_seconds': age_s}
    except Exception as e:
        return {'available': False, 'note': str(e)}


def _trace_tail(n: int = 100) -> dict:
    """Tail of execution_trace.jsonl. Empty when the trace logger isn't
    enabled (default off in production)."""
    if not TRACE_PATH.exists():
        return {'available': False, 'path': str(TRACE_PATH),
                'note': 'trace file not written yet — enable EXECUTION_TRACE_ENABLED=1'}
    try:
        # Read tail by chunks so a multi-MB jsonl doesn't blow memory.
        size = TRACE_PATH.stat().st_size
        with TRACE_PATH.open('rb') as f:
            # Read last ~256KB and split on newlines; covers ~thousands of rows.
            seek = max(0, size - 256_000)
            f.seek(seek)
            raw = f.read().decode('utf-8', errors='ignore')
        lines = [ln for ln in raw.split('\n') if ln.strip()]
        lines = lines[-n:]
        rows: list[dict] = []
        for ln in lines:
            try:
                rows.append(json.loads(ln))
            except Exception:
                continue

        rejection_counter: Counter[str] = Counter()
        for r in rows:
            rb = r.get('rejected_by')
            if rb:
                rejection_counter[rb] += 1
        return {
            'available':          True,
            'path':               str(TRACE_PATH),
            'tail_count':         len(rows),
            'rejection_breakdown': dict(rejection_counter.most_common()),
            'rows':               rows,
        }
    except Exception as e:
        return {'available': False, 'path': str(TRACE_PATH), 'note': str(e)}


def _build_summary(
    *, engine: dict, bars: dict, risk: dict, breakers: dict,
    active: dict, last: dict, trace: dict,
) -> dict:
    """Single-sentence verdict + ranked suspect list. Pure inference
    over the sections above — no new DB reads."""
    suspects: list[str] = []
    verdict = 'unknown'

    if not engine.get('signal_engine_enabled'):
        suspects.append('signal_engine_enabled=False — scan_all returns immediately')
    if engine.get('signal_dry_run'):
        suspects.append('signal_dry_run=True — pipeline runs but never publishes')
    if not engine.get('has_supabase'):
        suspects.append('supabase credentials missing — engine cannot publish or scan')
    if not engine.get('has_market_data'):
        suspects.append('no market-data provider keys configured')

    if risk.get('available'):
        if risk.get('locked') or risk.get('kill_switch_active'):
            suspects.append(
                f"institutional kill switch ACTIVE: {risk.get('locked_reason')} "
                f"— gate 01 blocks every symbol"
            )
        elif risk.get('cooldown_until'):
            suspects.append(f"cooldown active until {risk.get('cooldown_until')} (gate 03)")

    if breakers.get('available') and breakers.get('open_count', 0):
        opened = [s for s, v in breakers.get('symbols', {}).items() if v.get('is_open')]
        suspects.append(
            f"{breakers['open_count']}/{len(breakers.get('symbols', {}))} symbol "
            f"circuit breakers open: {opened[:5]}"
        )

    if active.get('available') and active.get('starved_symbols'):
        suspects.append(
            f"{active['starved_symbols']} symbols at max_active_per_symbol cap — "
            f"old active signals never closed"
        )

    if bars.get('available') and (bars.get('critical', 0) or bars.get('never_scanned', 0)):
        n_dark = bars.get('critical', 0) + bars.get('never_scanned', 0)
        suspects.append(
            f"{n_dark} symbols not being scanned (provider down / credit exhausted)"
        )

    if last.get('available'):
        age = last.get('age_seconds')
        if age is None or last.get('last_signal') is None:
            verdict = 'no signal ever published'
        elif age > 86400:
            verdict = f"last signal {age // 3600}h ago — actively starved"
        elif age > 3600:
            verdict = f"last signal {age // 60}m ago — slowed but not dead"
        else:
            verdict = f"last signal {age // 60}m ago — pipeline healthy"

    if trace.get('available') and trace.get('rejection_breakdown'):
        top = next(iter(trace['rejection_breakdown']))
        suspects.append(f"trace top rejection: {top} ({trace['rejection_breakdown'][top]} hits)")

    if not suspects:
        suspects.append('no obvious cause — enable EXECUTION_TRACE_ENABLED=1 for per-symbol-per-cycle reasons')

    return {'verdict': verdict, 'suspects': suspects}


# ─── Route ────────────────────────────────────────────────────────────

@router.get('/diagnostics/trading')
async def diagnostics_trading() -> dict:
    db = _db()

    engine_s = _engine_section()
    bars_s = await _bars_section(db)
    risk_s = _institutional_risk_section()
    cb_s   = _circuit_breakers_section()
    active_s = await _active_signals_section(db)
    last_s = await _last_signal_seen(db)
    trace_s = _trace_tail(n=100)
    summary = _build_summary(
        engine=engine_s, bars=bars_s, risk=risk_s, breakers=cb_s,
        active=active_s, last=last_s, trace=trace_s,
    )

    return {
        'generated_at':         datetime.now(timezone.utc).isoformat(),
        'engine':               engine_s,
        'bars':                 bars_s,
        'institutional_risk':   risk_s,
        'circuit_breakers':     cb_s,
        'active_signals':       active_s,
        'last_signal_seen':     last_s,
        'rejection_trace_tail': trace_s,
        'summary':              summary,
    }
