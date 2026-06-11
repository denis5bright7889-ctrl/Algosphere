"""
Video producer — Media Engine V3 (ffmpeg-only, music-only, no narration).

Why V3: the Remotion/Node render path failed 100% in production
("No entry point specified", "could not determine executable to run") —
every signal_reel attempt errored, leaving content_items stuck at
asset_state='partial' so they never published. V3 removes the Node /
Remotion dependency entirely. Videos are built from PIL-rendered
vertical scene frames assembled with ffmpeg (both already in the worker
image), so a render can never fail for lack of Node tooling.

Pipeline:
  1. Build a per-kind scene script from the payload (captions, no TTS).
  2. Render each scene as a 1080x1920 branded PNG (PIL).
  3. ffmpeg: turn each frame into a Ken-Burns clip of its dwell time,
     concat the clips into one silent vertical MP4.
  4. Mux theme music under the video. Track resolution order:
       a. ALGOSPHERE_AUDIO_THEME / per-kind theme MP3 in a music dir, else
       b. a synthesized royalty-free theme bed (ffmpeg lavfi) so every
          video has contextual music with no copyrighted files.
     Narration is never used — music-only is the default and the only mode.
  5. Extract a thumbnail JPG.

Music-only is guaranteed: if even the synth fails, the video is promoted
silent rather than failing the whole job (production-safe).
"""
from __future__ import annotations
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List

from PIL import Image, ImageDraw
from loguru import logger

from . import _brand as B


FPS    = 30
WIDTH  = 1080
HEIGHT = 1920


# Optional drop-in real music. Drop MP3s here (or set a music dir via
# ALGOSPHERE_MUSIC_DIR) to override the synthesized beds — no code change.
def _music_dir() -> Path | None:
    env = os.environ.get('ALGOSPHERE_MUSIC_DIR', '').strip()
    cands = [Path(env)] if env else []
    here = Path(__file__).resolve()
    cands += [
        here.parent.parent / 'assets' / 'music',
        here.parent.parent / 'marketing' / 'videos' / 'public' / 'music',
        here.parent.parent.parent.parent / 'marketing' / 'videos' / 'public' / 'music',
    ]
    for c in cands:
        if c and c.is_dir():
            return c
    return None


# Per-kind caption script + theme. Captions, not narration — short lines.
_SCENE_SCRIPTS: dict[str, dict] = {
    'signal_reel': {'theme': 'tense', 'lines': [
        ('hook',   'New signal'),
        ('pair',   '{pair} · {direction}'),
        ('levels', 'Entry {entry}\nSL {stop_loss} · TP {take_profit}'),
        ('conf',   'Conviction {confidence}/100'),
        ('gate',   '15 risk gates · CLEARED'),
        ('cta',    'algospherequant.com'),
    ]},
    'trade_recap_video': {'theme': 'reflective', 'lines': [
        ('hook', '{pair} {direction}'),
        ('res',  'CLOSED'),
        ('pnl',  '{pnl} USD'),
        ('proc', 'Process grade {process_grade}'),
        ('cta',  'algospherequant.com'),
    ]},
    'weekly_recap_video': {'theme': 'institutional', 'lines': [
        ('hook', 'Weekly recap'),
        ('pnl',  'Net P&L {net_pnl} USD'),
        ('rate', 'Win rate {win_rate}% · {trades} trades'),
        ('pf',   'Profit factor {profit_factor}'),
        ('cta',  'algospherequant.com'),
    ]},
    'monthly_recap_video': {'theme': 'institutional', 'lines': [
        ('hook',  'Monthly performance'),
        ('ret',   '{growth_pct}% return'),
        ('risk',  'Max DD {max_drawdown}%'),
        ('cta',   'algospherequant.com'),
    ]},
    'daily_market_video': {'theme': 'tense', 'lines': [
        ('hook',   'Markets today'),
        ('head',   '{headline}'),
        ('regime', 'Regime {regime_state}'),
        ('cta',    'algospherequant.com'),
    ]},
    'educational_video': {'theme': 'calm', 'lines': [
        ('hook',  '{hook}'),
        ('conc',  '{concept}'),
        ('take',  '{takeaway}'),
        ('cta',   'algospherequant.com'),
    ]},
    'feature_demo_video': {'theme': 'lift', 'lines': [
        ('hook', 'New in AlgoSphere'),
        ('feat', '{feature}'),
        ('sol',  '{solution}'),
        ('cta',  'algospherequant.com'),
    ]},
    'achievement_video': {'theme': 'lift', 'lines': [
        ('hook', 'Milestone'),
        ('ach',  '{achievement}'),
        ('det',  '{description}'),
        ('cta',  'algospherequant.com'),
    ]},
    'investor_update_video': {'theme': 'institutional', 'lines': [
        ('hook', 'Investor update'),
        ('ret',  '{growth_pct}% return'),
        ('risk', 'Drawdown {max_drawdown}%'),
        ('cta',  'algospherequant.com'),
    ]},
}

