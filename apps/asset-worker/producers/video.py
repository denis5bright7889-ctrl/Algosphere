"""
Video producer — Media Engine V2 (no voice, music-only).

Pipeline:
  1. Build a per-kind scene script from the event payload. No TTS — each
     scene's duration is computed from text length + a configurable
     minimum dwell time, so captions remain readable.
  2. Write timings.json (the dynamic-data props the Remotion composition
     reads via staticFile lookup at render time).
  3. Run `npx remotion render event_video` as a subprocess against the
     marketing/videos project. Output is a silent MP4 with captions +
     motion graphics + chart accents.
  4. If a royalty-free music track is present under
     marketing/videos/public/music/{theme}.mp3, ffmpeg-mux it under the
     video at low gain with a tail fade. Missing track = silent video
     (production-safe; never breaks the render).
  5. Extract a thumbnail JPG with FFmpeg.
  6. Return both files for upload by the worker.

The same `event_video` composition lives in marketing/videos/src/ and
reads its props from the timings.json — every kind shares the same
Remotion code, only the script + visual recipe change.

Music selection is per-kind via _MUSIC_THEME. Override globally with
the ALGOSPHERE_AUDIO_THEME env var (set in Railway). To swap tracks,
drop new MP3s into marketing/videos/public/music/ — no code change.
"""
from __future__ import annotations
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List

from loguru import logger


# Where the Remotion project lives. Resolved relative to this file
# so the worker works from any cwd.
_REMOTION_ROOT = Path(__file__).resolve().parent.parent.parent / 'marketing' / 'videos'
_MUSIC_DIR     = _REMOTION_ROOT / 'public' / 'music'


# Per-kind caption script. Each entry becomes one Remotion scene with
# motion + caption. Placeholders are pulled from the event payload at
# render time. Keep lines short — these are captions, not narration.
_SCENE_SCRIPTS: dict[str, dict] = {
    'signal_reel': {
        'theme': 'tense',
        'lines': [
            ('hook',     'New signal · {pair} · {direction}'),
            ('levels',   'Entry {entry} · SL {stop_loss} · TP {take_profit}'),
            ('conf',     'Conviction {confidence}/100'),
            ('gate',     '15 institutional risk gates · CLEARED'),
            ('cta',      'algospherequant.com'),
        ],
    },
    'trade_recap_video': {
        'theme': 'reflective',
        'lines': [
            ('hook',    '{pair} {direction} · CLOSED'),
            ('pnl',     'Result · {pnl} USD'),
            ('process', 'Process grade · {process_grade}'),
            ('cta',     'Track every trade — algospherequant.com'),
        ],
    },
    'weekly_recap_video': {
        'theme': 'institutional',
        'lines': [
            ('hook',    'Weekly recap · Net P&L {net_pnl} USD'),
            ('rate',    'Win rate {win_rate}% · {trades} trades'),
            ('pf',      'Profit factor {profit_factor}'),
            ('dd',      'Max drawdown {max_drawdown}% · discipline held'),
            ('cta',     'Next week — algospherequant.com'),
        ],
    },
    'monthly_recap_video': {
        'theme': 'institutional',
        'lines': [
            ('hook',    'Monthly performance · {growth_pct}% return'),
            ('aum',     'AUM · {aum} USD'),
            ('sharpe',  'Sharpe {sharpe} · Max DD {max_drawdown}%'),
            ('cta',     'Full update on the blog'),
        ],
    },
    'daily_market_video': {
        'theme': 'tense',
        'lines': [
            ('hook',    'Markets today · {headline}'),
            ('regime',  'Regime {regime_state} · Vol {volatility_state}'),
            ('cta',     'Live read · algospherequant.com'),
        ],
    },
    'educational_video': {
        'theme': 'institutional',
        'lines': [
            ('hook',     '{hook}'),
            ('concept',  '{concept}'),
            ('takeaway', '{takeaway}'),
            ('cta',      'Learn more · algospherequant.com'),
        ],
    },
    'feature_demo_video': {
        'theme': 'lift',
        'lines': [
            ('hook',     'New in AlgoSphere · {feature}'),
            ('problem',  '{problem}'),
            ('solution', '{solution}'),
            ('cta',      'Try it · algospherequant.com'),
        ],
    },
    'achievement_video': {
        'theme': 'lift',
        'lines': [
            ('hook',     'Milestone · {achievement}'),
            ('detail',   '{description}'),
            ('cta',      'Join · algospherequant.com'),
        ],
    },
    'investor_update_video': {
        'theme': 'institutional',
        'lines': [
            ('hook',    'Investor update · {period}'),
            ('return',  '{growth_pct}% return · Sharpe {sharpe}'),
            ('risk',    'Drawdown contained at {max_drawdown}%'),
            ('cta',     'Full report — link in bio'),
        ],
    },
}


