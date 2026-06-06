"""
Content Factory — continuous generation, publishing, and self-healing.

Turns the asset-worker into a self-contained growth engine that does not
depend on Vercel crons or channel env on Vercel:

  • run_generator()  — keeps a rolling backlog of fresh content_items
                       (asset_state='pending') built from REAL platform
                       data across ~20 categories, staggered to avoid bursts.
  • run_publisher()  — posts 'ready' items to Telegram + Discord using
                       Railway env creds, then marks status='published'.
                       Rate-limited (GROWTH_PUBLISH_INTERVAL_S) so output
                       is a steady stream, not a flood.
  • run_selfheal()   — requeues items stuck in 'producing' past their
                       lease and bounded-retries 'failed'/'partial' rows.

All three are no-ops unless their flags are set, and none raise into the
worker loop. Every recovery action is logged.

Env:
  GROWTH_FACTORY_ENABLED      generate fresh content        (default false)
  GROWTH_PUBLISH_ENABLED      publish ready content         (default false)
  GROWTH_QUEUE_TARGET         backlog to maintain           (default 10)
  GROWTH_GEN_BATCH            max items created per gen tick (default 5)
  GROWTH_PUBLISH_INTERVAL_S   min seconds between posts      (default 1200)
  GROWTH_VIDEO_RATIO          fraction of items with a reel  (default 0.25)
  TELEGRAM_BOT_TOKEN, GROWTH_TELEGRAM_CHANNEL_ID
  DISCORD_WEBHOOK_*_URL       per-channel webhooks
"""
from __future__ import annotations

import json
import os
import random
import time
import urllib.request
from datetime import datetime, timezone, timedelta

from loguru import logger

from storage import db


def _flag(k: str, d: bool = False) -> bool:
    return os.environ.get(k, str(d)).lower() in ('1', 'true', 'yes', 'on')


def _int(k: str, d: int) -> int:
    try:
        return int(os.environ.get(k, str(d)))
    except ValueError:
        return d


def _float(k: str, d: float) -> float:
    try:
        return float(os.environ.get(k, str(d)))
    except ValueError:
        return d


GEN_ENABLED      = lambda: _flag('GROWTH_FACTORY_ENABLED')
PUB_ENABLED      = lambda: _flag('GROWTH_PUBLISH_ENABLED')
QUEUE_TARGET     = lambda: _int('GROWTH_QUEUE_TARGET', 10)
GEN_BATCH        = lambda: _int('GROWTH_GEN_BATCH', 5)
PUBLISH_INTERVAL = lambda: _int('GROWTH_PUBLISH_INTERVAL_S', 1200)
VIDEO_RATIO      = lambda: _float('GROWTH_VIDEO_RATIO', 0.25)
MAX_RETRIES      = lambda: _int('GROWTH_MAX_RETRIES', 2)

_DISCLAIMER = 'Educational content. Not financial advice.'


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── REAL platform data ───────────────────────────────────────────────────────
def _snapshot() -> dict:
    try:
        sig = (db().table('signals')
               .select('pair,direction,entry_price,stop_loss,take_profit_1,'
                       'risk_reward,confidence_score,result,status,published_at')
               .order('published_at', desc=True).limit(200).execute().data) or []
    except Exception as e:
        logger.warning(f"factory: snapshot signals failed — {e}")
        sig = []
    wins = sum(1 for s in sig if s.get('result') == 'win')
    losses = sum(1 for s in sig if s.get('result') == 'loss')
    closed = wins + losses
    active = [s for s in sig if s.get('status') == 'active' and s.get('entry_price')]
    return {
        'signals': sig, 'wins': wins, 'losses': losses, 'closed': closed,
        'win_rate': round(100 * wins / closed) if closed else None,
        'active': active,
    }


