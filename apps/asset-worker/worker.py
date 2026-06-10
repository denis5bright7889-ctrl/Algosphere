"""
AlgoSphere Asset Worker — Railway entry point.

Long-running poll loop:
    1. Find content_items WHERE asset_state='pending' AND scheduled_for
       within the next 30 min (or NULL = immediate).
    2. Claim with a 5-min lease so a sibling replica can't race.
    3. For each kind in item.asset_kinds, call the matching producer
       from producers.REGISTRY.
    4. Upload each produced file to Supabase Storage growth-assets/<id>/.
    5. Patch item.asset_urls (kind → public URL) and asset_state
       ('ready' if all kinds succeeded, 'partial' if some failed,
       'failed' if none succeeded).
    6. Log every attempt to growth_asset_attempts (mirror trigger
       writes to system_event_log for unified ops view).

The /api/cron/growth-publish scheduler skips content_items with
asset_state NOT IN ('ready','none') so a half-produced row never
publishes half-baked.
"""
from __future__ import annotations

import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from loguru import logger

import producers
import factory
import founder
from storage import db, ensure_bucket_exists, upload, log_attempt, worker_id


POLL_INTERVAL_S = int(os.environ.get('ASSET_WORKER_POLL_S', '15'))
LEASE_MINUTES   = 5
LOOK_AHEAD_MIN  = 30   # claim rows scheduled to publish within this window

# Content-factory tick intervals (seconds). Each factory function is a
# no-op unless its env flag is set, so these are cheap when disabled.
GEN_EVERY_S  = int(os.environ.get('GROWTH_GEN_EVERY_S', '120'))
PUB_EVERY_S  = int(os.environ.get('GROWTH_PUB_EVERY_S', '60'))
HEAL_EVERY_S = int(os.environ.get('GROWTH_HEAL_EVERY_S', '300'))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def claim_one() -> Optional[dict]:
    """
    Atomic-ish claim: pick the oldest pending content_item whose
    schedule is within reach, set asset_state='producing' and stamp
    asset_worker_lease_until. Returns the claimed row or None.

    We use a 2-step (read + write) because supabase-py has no FOR
    UPDATE SKIP LOCKED equivalent. The lease + the WHERE-clause
    safety (we re-check asset_state on UPDATE) makes this safe
    enough at the volume of growth events.
    """
    cutoff = (_now() + timedelta(minutes=LOOK_AHEAD_MIN)).isoformat()
    try:
        res = (db().table('growth_content_items')
               .select('id, kind, title, provenance, asset_kinds, asset_state, '
                       'asset_urls, scheduled_for')
               .eq('asset_state', 'pending')
               .or_(f'scheduled_for.is.null,scheduled_for.lte.{cutoff}')
               .order('scheduled_for', desc=False, nullsfirst=True)
               .limit(1).execute())
        rows = res.data or []
        if not rows:
            return None
        row = rows[0]
    except Exception as e:
        logger.warning(f"claim_one: poll failed — {e}")
        return None

    lease = (_now() + timedelta(minutes=LEASE_MINUTES)).isoformat()
    try:
        upd = (db().table('growth_content_items')
               .update({
                   'asset_state':              'producing',
                   'asset_worker_lease_until': lease,
               })
               .eq('id', row['id'])
               .eq('asset_state', 'pending')  # idempotent guard
               .execute())
        if not upd.data:
            return None  # raced — another worker grabbed it
    except Exception as e:
        logger.warning(f"claim_one: claim update failed — {e}")
        return None

    return row


def finalise(content_id: str, kind_to_url: dict[str, str],
             requested: list[str]) -> None:
    """Patch asset_urls + asset_state once all producers have run."""
    successes = [k for k in requested if k in kind_to_url]
    if not successes:
        final_state = 'failed'
    elif len(successes) < len(requested):
        final_state = 'partial'
    else:
        final_state = 'ready'

    # Read-modify-write asset_urls so previous entries (e.g. from a
    # partial retry) survive.
    try:
        cur = (db().table('growth_content_items')
               .select('asset_urls')
               .eq('id', content_id).single().execute())
        merged = (cur.data or {}).get('asset_urls') or {}
    except Exception:
        merged = {}
    merged.update(kind_to_url)

    try:
        db().table('growth_content_items').update({
            'asset_state':              final_state,
            'asset_urls':               merged,
            'asset_worker_lease_until': None,
        }).eq('id', content_id).execute()
        logger.success(f"content_item {content_id[:8]} → {final_state} "
                       f"({len(successes)}/{len(requested)} kinds)")
    except Exception as e:
        logger.error(f"finalise: update failed — {e}")


