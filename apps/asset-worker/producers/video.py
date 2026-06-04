"""
Video producer — produces MP4 + JPG thumbnail for nine kinds via one
generic Remotion composition (`event_video`) bound to per-kind voice
scripts.

Pipeline:
  1. Compose a per-kind narration script from event payload.
  2. Generate voiceover MP3s via edge-tts (no API key required).
  3. Build a timings.json the Remotion composition reads.
  4. Run `npx remotion render` as a subprocess against the
     marketing/videos project's `event_video` composition.
  5. Extract a thumbnail JPG with FFmpeg.
  6. Return both files for upload.

The same `event_video` composition lives in marketing/videos/src/
and reads its props from the timings.json — so every kind shares
the same Remotion code, only the script + visual recipe change.
"""
from __future__ import annotations
import asyncio
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

from loguru import logger
import edge_tts


# Where the Remotion project lives. Resolved relative to this file
# so the worker works from any cwd.
_REMOTION_ROOT = Path(__file__).resolve().parent.parent.parent / 'marketing' / 'videos'


# Per-kind voice script. Each line becomes one edge-tts utterance
# and one Remotion scene. Use {placeholders} that pull from the
# event payload (case-insensitive on keys).
_VOICE_SCRIPTS: dict[str, dict] = {
    'signal_reel': {
        'voice': 'en-US-ChristopherNeural',
        'rate':  '+5%',
        'lines': [
            ('hook',     'New signal. {pair}. {direction}.'),
            ('levels',   'Entry {entry}. Stop {stop_loss}. Target {take_profit}.'),
            ('conf',     'Conviction {confidence} out of one hundred.'),
            ('gate',     'Cleared fifteen institutional risk gates.'),
            ('cta',      'Take the trade on AlgoSphere. Link in bio.'),
        ],
    },
    'trade_recap_video': {
        'voice': 'en-US-AriaNeural',
        'rate':  '+5%',
        'lines': [
            ('hook',    '{pair} {direction}. Closed.'),
            ('pnl',     'Result: {pnl} dollars.'),
            ('process', 'Process grade: {process_grade}.'),
            ('cta',     'Track every trade automatically on AlgoSphere.'),
        ],
    },
    'weekly_recap_video': {
        'voice': 'en-US-ChristopherNeural',
        'rate':  '+5%',
        'lines': [
            ('hook',    'Weekly recap. Net P and L {net_pnl} dollars.'),
            ('rate',    'Win rate {win_rate} percent over {trades} trades.'),
            ('pf',      'Profit factor {profit_factor}.'),
            ('dd',      'Maximum drawdown {max_drawdown} percent. Discipline held.'),
            ('cta',     "Follow next week's signals on AlgoSphere."),
        ],
    },
    'monthly_recap_video': {
        'voice': 'en-US-ChristopherNeural',
        'rate':  '+3%',
        'lines': [
            ('hook',    'Monthly performance. {growth_pct} percent cumulative return.'),
            ('aum',     'Assets under management: {aum} dollars.'),
            ('sharpe',  'Sharpe ratio {sharpe}. Max drawdown {max_drawdown} percent.'),
            ('cta',     'Read the full investor update on the blog.'),
        ],
    },
    'daily_market_video': {
        'voice': 'en-US-JennyNeural',
        'rate':  '+3%',
        'lines': [
            ('hook',    'Markets today. {headline}.'),
            ('regime',  'Regime: {regime_state}. Volatility: {volatility_state}.'),
            ('cta',     'Trade the regime. Live read on AlgoSphere.'),
        ],
    },
    'educational_video': {
        'voice': 'en-US-JennyNeural',
        'rate':  '+5%',
        'lines': [
            ('hook',     '{hook}'),
            ('concept',  '{concept}'),
            ('takeaway', '{takeaway}'),
            ('cta',      'Learn more on AlgoSphere.'),
        ],
    },
    'feature_demo_video': {
        'voice': 'en-US-GuyNeural',
        'rate':  '+8%',
        'lines': [
            ('hook',     'New in AlgoSphere. {feature}.'),
            ('problem',  '{problem}'),
            ('solution', '{solution}'),
            ('cta',      'Try it now. Link in bio.'),
        ],
    },
    'achievement_video': {
        'voice': 'en-US-AriaNeural',
        'rate':  '+5%',
        'lines': [
            ('hook',     'Milestone reached. {achievement}.'),
            ('detail',   '{description}'),
            ('cta',      'Join the community.'),
        ],
    },
    'investor_update_video': {
        'voice': 'en-US-ChristopherNeural',
        'rate':  '+3%',
        'lines': [
            ('hook',    'Investor update. {period}.'),
            ('return',  '{growth_pct} percent return. Sharpe {sharpe}.'),
            ('risk',    'Drawdown contained at {max_drawdown} percent.'),
            ('cta',     'Full report on the blog.'),
        ],
    },
}


