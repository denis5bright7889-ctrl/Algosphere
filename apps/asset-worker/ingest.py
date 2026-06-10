"""
Event Ingestion Layer — pulls REAL AlgoSphere facts into the normalized
growth_source_events table (the {timestamp, source, event_type, raw_data,
severity} contract). Deduped via dedup_key so the same fact is never
ingested twice.

Sources implemented (all read-only, all guarded):
  • trading   — closed signals (win/loss) from `signals`
  • backend   — notable rows from `system_event_log` (errors, risk blocks,
                droughts, broker/mt5 issues)
  • git       — recent commits (best-effort; only if the repo + git exist
                in the container)
Manual notes are inserted directly into growth_source_events (source='manual')
by an API route / operator — no ingestor needed.
"""
from __future__ import annotations

import subprocess
from datetime import datetime, timezone, timedelta

from loguru import logger

from storage import db


def _insert(events: list[dict]) -> int:
    """Insert events, skipping dedup_key conflicts. Returns inserted count."""
    n = 0
    for e in events:
        try:
            db().table('growth_source_events').insert(e).execute()
            n += 1
        except Exception:
            pass  # unique(dedup_key) collision = already ingested; fine
    return n


def ingest_signals(limit: int = 20) -> int:
    try:
        rows = (db().table('signals')
                .select('id,pair,direction,result,pips_gained,published_at,confidence_score')
                .in_('result', ['win', 'loss'])
                .order('published_at', desc=True).limit(limit).execute().data) or []
    except Exception as e:
        logger.warning(f"ingest.signals failed — {e}")
        return 0
    out = []
    for s in rows:
        win = s.get('result') == 'win'
        out.append({
            'source': 'trading',
            'event_type': 'signal_win' if win else 'signal_loss',
            'severity': 'notable' if win else 'high',
            'dedup_key': f"signal:{s['id']}:{s['result']}",
            'raw_data': {
                'pair': s.get('pair'), 'direction': s.get('direction'),
                'result': s.get('result'), 'pips': s.get('pips_gained'),
                'confidence': s.get('confidence_score'),
                'summary': f"{s.get('pair')} {s.get('result')}",
            },
        })
    return _insert(out)


# system_event_log surfaces worth a founder story (struggle/alert material)
_NOTABLE_SURFACES = {
    'risk_block': ('alert', 'high'),
    'engine_event': ('backend_log', 'notable'),
    'signal_drought': ('alert', 'high'),
    'mt5_status': ('alert', 'high'),
    'error': ('backend_log', 'critical'),
}


def ingest_system_events(limit: int = 40) -> int:
    since = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    try:
        rows = (db().table('system_event_log')
                .select('id,surface,created_at,payload')
                .gte('created_at', since)
                .order('created_at', desc=True).limit(limit).execute().data) or []
    except Exception as e:
        logger.warning(f"ingest.system_events failed — {e}")
        return 0
    out = []
    for r in rows:
        surf = r.get('surface')
        if surf not in _NOTABLE_SURFACES:
            continue
        src, sev = _NOTABLE_SURFACES[surf]
        payload = r.get('payload') or {}
        out.append({
            'source': src,
            'event_type': 'error' if surf == 'error' else 'broker_issue' if surf == 'mt5_status'
                          else 'cron_fail' if surf == 'signal_drought' else surf,
            'severity': sev,
            'dedup_key': f"sysev:{r['id']}",
            'raw_data': {'surface': surf,
                         'message': payload.get('reason') or payload.get('message') or surf,
                         'detail': payload},
        })
    return _insert(out)


def ingest_git(limit: int = 10) -> int:
    """Best-effort: recent commits as 'insight' events. Skips silently if the
    container has no git repo (common in a slim image)."""
    try:
        raw = subprocess.run(
            ['git', 'log', f'-{limit}', '--pretty=format:%H%x1f%s%x1f%cI'],
            capture_output=True, text=True, timeout=15)
        if raw.returncode != 0 or not raw.stdout.strip():
            return 0
    except Exception:
        return 0
    out = []
    for line in raw.stdout.strip().splitlines():
        parts = line.split('\x1f')
        if len(parts) != 3:
            continue
        sha, subject, iso = parts
        # only feature/fix commits make decent stories
        low = subject.lower()
        if not any(low.startswith(p) for p in ('feat', 'fix', 'perf', 'refactor')):
            continue
        out.append({
            'source': 'git', 'event_type': 'commit', 'severity': 'info',
            'dedup_key': f"git:{sha[:12]}",
            'raw_data': {'sha': sha[:12], 'summary': subject, 'committed_at': iso},
        })
    return _insert(out)


def ingest_all() -> dict:
    return {
        'trading': ingest_signals(),
        'backend': ingest_system_events(),
        'git': ingest_git(),
    }