def process(item: dict, wid: str) -> None:
    """Run every requested producer for one content_item."""
    requested = list(item.get('asset_kinds') or [])
    if not requested:
        # No assets — flip to 'ready' so the scheduler picks it up.
        logger.info(f"content_item {item['id'][:8]} has no asset_kinds; marking ready")
        finalise(item['id'], {}, [])
        return

    kind_to_url: dict[str, str] = {}

    with tempfile.TemporaryDirectory(prefix='asset-') as tmp:
        out_dir = Path(tmp)
        for kind in requested:
            if not producers.has(kind):
                logger.warning(f"content_item {item['id'][:8]} unknown kind={kind} — skip")
                log_attempt(content_item_id=item['id'], asset_kind=kind, ok=False,
                            error=f'no producer for kind {kind!r}', worker_id=wid)
                continue

            t0 = time.monotonic()
            try:
                # All producers take (item, out_dir, kind) so a single
                # producer module can serve many asset kinds dispatched
                # by name. Returns dict[produced_kind, local_path].
                produced = producers.get(kind)(item, out_dir, kind)
            except Exception as e:
                logger.error(f"producer {kind} crashed — {e}")
                log_attempt(content_item_id=item['id'], asset_kind=kind, ok=False,
                            error=str(e), worker_id=wid,
                            duration_ms=int((time.monotonic() - t0) * 1000))
                continue

            # Upload each produced file. produce() can return multiple
            # entries if a single run yields several derivatives.
            for produced_kind, local in produced.items():
                ext = local.suffix.lstrip('.') or 'png'
                url, path, bytes_ = upload(local, item['id'], produced_kind, ext=ext)
                duration_ms = int((time.monotonic() - t0) * 1000)
                if url:
                    kind_to_url[produced_kind] = url
                    log_attempt(content_item_id=item['id'], asset_kind=produced_kind,
                                ok=True, url=url, storage_path=path, bytes_=bytes_,
                                duration_ms=duration_ms, worker_id=wid)
                else:
                    log_attempt(content_item_id=item['id'], asset_kind=produced_kind,
                                ok=False, error='upload failed',
                                duration_ms=duration_ms, worker_id=wid)

    finalise(item['id'], kind_to_url, requested)


def main() -> None:
    logger.info("AlgoSphere asset-worker starting up")
    logger.info(f"  poll_interval_s={POLL_INTERVAL_S}")
    logger.info(f"  lease_minutes={LEASE_MINUTES}")
    logger.info(f"  known_kinds={producers.known_kinds()}")

    # Make sure the storage bucket exists before the first poll.
    ensure_bucket_exists()

    wid = worker_id()
    logger.info(f"  worker_id={wid}")
    logger.info(f"  factory: gen={factory.GEN_ENABLED()} publish={factory.PUB_ENABLED()} "
                f"queue_target={factory.QUEUE_TARGET()} publish_interval_s={factory.PUBLISH_INTERVAL()}")

    last_gen = last_pub = last_heal = 0.0

    def factory_tick() -> None:
        """Run generation / publishing / self-heal on their own cadences.
        Each call self-gates on its env flag — safe when disabled."""
        nonlocal last_gen, last_pub, last_heal
        now = time.monotonic()
        if now - last_heal > HEAL_EVERY_S:
            factory.run_selfheal(); last_heal = now
        if now - last_gen > GEN_EVERY_S:
            factory.run_generator()
            founder.run_founder_factory()   # real events → founder reels
            last_gen = now
        if now - last_pub > PUB_EVERY_S:
            factory.run_publisher(); last_pub = now

    idle_strikes = 0
    while True:
        try:
            factory_tick()
        except Exception as e:
            logger.warning(f"factory_tick error (non-fatal) — {e}")

        item = claim_one()
        if item is None:
            # Adaptive backoff — quiet periods don't hammer the DB.
            idle_strikes = min(idle_strikes + 1, 6)
            sleep_s = POLL_INTERVAL_S * (1 + idle_strikes // 2)
            time.sleep(sleep_s)
            continue

        idle_strikes = 0
        logger.info(f"claimed content_item {item['id'][:8]} kind={item.get('kind')!r} "
                    f"asset_kinds={item.get('asset_kinds')!r}")
        try:
            process(item, wid)
        except Exception as e:
            logger.error(f"process crashed for {item['id'][:8]} — {e}")
            # Mark as failed so a retry isn't endless.
            try:
                db().table('growth_content_items').update({
                    'asset_state': 'failed',
                    'asset_worker_lease_until': None,
                }).eq('id', item['id']).execute()
            except Exception:
                pass


if __name__ == '__main__':
    main()
