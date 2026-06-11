"""
Founder Media Factory — the orchestration loop that turns real events into
Instagram REELS in the founder-diary voice.

  ingest events  →  extract story  →  generate reel  →  queue content_item
                                                        (asset_kinds=['founder_reel'])

The existing worker render loop produces the MP4 (producers/video.py reads the
LLM scene list), and run_publisher ships it — reel to Telegram (always) and to
Instagram as a Reel (when the IG account/permissions allow). Image cards are
NOT used here; reels are the product.

Env:
  GROWTH_FOUNDER_ENABLED     run this loop            (default false)
  GROWTH_FOUNDER_TARGET      max unpublished reels queued (default 4)
  GROWTH_FOUNDER_BATCH       reels created per tick    (default 2)
  GROWTH_FOUNDER_AUTOAPPROVE skip human approval       (default true)
  GROWTH_FOUNDER_MIN_SEVERITY  ingest threshold        (default notable)
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from loguru import logger

from storage import db
import ingest
import story as story_mod
import reels

_SEV_RANK = {'info': 0, 'notable': 1, 'high': 2, 'critical': 3}

# founder emotion → an allowed growth_content_items.kind
_KIND_FOR_EMOTION = {
    'win': 'announcement', 'failure': 'psychology_insight',
    'struggle': 'psychology_insight', 'insight': 'educational',
}


def _flag(k, d=False): return os.environ.get(k, str(d)).lower() in ('1', 'true', 'yes', 'on')
def _int(k, d):
    try: return int(os.environ.get(k, str(d)))
    except ValueError: return d


def run_founder_factory() -> None:
    if not _flag('GROWTH_FOUNDER_ENABLED'):
        return

    target = _int('GROWTH_FOUNDER_TARGET', 4)
    # Bound by unpublished founder reels already queued.
    try:
        backlog = (db().table('growth_content_items')
                   .select('id', count='exact', head=True)
                   .eq('provenance->>source', 'founder')
                   .neq('status', 'published')
                   .in_('asset_state', ['pending', 'producing', 'ready', 'partial'])
                   .execute()).count or 0
    except Exception as e:
        logger.warning(f"founder: backlog count failed — {e}")
        return
    if backlog >= target:
        return

    # 1) INGEST — refresh the event table from real sources.
    try:
        ing = ingest.ingest_all()
        if any(ing.values()):
            logger.info(f"founder.ingest: {ing}")
    except Exception as e:
        logger.warning(f"founder.ingest failed — {e}")

    # 2) Pick the most story-worthy unprocessed events (severity desc).
    min_rank = _SEV_RANK.get(os.environ.get('GROWTH_FOUNDER_MIN_SEVERITY', 'notable'), 1)
    need = min(_int('GROWTH_FOUNDER_BATCH', 2), target - backlog)
    try:
        rows = (db().table('growth_source_events')
                .select('id,source,event_type,severity,raw_data')
                .eq('processed', False)
                .order('ts', desc=True).limit(40).execute().data) or []
    except Exception as e:
        logger.warning(f"founder: event fetch failed — {e}")
        return
    candidates = [r for r in rows if _SEV_RANK.get(r.get('severity'), 0) >= min_rank][:need]
    if not candidates:
        return

    autoapprove = _flag('GROWTH_FOUNDER_AUTOAPPROVE', True)
    created = 0
    for ev in candidates:
        try:
            # 3) STORY + 4) REEL
            st = story_mod.extract_story(ev)
            reel = reels.generate_reel(st)
            emotion = st.get('emotion_type', 'insight')
            kind = _KIND_FOR_EMOTION.get(emotion, 'educational')
            caption = reels.with_hashtags(reel['caption'])

            row = {
                'kind': kind, 'content_format': 'reel',
                'status': 'approved' if autoapprove else 'draft',
                'title': (reel['hook'] or 'Founder note')[:120],
                'hook': reel['hook'],
                'summary': (st.get('lesson') or '')[:280],
                'body_md': caption,
                'channels': ['telegram', 'instagram'],
                'tags': ['founder', 'reel', emotion],
                'is_synthetic': False,
                'disclaimer': 'Founder build-in-public. Not financial advice.',
                'asset_state': 'pending',
                # Reel (audio, primary for IG) + a 7-slide carousel so image
                # posts are multi-slide swipes, never a single silent card.
                'asset_kinds': ['founder_reel', 'founder_carousel'],
                'source_event_id': ev['id'],
                'story': st,
                'provenance': {'source': 'founder', 'emotion': emotion,
                               'event_type': ev.get('event_type'),
                               'payload': {'reel_scenes': reel['reel_scenes'],
                                           'theme': 'reflective' if emotion in ('failure', 'struggle')
                                                    else 'lift' if emotion == 'win' else 'institutional',
                                           'title': reel['hook']}},
            }
            ins = db().table('growth_content_items').insert(row).execute()
            cid = (ins.data or [{}])[0].get('id')
            db().table('growth_source_events').update(
                {'processed': True, 'story': st, 'content_item_id': cid}
            ).eq('id', ev['id']).execute()
            created += 1
            logger.success(f"founder: queued reel ({emotion}, {reel.get('_source')}) "
                           f"from {ev.get('source')}/{ev.get('event_type')} — {reel['hook'][:48]!r}")
        except Exception as e:
            logger.warning(f"founder: failed to build reel for event {ev.get('id')} — {e}")

    if created:
        logger.success(f"founder.factory: queued {created} reels (backlog {backlog}→{backlog+created}/{target})")