def _fmt(template: str, payload: dict) -> str:
    """Replace {keys} with payload values; missing → empty string so
    the audio doesn't speak "{stop_loss}"."""
    def sub(m):
        key = m.group(1)
        v = payload.get(key)
        if v is None or v == '':
            return '—'
        return str(v)
    import re
    return re.sub(r'\{(\w+)\}', sub, template)


async def _tts_one(voice: str, rate: str, text: str, out: Path) -> float:
    com = edge_tts.Communicate(text=text, voice=voice, rate=rate)
    await com.save(str(out))
    try:
        from mutagen.mp3 import MP3
        return MP3(str(out)).info.length
    except Exception:
        # Conservative estimate when mutagen isn't available.
        return max(1.5, len(text.split()) / 2.6 + 0.4)


async def _build_timings(asset_kind: str, payload: dict, out_dir: Path) -> dict:
    spec = _VOICE_SCRIPTS.get(asset_kind, _VOICE_SCRIPTS['signal_reel'])
    voice = spec['voice']; rate = spec['rate']

    cursor = 0.0
    lines: List[dict] = []
    for i, (line_id, tmpl) in enumerate(spec['lines']):
        text = _fmt(tmpl, payload)
        mp3 = out_dir / f'line_{i:02d}_{line_id}.mp3'
        dur = await _tts_one(voice, rate, text, mp3)
        lines.append({
            'id':      line_id,
            'text':    text,
            'mp3':     mp3.name,
            'start_s': round(cursor, 3),
            'dur_s':   round(dur, 3),
        })
        cursor += dur + 0.35
    total = cursor - 0.35
    return {
        'id':       f'event_video_{asset_kind}',
        'title':    asset_kind,
        'voice':    voice,
        'total_s':  round(total, 3),
        'gap_s':    0.35,
        'fps':      30,
        'width':    1080,
        'height':   1920,
        'lines':    lines,
        'asset_kind': asset_kind,
        'payload':  payload,
    }


def _have(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def _remotion_render(timings: dict, public_dir: Path, mp4_path: Path) -> None:
    """Run `npx remotion render` against the event_video composition.

    The composition (marketing/videos/src/event_video.tsx) reads its
    timings + asset_kind + payload from the staticFile timings.json.
    We write that file under public/event_video_<asset_kind>/ so the
    composition resolves it via staticFile(...).
    """
    if not _have('npx'):
        raise RuntimeError('npx not available — install Node + Remotion deps in the worker image')

    composition_id = 'event_video'
    # Put timings + audio under public/<id>/ where staticFile reads from.
    serve_dir = _REMOTION_ROOT / 'public' / f'event_video_{timings["asset_kind"]}'
    serve_dir.mkdir(parents=True, exist_ok=True)
    for fname in public_dir.iterdir():
        target = serve_dir / fname.name
        if target.exists():
            target.unlink()
        shutil.copy(fname, target)
    (serve_dir / 'timings.json').write_text(json.dumps(timings, indent=2), encoding='utf-8')

    cmd = ['npx', 'remotion', 'render', composition_id, str(mp4_path),
           '--props=' + json.dumps({'asset_kind': timings['asset_kind']}),
           '--log=warn']
    res = subprocess.run(cmd, cwd=str(_REMOTION_ROOT),
                         capture_output=True, text=True, timeout=600)
    if res.returncode != 0:
        raise RuntimeError(f'remotion render failed (exit {res.returncode}): '
                           f'{(res.stderr or res.stdout)[-400:]}')


def _ffmpeg_thumbnail(mp4_path: Path, jpg_path: Path, at_seconds: float = 1.5) -> None:
    if not _have('ffmpeg'):
        raise RuntimeError('ffmpeg not available — install in the worker image')
    cmd = ['ffmpeg', '-y', '-ss', str(at_seconds), '-i', str(mp4_path),
           '-vframes', '1', '-q:v', '3', str(jpg_path)]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if res.returncode != 0 or not jpg_path.exists() or jpg_path.stat().st_size == 0:
        raise RuntimeError(f'ffmpeg thumbnail failed: {(res.stderr or "")[-300:]}')


def produce(item: dict, out_dir: Path, asset_kind: str = 'signal_reel') -> Dict[str, Path]:
    prov = item.get('provenance') or {}
    payload = prov.get('payload') or prov

    # Local public dir holds the MP3s for staticFile lookup.
    local_pub = out_dir / 'public'
    local_pub.mkdir(parents=True, exist_ok=True)

    timings = asyncio.run(_build_timings(asset_kind, payload, local_pub))

    mp4 = out_dir / f'{asset_kind}.mp4'
    thumb = out_dir / f'{asset_kind}_thumbnail.jpg'

    _remotion_render(timings, local_pub, mp4)
    _ffmpeg_thumbnail(mp4, thumb, at_seconds=min(2.0, max(0.5, timings['total_s'] / 4)))

    logger.info(f"video {asset_kind} produced "
                f"({mp4.stat().st_size} bytes mp4, {thumb.stat().st_size} bytes jpg)")
    return {
        asset_kind:                    mp4,
        f'{asset_kind}_thumbnail':     thumb,
    }