# Default scene dwell time tuning. Captions need to be readable, so
# every scene gets at least MIN_S, and longer captions stretch to
# READING_RATE seconds per word. Capped at MAX_S to keep clips snappy
# for Reels/Shorts/TikTok pacing.
_MIN_SCENE_S      = 2.4
_MAX_SCENE_S      = 5.0
_READING_RATE_WPS = 2.6   # words per second (calm caption reading)
_SCENE_GAP_S      = 0.25  # small ease between scenes


def _fmt(template: str, payload: dict) -> str:
    """Replace {keys} with payload values; missing → em-dash so a missing
    field never reads as the literal placeholder string."""
    def sub(m):
        key = m.group(1)
        v = payload.get(key)
        if v is None or v == '':
            return '—'
        return str(v)
    import re
    return re.sub(r'\{(\w+)\}', sub, template)


def _scene_duration_s(text: str) -> float:
    """Calm-reading dwell time for a caption."""
    words = max(1, len(text.split()))
    raw = max(_MIN_SCENE_S, words / _READING_RATE_WPS + 0.6)
    return min(_MAX_SCENE_S, round(raw, 3))


def _build_timings(asset_kind: str, payload: dict) -> dict:
    spec = _SCENE_SCRIPTS.get(asset_kind, _SCENE_SCRIPTS['signal_reel'])
    cursor = 0.0
    lines: List[dict] = []
    for line_id, tmpl in spec['lines']:
        text = _fmt(tmpl, payload)
        dur  = _scene_duration_s(text)
        lines.append({
            'id':      line_id,
            'text':    text,
            # mp3 kept in the schema for backward-compat with the
            # Remotion composition's optional <Audio> reference; the
            # composition tolerates a missing/empty file and renders
            # silent (see event_video.tsx Audio fallback logic).
            'mp3':     '',
            'start_s': round(cursor, 3),
            'dur_s':   dur,
        })
        cursor += dur + _SCENE_GAP_S
    total = max(_MIN_SCENE_S, cursor - _SCENE_GAP_S)
    return {
        'id':         f'event_video_{asset_kind}',
        'title':      asset_kind,
        'theme':      spec.get('theme', 'institutional'),
        'voice':      'music_only',
        'total_s':    round(total, 3),
        'gap_s':      _SCENE_GAP_S,
        'fps':        30,
        'width':      1080,
        'height':     1920,
        'lines':      lines,
        'asset_kind': asset_kind,
        'payload':    payload,
    }