# Theme → (accent colour, synth root Hz, tremolo Hz, lowpass Hz).
_THEME_AUDIO = {
    'tense':         (B.ROSE,    164.81, 5.0, 1200),  # E3, restless
    'reflective':    (B.SKY,     146.83, 2.5, 800),   # D3, slow
    'institutional': (B.AMBER,   130.81, 2.0, 700),   # C3, grounded
    'calm':          (B.EMERALD, 174.61, 1.8, 650),   # F3, soft
    'lift':          (B.AMBER,   196.00, 3.5, 1500),  # G3, bright
}

_MIN_SCENE_S = 2.2
_MAX_SCENE_S = 4.0
_WPS         = 2.6


def _fmt(template: str, payload: dict) -> str:
    import re
    def sub(m):
        v = payload.get(m.group(1))
        return '—' if v is None or v == '' else str(v)
    return re.sub(r'\{(\w+)\}', sub, template)


def _scene_dur(text: str) -> float:
    words = max(1, len(text.replace('\n', ' ').split()))
    return min(_MAX_SCENE_S, max(_MIN_SCENE_S, round(words / _WPS + 0.8, 2)))


def _build_scenes(asset_kind: str, payload: dict) -> tuple[list[dict], str]:
    spec = _SCENE_SCRIPTS.get(asset_kind, _SCENE_SCRIPTS['signal_reel'])
    scenes = []
    for sid, tmpl in spec['lines']:
        text = _fmt(tmpl, payload)
        scenes.append({'id': sid, 'text': text, 'dur': _scene_dur(text)})
    return scenes, spec.get('theme', 'institutional')


def _wrap(draw: ImageDraw.ImageDraw, text: str, fnt, max_w: int) -> list[str]:
    out: list[str] = []
    for para in text.split('\n'):
        words, line = para.split(), ''
        for w in words:
            t = (line + ' ' + w).strip()
            if draw.textlength(t, font=fnt) <= max_w:
                line = t
            else:
                if line:
                    out.append(line)
                line = w
        out.append(line)
    return out or ['']