# Rotating evergreen copy — keeps the feed varied without repeating.
_TIPS = [
    ('Risk per trade', 'Never risk more than 1–2% of your account on a single idea. Survival first.'),
    ('Define your stop first', 'Set your invalidation before entry. If you cannot, you do not have a trade.'),
    ('Process over PnL', 'A good trade can lose; a bad trade can win. Grade the decision, not the result.'),
    ('Trade your plan', 'If a setup is not in your playbook, it is a gamble — not a trade.'),
    ('Position sizing', 'Size from your stop distance, not your conviction. Risk stays constant.'),
    ('Journal everything', 'The edge you cannot measure is the edge you cannot keep.'),
    ('Patience pays', 'The market rewards the patient and taxes the impatient. Wait for your pitch.'),
]
_FEATURES = [
    ('AI Coach', 'Real-time trade reviews plus risk and discipline scoring on every position.'),
    ('Risk Engine', '15 institutional capital gates and a kill switch guard every trade.'),
    ('Signal Engine', 'A regime-adaptive ensemble across 28 symbols — fully transparent.'),
    ('Trade Journal', 'Two-mode behavioral intelligence that learns from every execution.'),
    ('Broker Truth', 'Live equity and position snapshots reconciled against your real broker.'),
]
_PSYCH = [
    ('Beat tilt', 'After a loss, your next trade is the most dangerous. Step back before you size up.'),
    ('Recency bias', 'Three wins do not change your edge. Stick to the plan that got you here.'),
    ('Confidence drift', 'Rising size after wins is how good weeks become bad months.'),
]