def _have(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def _remotion_render(timings: dict, mp4_path: Path) -> None:
    """Run `npx remotion render event_video` against the composition.
    Renders SILENT — music is muxed in a follow-up ffmpeg step. The
    composition reads its timings + asset_kind + payload from a static
    file written into public/event_video_<asset_kind>/.
    """
    if not _have('npx'):
        raise RuntimeError('npx not available — install Node + Remotion deps in the worker image')

    composition_id = 'event_video'
    serve_dir = _REMOTION_ROOT / 'public' / f'event_video_{timings["asset_kind"]}'
    serve_dir.mkdir(parents=True, exist_ok=True)
    (serve_dir / 'timings.json').write_text(json.dumps(timings, indent=2), encoding='utf-8')

    cmd = ['npx', 'remotion', 'render', composition_id, str(mp4_path),
           '--props=' + json.dumps({'asset_kind': timings['asset_kind']}),
           '--log=warn']
    res = subprocess.run(cmd, cwd=str(_REMOTION_ROOT),
                         capture_output=True, text=True, timeout=600)
    if res.returncode != 0:
        raise RuntimeError(f'remotion render failed (exit {res.returncode}): '
                           f'{(res.stderr or res.stdout)[-400:]}')


def _pick_music_track(theme: str) -> Path | None:
    """Resolve a royalty-free background-music track for the given theme.

    Resolution order:
      1. ALGOSPHERE_AUDIO_THEME env override (force-pin one track).
      2. `public/music/<theme>.mp3`.
      3. `public/music/default.mp3`.
      4. `public/music/*.mp3` (alphabetical first) — last-resort
         so a single dropped track applies to every kind.

    Returns None if `public/music/` is empty — render stays silent.
    """
    if not _MUSIC_DIR.is_dir():
        return None
    override = os.environ.get('ALGOSPHERE_AUDIO_THEME', '').strip()
    if override:
        cand = _MUSIC_DIR / f'{override}.mp3'
        if cand.is_file():
            return cand
    cand = _MUSIC_DIR / f'{theme}.mp3'
    if cand.is_file():
        return cand
    cand = _MUSIC_DIR / 'default.mp3'
    if cand.is_file():
        return cand
    tracks = sorted(_MUSIC_DIR.glob('*.mp3'))
    return tracks[0] if tracks else None


def _ffmpeg_mux_music(silent_mp4: Path, music: Path, out_mp4: Path,
                     total_s: float) -> None:
    """Loop the background-music track under the video, normalise gain,
    fade the tail, and clip to the video duration.

    -25dB keeps the music supportive rather than overpowering the
    motion graphics; the tail fade (last 0.5s) avoids an audio cliff.
    """
    if not _have('ffmpeg'):
        raise RuntimeError('ffmpeg not available — install in the worker image')
    fade_start = max(0.0, total_s - 0.5)
    cmd = [
        'ffmpeg', '-y',
        '-i', str(silent_mp4),
        '-stream_loop', '-1', '-i', str(music),
        '-filter_complex',
        f'[1:a]volume=-25dB,afade=t=out:st={fade_start:.2f}:d=0.5[aud]',
        '-map', '0:v:0', '-map', '[aud]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
        '-shortest', '-movflags', '+faststart',
        str(out_mp4),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if res.returncode != 0:
        raise RuntimeError(f'ffmpeg mux failed (exit {res.returncode}): '
                           f'{(res.stderr or "")[-300:]}')


def _ffmpeg_thumbnail(mp4_path: Path, jpg_path: Path, at_seconds: float = 1.5) -> None:
    if not _have('ffmpeg'):
        raise RuntimeError('ffmpeg not available — install in the worker image')
    cmd = ['ffmpeg', '-y', '-ss', str(at_seconds), '-i', str(mp4_path),
           '-vframes', '1', '-q:v', '3', str(jpg_path)]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if res.returncode != 0 or not jpg_path.exists() or jpg_path.stat().st_size == 0:
        raise RuntimeError(f'ffmpeg thumbnail failed: {(res.stderr or "")[-300:]}')


def produce(item: dict, out_dir: Path, asset_kind: str = 'signal_reel') -> Dict[str, Path]:
    """
    Render one music-backed caption video for the given asset_kind.

    Output files:
      out_dir/<kind>.mp4
      out_dir/<kind>_thumbnail.jpg

    Honest behaviors:
      • If no royalty-free track is bundled, the final MP4 is silent —
        not a failure. Renders complete; uploads happen as usual.
      • Captions never run shorter than 2.4s nor longer than 5.0s.
      • A 0.5s tail audio fade prevents a cliff cut.
    """
    prov = item.get('provenance') or {}
    payload = prov.get('payload') or prov

    timings = _build_timings(asset_kind, payload)

    silent_mp4 = out_dir / f'{asset_kind}_silent.mp4'
    final_mp4  = out_dir / f'{asset_kind}.mp4'
    thumb      = out_dir / f'{asset_kind}_thumbnail.jpg'

    _remotion_render(timings, silent_mp4)

    music = _pick_music_track(timings['theme'])
    if music is None:
        # No track bundled — promote the silent render as the final.
        # We do this via a copy so the silent intermediate is still
        # available in tmp until the worker cleans up; the final file
        # name matches uploaded-asset expectations.
        shutil.copy(silent_mp4, final_mp4)
        logger.info(f"video {asset_kind} rendered silent "
                    f"({final_mp4.stat().st_size} bytes; no music track present)")
    else:
        _ffmpeg_mux_music(silent_mp4, music, final_mp4, timings['total_s'])
        logger.info(f"video {asset_kind} rendered with music={music.name} "
                    f"({final_mp4.stat().st_size} bytes)")

    _ffmpeg_thumbnail(final_mp4, thumb, at_seconds=min(2.0, max(0.5, timings['total_s'] / 4)))

    return {
        asset_kind:                    final_mp4,
        f'{asset_kind}_thumbnail':     thumb,
    }