def _render_frame(scene: dict, title: str, theme: str, idx: int, total: int,
                  out: Path) -> Path:
    accent = _THEME_AUDIO.get(theme, _THEME_AUDIO['institutional'])[0]
    im = Image.new('RGBA', (WIDTH, HEIGHT), (*B.BG, 255))
    # vertical gradient wash for depth
    grad = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(HEIGHT):
        a = int(60 * (y / HEIGHT))
        gd.line([(0, y), (WIDTH, y)], fill=(*accent, a // 6))
    im.alpha_composite(grad)
    B.draw_radial_glow(im, color=accent, center_xy=(WIDTH, 0), max_radius=900)
    B.draw_radial_glow(im, color=accent, center_xy=(0, HEIGHT), max_radius=700)
    d = ImageDraw.Draw(im)
    B.draw_brand_mark(d, 70, 80)

    # progress pips
    for i in range(total):
        x = 70 + i * 34
        on = i <= idx
        d.ellipse([x, 170, x + 18, 188], fill=accent if on else B.DARK_BORDER)

    # title (small caps top)
    d.text((WIDTH // 2, 320), title.upper()[:42], fill=B.MUTED, font=B.font(38), anchor='mm')

    # main caption — wrapped, centered
    is_cta = scene['id'] == 'cta'
    size = 96 if scene['id'] in ('hook', 'pair', 'ach', 'feat') else 78
    if is_cta:
        size = 64
    fnt = B.font(size)
    lines = _wrap(d, scene['text'], fnt, WIDTH - 160)
    line_h = int(size * 1.25)
    total_h = line_h * len(lines)
    y0 = HEIGHT // 2 - total_h // 2
    for i, ln in enumerate(lines):
        col = accent if is_cta else B.WHITE
        d.text((WIDTH // 2, y0 + i * line_h), ln, fill=col, font=fnt, anchor='mm')

    # accent rule under caption
    d.rectangle([WIDTH // 2 - 80, y0 + total_h + 40, WIDTH // 2 + 80,
                 y0 + total_h + 46], fill=accent)

    B.draw_footer_url(d, WIDTH, HEIGHT)
    im.convert('RGB').save(out, 'PNG')
    return out


def _have(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def _scene_clip(frame: Path, dur: float, out: Path) -> None:
    """One Ken-Burns clip from a still frame."""
    frames = max(1, int(dur * FPS))
    zexpr = "min(zoom+0.0012,1.10)"
    vf = (f"scale={WIDTH}:{HEIGHT},zoompan=z='{zexpr}':d={frames}:"
          f"s={WIDTH}x{HEIGHT}:fps={FPS},format=yuv420p")
    cmd = ['ffmpeg', '-y', '-loop', '1', '-i', str(frame), '-t', f'{dur:.2f}',
           '-vf', vf, '-r', str(FPS), '-an', str(out)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f'scene clip failed: {(r.stderr or "")[-200:]}')


def _concat(clips: List[Path], out: Path, work: Path) -> None:
    lst = work / 'concat.txt'
    lst.write_text(''.join(f"file '{c.as_posix()}'\n" for c in clips), encoding='utf-8')
    cmd = ['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst),
           '-c', 'copy', str(out)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        # re-encode fallback (clips already uniform, but be safe)
        cmd = ['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst),
               '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(out)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
        if r.returncode != 0:
            raise RuntimeError(f'concat failed: {(r.stderr or "")[-200:]}')


def _resolve_track(theme: str) -> Path | None:
    md = _music_dir()
    if not md:
        return None
    override = os.environ.get('ALGOSPHERE_AUDIO_THEME', '').strip()
    for name in [override, theme, 'default']:
        if name:
            p = md / f'{name}.mp3'
            if p.is_file():
                return p
    tracks = sorted(md.glob('*.mp3'))
    return tracks[0] if tracks else None


# Per-theme musical bed: a 4-chord progression (semitone offsets from the
# theme root) + seconds-per-chord. This gives real chord MOVEMENT + a per-chord
# swell (rhythm) instead of a flat drone.
_THEME_PROG = {
    'tense':         ([0, -2, -5, -7], 1.8),   # descending, restless
    'reflective':    ([0, 3, -2, -4], 2.6),    # wistful
    'institutional': ([0, 5, -3, 2], 2.4),     # grounded movement
    'calm':          ([0, 4, -1, -3], 2.8),    # soft major
    'lift':          ([0, 4, 7, 5], 2.0),      # rising, hopeful
}


def _synth_bed(theme: str, dur: float, out: Path) -> Path | None:
    """Synthesize a royalty-free MUSICAL bed (not a drone): a looping 4-chord
    progression, each chord a triad+octave with a swell envelope for rhythm,
    then low-pass + reverb + fades. Never copyrighted; never muted on IG.
    Returns None on any failure (caller promotes a silent render)."""
    _, root, _trem, lp = _THEME_AUDIO.get(theme, _THEME_AUDIO['institutional'])
    prog, beat = _THEME_PROG.get(theme, ([0, 5, -3, 2], 2.4))
    work = out.parent
    try:
        segs: list[Path] = []
        for i, semi in enumerate(prog):
            r = root * (2 ** (semi / 12.0))
            voices = [r / 2, r, r * (2 ** (4 / 12)), r * (2 ** (7 / 12)), r * 2]  # bass+triad+oct
            inputs: list[str] = []
            for v in voices:
                inputs += ['-f', 'lavfi', '-i', f'sine=frequency={v:.2f}:duration={beat:.2f}']
            fc = (f'[0][1][2][3][4]amix=inputs=5:normalize=1,'
                  f'afade=t=in:st=0:d=0.12,'
                  f'afade=t=out:st={max(0.1, beat - 0.3):.2f}:d=0.3,volume=1.5[a]')
            seg = work / f'_chord_{i}.wav'
            r2 = subprocess.run(['ffmpeg', '-y', *inputs, '-filter_complex', fc,
                                 '-map', '[a]', '-c:a', 'pcm_s16le', str(seg)],
                                capture_output=True, text=True, timeout=60)
            if r2.returncode != 0 or not seg.exists():
                return None
            segs.append(seg)

        lst = work / '_prog.txt'
        lst.write_text(''.join(f"file '{s.as_posix()}'\n" for s in segs), encoding='utf-8')
        prog_wav = work / '_prog.wav'
        rc = subprocess.run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst),
                             '-c', 'copy', str(prog_wav)], capture_output=True, text=True, timeout=60)
        if rc.returncode != 0 or not prog_wav.exists():
            return None

        fade_out = max(0.1, dur - 1.2)
        rm = subprocess.run(
            ['ffmpeg', '-y', '-stream_loop', '-1', '-i', str(prog_wav), '-t', f'{dur:.2f}',
             '-filter_complex',
             (f'lowpass=f={lp},aecho=0.8:0.85:240:0.3,'
              f'afade=t=in:st=0:d=1.0,afade=t=out:st={fade_out:.2f}:d=1.2,volume=1.1[a]'),
             '-map', '[a]', '-c:a', 'aac', '-b:a', '128k', str(out)],
            capture_output=True, text=True, timeout=120)
        return out if rm.returncode == 0 and out.exists() and out.stat().st_size > 0 else None
    except Exception:
        return None


def _mux(silent: Path, audio: Path, out: Path, dur: float, loop: bool) -> None:
    fade = max(0.0, dur - 0.6)
    inp = (['-stream_loop', '-1', '-i', str(audio)] if loop else ['-i', str(audio)])
    cmd = ['ffmpeg', '-y', '-i', str(silent), *inp,
           '-filter_complex',
           f'[1:a]volume=-22dB,afade=t=out:st={fade:.2f}:d=0.6[aud]',
           '-map', '0:v:0', '-map', '[aud]',
           '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
           '-shortest', '-movflags', '+faststart', str(out)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        raise RuntimeError(f'mux failed: {(r.stderr or "")[-200:]}')


def _thumbnail(mp4: Path, jpg: Path, at: float) -> None:
    cmd = ['ffmpeg', '-y', '-ss', f'{at:.2f}', '-i', str(mp4),
           '-vframes', '1', '-q:v', '3', str(jpg)]
    subprocess.run(cmd, capture_output=True, text=True, timeout=60)


def produce(item: dict, out_dir: Path, asset_kind: str = 'signal_reel') -> Dict[str, Path]:
    if not _have('ffmpeg'):
        raise RuntimeError('ffmpeg not available — install in the worker image')

    prov = item.get('provenance') or {}
    payload = prov.get('payload') or prov
    title = item.get('title') or asset_kind.replace('_', ' ').title()

    # Founder-media reels carry their own LLM-authored scene list (text +
    # seconds). Everything else uses the per-kind built-in scripts.
    reel_scenes = payload.get('reel_scenes')
    if reel_scenes:
        scenes = [{'id': f's{i}', 'text': str(s.get('text', ''))[:90],
                   'dur': max(1.5, min(4.5, float(s.get('seconds', 3) or 3)))}
                  for i, s in enumerate(reel_scenes) if s.get('text')]
        theme = payload.get('theme') or 'reflective'
        if not scenes:
            scenes, theme = _build_scenes(asset_kind, payload)
    else:
        scenes, theme = _build_scenes(asset_kind, payload)
    total_s = sum(s['dur'] for s in scenes)
    final_mp4 = out_dir / f'{asset_kind}.mp4'
    silent    = out_dir / f'{asset_kind}_silent.mp4'
    thumb     = out_dir / f'{asset_kind}_thumbnail.jpg'

    with tempfile.TemporaryDirectory(prefix='vid-') as tmp:
        work = Path(tmp)
        clips: list[Path] = []
        for i, sc in enumerate(scenes):
            frame = _render_frame(sc, title, theme, i, len(scenes), work / f'f{i}.png')
            clip = work / f'c{i}.mp4'
            _scene_clip(frame, sc['dur'], clip)
            clips.append(clip)
        _concat(clips, silent, work)

        # Music: real track (loop) > synth bed (exact length) > silent.
        track = _resolve_track(theme)
        try:
            if track is not None:
                _mux(silent, track, final_mp4, total_s, loop=True)
                logger.info(f"video {asset_kind} + music={track.name} "
                            f"({final_mp4.stat().st_size}b)")
            else:
                bed = _synth_bed(theme, total_s, work / 'bed.m4a')
                if bed is not None:
                    _mux(silent, bed, final_mp4, total_s, loop=False)
                    logger.info(f"video {asset_kind} + synth bed ({theme}) "
                                f"({final_mp4.stat().st_size}b)")
                else:
                    shutil.copy(silent, final_mp4)
                    logger.warning(f"video {asset_kind} silent — synth bed failed")
        except Exception as e:
            # Music must never sink the job — promote the silent render.
            shutil.copy(silent, final_mp4)
            logger.warning(f"video {asset_kind} music step failed ({e}); silent")

        _thumbnail(final_mp4, thumb, at=min(1.5, total_s / 4))

    return {asset_kind: final_mp4, f'{asset_kind}_thumbnail': thumb}