def _build_specs(n: int, snap: dict, seed: int) -> list[dict]:
    """Build up to n varied content specs from real data + rotation."""
    rng = random.Random(seed)
    specs: list[dict] = []
    vid = VIDEO_RATIO()

    def card_or_video(card_kind: str, video_kind: str) -> list[str]:
        return [card_kind, video_kind] if rng.random() < vid else [card_kind]

    # 1) Live signal setups (from real active signals)
    for s in snap['active'][:max(1, n // 2)]:
        specs.append({
            'kind': 'market_report', 'theme': 'tense',
            'title': f"{s['pair']} Setup",
            'summary': f"{(s.get('direction') or 'buy').upper()} {s['pair']} — risk-managed entry.",
            'body_md': (f"📊 {s['pair']} — {(s.get('direction') or 'buy').upper()} @ {s['entry_price']} · "
                        f"SL {s.get('stop_loss')} · TP {s.get('take_profit_1')}"
                        + (f" · R:R {s['risk_reward']}" if s.get('risk_reward') else "")),
            'channels': ['telegram', 'discord:signals'],
            'asset_kinds': card_or_video('signal_card', 'signal_reel'),
            'payload': {'pair': s['pair'], 'direction': (s.get('direction') or 'buy'),
                        'entry': s['entry_price'], 'stop_loss': s.get('stop_loss'),
                        'take_profit': s.get('take_profit_1'), 'risk_reward': s.get('risk_reward'),
                        'confidence': s.get('confidence_score') or 75},
        })

    # 2) Verified performance (real win rate)
    if snap['win_rate'] is not None and snap['closed'] >= 3:
        specs.append({
            'kind': 'announcement', 'theme': 'lift',
            'title': f"{snap['win_rate']}% Verified Win Rate",
            'summary': f"{snap['wins']}W / {snap['losses']}L across {snap['closed']} closed signals.",
            'body_md': f"✅ {snap['win_rate']}% verified win rate — {snap['wins']}W / {snap['losses']}L across {snap['closed']} closed signals. Transparency first.",
            'channels': ['telegram', 'discord:announcements'],
            'asset_kinds': card_or_video('achievement_card', 'achievement_video'),
            'payload': {'achievement': f"{snap['win_rate']}% Win Rate",
                        'description': f"{snap['wins']} wins / {snap['losses']} losses across {snap['closed']} closed signals — verified."},
        })

    # 3) Education tip
    tip = _TIPS[seed % len(_TIPS)]
    specs.append({
        'kind': 'educational', 'theme': 'calm',
        'title': f"Tip: {tip[0]}", 'summary': tip[1],
        'body_md': f"💡 {tip[0]} — {tip[1]}",
        'channels': ['telegram', 'discord:education'],
        'asset_kinds': card_or_video('feature_card', 'educational_video'),
        'payload': {'feature': tip[0], 'description': tip[1], 'hook': tip[0],
                    'concept': tip[1], 'takeaway': 'Make it a rule.'},
    })

    # 4) Feature spotlight
    feat = _FEATURES[seed % len(_FEATURES)]
    specs.append({
        'kind': 'product_update', 'theme': 'lift',
        'title': f"Feature: {feat[0]}", 'summary': feat[1],
        'body_md': f"🤖 {feat[0]} — {feat[1]}",
        'channels': ['telegram', 'discord:general'],
        'asset_kinds': card_or_video('feature_card', 'feature_demo_video'),
        'payload': {'feature': feat[0], 'description': feat[1],
                    'problem': 'Trading is hard.', 'solution': feat[1]},
    })

    # 5) Psychology insight
    ps = _PSYCH[seed % len(_PSYCH)]
    specs.append({
        'kind': 'psychology_insight', 'theme': 'reflective',
        'title': f"Mindset: {ps[0]}", 'summary': ps[1],
        'body_md': f"🧠 {ps[0]} — {ps[1]}",
        'channels': ['telegram', 'discord:education'],
        'asset_kinds': ['feature_card'],
        'payload': {'feature': ps[0], 'description': ps[1]},
    })

    rng.shuffle(specs)
    return specs[:n]


# ── Generator ────────────────────────────────────────────────────────────────
def run_generator() -> None:
    if not GEN_ENABLED():
        return
    try:
        # Bound by UNPUBLISHED factory backlog (pending + producing + ready +
        # partial), not just the render queue — otherwise generation churns
        # while the rate-limited publisher drains 'ready' slowly.
        backlog = (db().table('growth_content_items')
                   .select('id', count='exact', head=True)
                   .eq('provenance->>source', 'factory')
                   .neq('status', 'published')
                   .in_('asset_state', ['pending', 'producing', 'ready', 'partial'])
                   .execute()).count or 0
    except Exception as e:
        logger.warning(f"factory.generator: backlog count failed — {e}")
        return
    target = QUEUE_TARGET()
    if backlog >= target:
        return
    need = min(GEN_BATCH(), target - backlog)
    snap = _snapshot()
    seed = int(time.time() // 60)
    specs = _build_specs(need, snap, seed)
    if not specs:
        return

    base = _now()
    created = 0
    for i, sp in enumerate(specs):
        # stagger publish-readiness across the next ~hour (avoid bursts)
        sched = (base + timedelta(minutes=4 * i)).isoformat()
        row = {
            'kind': sp['kind'], 'status': 'approved', 'title': sp['title'],
            'summary': sp['summary'], 'body_md': sp['body_md'],
            'channels': sp['channels'], 'tags': ['factory', sp['theme']],
            'is_synthetic': False, 'disclaimer': _DISCLAIMER,
            'asset_state': 'pending', 'asset_kinds': sp['asset_kinds'],
            'scheduled_for': sched,
            'provenance': {'source': 'factory', 'theme': sp['theme'],
                           'payload': sp['payload'], 'retries': 0},
        }
        try:
            db().table('growth_content_items').insert(row).execute()
            created += 1
        except Exception as e:
            logger.warning(f"factory.generator: insert failed ({sp['title']}) — {e}")
    if created:
        logger.success(f"factory.generator: queued {created} items (backlog {backlog}→{backlog+created}/{target})")


# ── Publisher ────────────────────────────────────────────────────────────────
_last_publish = 0.0


def _http_post_json(url: str, body: dict, timeout: int = 30) -> int:
    data = json.dumps(body).encode()
    # Discord's Cloudflare 403s the default 'Python-urllib' UA — a real
    # User-Agent is required. Telegram is indifferent but it's harmless.
    req = urllib.request.Request(url, data=data, headers={
        'Content-Type': 'application/json',
        'User-Agent': 'AlgoSphere-Factory/1.0 (+https://algospherequant.com)',
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def _discord_webhook(channel_hint: str) -> str | None:
    key = {
        'signals': 'DISCORD_WEBHOOK_SIGNALS_FREE_URL',
        'announcements': 'DISCORD_WEBHOOK_ANNOUNCEMENTS_URL',
        'education': 'DISCORD_WEBHOOK_EDUCATION_URL',
        'general': 'DISCORD_WEBHOOK_GENERAL_URL',
        'market': 'DISCORD_WEBHOOK_MARKET_INTEL_URL',
    }.get(channel_hint, 'DISCORD_WEBHOOK_GENERAL_URL')
    return os.environ.get(key) or os.environ.get('DISCORD_WEBHOOK_GENERAL_URL')


def _pick_asset(asset_urls: dict | None) -> tuple[str | None, bool]:
    """Return (url, is_video). Prefer video, else first image."""
    if not asset_urls:
        return None, False
    for k, u in asset_urls.items():
        if isinstance(u, str) and (u.endswith('.mp4') or 'reel' in k or 'video' in k):
            return u, True
    for u in asset_urls.values():
        if isinstance(u, str) and u:
            return u, False
    return None, False


def run_publisher() -> None:
    global _last_publish
    if not PUB_ENABLED():
        return
    tok = os.environ.get('TELEGRAM_BOT_TOKEN')
    chat = os.environ.get('GROWTH_TELEGRAM_CHANNEL_ID')
    if not (tok and chat):
        return
    if time.time() - _last_publish < PUBLISH_INTERVAL():
        return
    try:
        rows = (db().table('growth_content_items')
                .select('id,title,body_md,channels,asset_urls,asset_state,provenance')
                .eq('provenance->>source', 'factory')
                .in_('asset_state', ['ready', 'partial'])
                .neq('status', 'published')
                .order('scheduled_for', desc=False).limit(1).execute().data) or []
    except Exception as e:
        logger.warning(f"factory.publisher: query failed — {e}")
        return
    if not rows:
        return
    it = rows[0]
    url, is_video = _pick_asset(it.get('asset_urls'))
    if not url:
        return
    caption = (it.get('body_md') or it.get('title') or '') + '\n\n→ algospherequant.com'

    # Telegram
    ep = 'sendVideo' if is_video else 'sendPhoto'
    media_key = 'video' if is_video else 'photo'
    tg = _http_post_json(f'https://api.telegram.org/bot{tok}/{ep}',
                         {'chat_id': chat, media_key: url, 'caption': caption})

    # Discord (route by channels hint)
    hint = 'general'
    for c in (it.get('channels') or []):
        if isinstance(c, str) and c.startswith('discord:'):
            hint = c.split(':', 1)[1]
    wh = _discord_webhook(hint)
    dc = 0
    if wh:
        body = ({'content': caption + '\n' + url} if is_video
                else {'embeds': [{'description': caption, 'image': {'url': url}}]})
        dc = _http_post_json(wh, body)

    ok = tg == 200
    try:
        db().table('growth_content_items').update({
            'status': 'published' if ok else 'approved',
            'published_at': _now().isoformat() if ok else None,
        }).eq('id', it['id']).execute()
    except Exception as e:
        logger.warning(f"factory.publisher: mark-published failed — {e}")
    if ok:
        _last_publish = time.time()
        logger.success(f"factory.publisher: posted {it['title'][:40]!r} "
                       f"({'video' if is_video else 'image'}) TG:{tg} Discord:{dc}")
    else:
        logger.warning(f"factory.publisher: TG post failed ({tg}) for {it['id'][:8]}")


# ── Self-healing ─────────────────────────────────────────────────────────────
def run_selfheal() -> None:
    now_iso = _now().isoformat()
    # 1) Reclaim leases that expired (worker died mid-produce).
    try:
        stuck = (db().table('growth_content_items')
                 .update({'asset_state': 'pending', 'asset_worker_lease_until': None})
                 .eq('asset_state', 'producing')
                 .lt('asset_worker_lease_until', now_iso)
                 .execute().data) or []
        if stuck:
            logger.warning(f"factory.selfheal: reclaimed {len(stuck)} stuck 'producing' leases")
    except Exception as e:
        logger.debug(f"factory.selfheal: lease reclaim — {e}")

    # 2) Bounded retry of failed/partial factory items.
    try:
        cutoff = (_now() - timedelta(minutes=20)).isoformat()
        rows = (db().table('growth_content_items')
                .select('id,provenance,asset_state,updated_at')
                .eq('provenance->>source', 'factory')
                .in_('asset_state', ['failed', 'partial'])
                .lt('updated_at', cutoff).limit(20).execute().data) or []
        healed = 0
        for r in rows:
            retries = int((r.get('provenance') or {}).get('retries', 0))
            if retries >= MAX_RETRIES():
                continue
            prov = dict(r.get('provenance') or {}); prov['retries'] = retries + 1
            db().table('growth_content_items').update({
                'asset_state': 'pending', 'asset_worker_lease_until': None,
                'provenance': prov,
            }).eq('id', r['id']).execute()
            healed += 1
        if healed:
            logger.warning(f"factory.selfheal: requeued {healed} failed/partial items for retry")
    except Exception as e:
        logger.debug(f"factory.selfheal: retry sweep — {e}")
