"""
/api/v1/diagnostics — system observability for the operator.

Two endpoints answer the question "is the engine actually working?":

  GET /diagnostics/full
    The full state report. Heartbeats, dry-run flag, engine-enabled,
    last signal evaluation per symbol, recent rejections summary,
    risk/kill-switch state, drought status, signal counts (1h/6h/24h).

  GET /diagnostics/stream
    NDJSON stream of the last N system_event_log rows, newest-first.
    Useful for tailing live decisions in a terminal.

Both endpoints require the engine API key (same X-Engine-Api-Key header
used by /execute and /brokers). Never expose this surface to the
public — it contains operator-relevant state (DB row counts, etc).
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import StreamingResponse
from supabase import create_client, Client

from config import get_settings


router = APIRouter(prefix='/diagnostics', tags=['diagnostics'])


# ─── Auth ─────────────────────────────────────────────────────────────

def _require_api_key(x_engine_api_key: Optional[str]) -> None:
    """Mirror the auth gate the other admin endpoints use."""
    expected = os.environ.get('ENGINE_API_KEY')
    if not expected:
        # Misconfigured deploy — fail closed.
        raise HTTPException(status_code=503, detail='diagnostics disabled')
    if not x_engine_api_key or x_engine_api_key != expected:
        raise HTTPException(status_code=401, detail='unauthorized')


# ─── Supabase helper ──────────────────────────────────────────────────

_db: Optional[Client] = None


def _client() -> Client:
    global _db
    if _db is not None:
        return _db
    s = get_settings()
    if not s.has_supabase:
        raise HTTPException(status_code=503, detail='supabase not configured')
    _db = create_client(s.supabase_url, s.supabase_service_role_key)
    return _db


# ─── /diagnostics/full ────────────────────────────────────────────────

@router.get('/full')
async def diagnostics_full(
    x_engine_api_key: Optional[str] = Header(None, alias='X-Engine-Api-Key'),
):
    """The single endpoint that answers 'is the engine working right now?'

    Aggregates:
      - settings.signal_engine_enabled / signal_dry_run
      - heartbeats per component
      - global risk + kill switch
      - signal counts (1h / 6h / 24h)
      - per-symbol last evaluation + rejection reason from system_event_log
      - top rejection reasons across the universe (last 24h)
    """
    _require_api_key(x_engine_api_key)

    db = _client()
    s  = get_settings()
    now = datetime.now(timezone.utc)

    # ── 1. Settings snapshot (no secrets) ──────────────────────────
    settings_snapshot = {
        'signal_engine_enabled':   bool(s.signal_engine_enabled),
        'signal_dry_run':          bool(s.signal_dry_run),
        'scan_interval_minutes':   getattr(s, 'scan_interval_minutes', None),
        'timeframe':               getattr(s, 'timeframe', None),
        'max_active_per_symbol':   getattr(s, 'max_active_per_symbol', None),
        'symbol_count':            len(getattr(s, 'symbol_list', [])),
        'symbols':                 list(getattr(s, 'symbol_list', []))[:50],
        'has_supabase':            bool(s.has_supabase),
    }

    # ── 2. Heartbeats per component ────────────────────────────────
    try:
        hb = (db.table('engine_heartbeats')
              .select('component, last_at, status, context').execute()).data or []
    except Exception as e:
        hb = []
        heartbeat_error = str(e)[:200]
    else:
        heartbeat_error = None
    # Compute staleness so the operator sees AT A GLANCE which
    # components have gone quiet.
    for row in hb:
        try:
            last = datetime.fromisoformat(row['last_at'].replace('Z', '+00:00'))
            row['age_seconds'] = int((now - last).total_seconds())
        except Exception:
            row['age_seconds'] = None

    # ── 3. Signal counts (1h / 6h / 24h) ───────────────────────────
    def _count_since(table: str, ts_col: str, hours: int) -> int:
        cutoff = (now - timedelta(hours=hours)).isoformat()
        try:
            r = (db.table(table).select('id', count='exact')
                 .gte(ts_col, cutoff).execute())
            return int(r.count or 0)
        except Exception:
            return -1

    signal_counts = {
        'last_1h':  _count_since('signals', 'published_at', 1),
        'last_6h':  _count_since('signals', 'published_at', 6),
        'last_24h': _count_since('signals', 'published_at', 24),
    }

    # ── 4. Last signal generated overall ───────────────────────────
    try:
        last_sig = (db.table('signals')
                    .select('id, pair, direction, confidence_score, published_at')
                    .order('published_at', desc=True).limit(1).execute()).data or []
        last_signal = last_sig[0] if last_sig else None
    except Exception:
        last_signal = None
    if last_signal:
        try:
            last_at = datetime.fromisoformat(
                last_signal['published_at'].replace('Z', '+00:00'))
            last_signal['age_seconds'] = int((now - last_at).total_seconds())
        except Exception:
            pass

    # ── 5. Per-symbol last evaluation (signal_skipped / signal_rejected
    #     / signal_generated) from system_event_log ─────────────────
    per_symbol: dict[str, dict] = {}
    try:
        cutoff = (now - timedelta(hours=24)).isoformat()
        events = (db.table('system_event_log')
                  .select('surface, payload_summary, sent_at')
                  .in_('surface', ['signal_skipped', 'signal_rejected',
                                    'signal_generated', 'risk_block'])
                  .gte('sent_at', cutoff)
                  .order('sent_at', desc=True)
                  .limit(2000).execute()).data or []
        for ev in events:
            sym = (ev.get('payload_summary') or {}).get('symbol')
            if not sym or sym in per_symbol:
                continue
            per_symbol[sym] = {
                'last_event':   ev['surface'],
                'last_reason':  (ev.get('payload_summary') or {}).get('reason'),
                'last_at':      ev['sent_at'],
            }
    except Exception:
        pass

    # Coverage — symbols that have NEVER appeared in the recent
    # decision log are silent at an even deeper level (regime never
    # classified, provider never returned bars, scheduler never fired).
    covered_symbols  = set(per_symbol.keys())
    config_symbols   = set(getattr(s, 'symbol_list', []))
    missing_symbols  = sorted(config_symbols - covered_symbols)

    # ── 6. Top rejection reasons (last 24h) ────────────────────────
    rejection_freq: dict[str, int] = {}
    try:
        cutoff = (now - timedelta(hours=24)).isoformat()
        events = (db.table('system_event_log')
                  .select('payload_summary')
                  .in_('surface', ['signal_skipped', 'signal_rejected', 'risk_block'])
                  .gte('sent_at', cutoff)
                  .limit(5000).execute()).data or []
        for ev in events:
            reason = (ev.get('payload_summary') or {}).get('reason')
            if reason:
                rejection_freq[reason] = rejection_freq.get(reason, 0) + 1
    except Exception:
        pass
    top_rejections = sorted(
        rejection_freq.items(), key=lambda kv: -kv[1])[:10]

    # ── 7. Global risk + kill switch ───────────────────────────────
    risk_state = {}
    try:
        r = (db.table('global_risk_state')
             .select('kill_switch, reason, state, updated_at')
             .eq('id', True).limit(1).execute()).data or []
        if r:
            risk_state = r[0]
    except Exception:
        pass

    # ── 8. Drought flag ─────────────────────────────────────────────
    DROUGHT_HOURS = 12
    if last_signal and last_signal.get('age_seconds') is not None:
        in_drought = last_signal['age_seconds'] > DROUGHT_HOURS * 3600
    else:
        in_drought = True
    drought = {
        'in_drought':         in_drought,
        'drought_hours':      DROUGHT_HOURS,
        'last_signal_age_s':  last_signal.get('age_seconds') if last_signal else None,
    }

    # ── 9. Recent execution_events activity (was the user able to
    #     execute anything in the last 24h?) ─────────────────────────
    try:
        cutoff = (now - timedelta(hours=24)).isoformat()
        ex = (db.table('execution_events').select('id', count='exact')
              .gte('created_at', cutoff).execute())
        execution_events_24h = int(ex.count or 0)
    except Exception:
        execution_events_24h = -1
    try:
        cutoff = (now - timedelta(hours=24)).isoformat()
        je = (db.table('journal_entries').select('id', count='exact')
              .gte('created_at', cutoff).execute())
        journal_entries_24h = int(je.count or 0)
    except Exception:
        journal_entries_24h = -1

    return {
        'generated_at':        now.isoformat(),
        'settings':            settings_snapshot,
        'heartbeats':          hb,
        'heartbeat_error':     heartbeat_error,
        'risk_state':          risk_state,
        'signal_counts':       signal_counts,
        'last_signal':         last_signal,
        'drought':             drought,
        'per_symbol':          per_symbol,
        'symbols_missing_from_log': missing_symbols,
        'top_rejections_24h':  [{'reason': k, 'count': v} for k, v in top_rejections],
        'execution_events_24h': execution_events_24h,
        'journal_entries_24h':  journal_entries_24h,
    }


# ─── /diagnostics/stream (newest-first event log) ─────────────────────

@router.get('/stream')
async def diagnostics_stream(
    limit: int = 200,
    x_engine_api_key: Optional[str] = Header(None, alias='X-Engine-Api-Key'),
):
    """Newest-first dump of recent system_event_log rows. Returns up to
    `limit` rows as a JSON array. Operators can `curl | jq` against this
    for ad-hoc tailing without going to the Supabase dashboard."""
    _require_api_key(x_engine_api_key)
    limit = max(1, min(limit, 2000))

    db = _client()
    try:
        rows = (db.table('system_event_log')
                .select('surface, channel, payload_summary, status, '
                        'status_code, error_class, reference_id, sent_at')
                .order('sent_at', desc=True)
                .limit(limit).execute()).data or []
    except Exception as e:
        raise HTTPException(status_code=503,
                            detail=f'stream read failed: {e}') from e
    return {'count': len(rows), 'events': rows}
