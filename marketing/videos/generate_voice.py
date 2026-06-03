"""
Generate per-line MP3 voiceover files using edge-tts. Also produces a
timings.json so the Remotion composition knows when each line starts
and how long it lasts — frame-accurate sync.

Run:  python generate_voice.py src/scripts/v2_script.json
Out:  public/v2/line_*.mp3  +  public/v2/timings.json
"""
import asyncio
import json
import os
import sys
import wave
from pathlib import Path

import edge_tts


GAP_S = 0.35   # silence between lines (Remotion respects this in the timeline)


async def synth_line(voice: str, rate: str, text: str, out_mp3: Path) -> float:
    """Generate one line's MP3 and return its duration in seconds."""
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)
    await communicate.save(str(out_mp3))
    # Probe duration via mutagen if available, else fall back to ffprobe-less estimate.
    try:
        from mutagen.mp3 import MP3
        return MP3(str(out_mp3)).info.length
    except Exception:
        # Rough estimate: ~150 wpm at +5% → ~2.6 words/sec; +0.3s tail
        return len(text.split()) / 2.6 + 0.3


async def main(script_path: Path):
    spec = json.loads(script_path.read_text(encoding='utf-8'))
    vid_id = spec['id']
    voice  = spec['voice']
    rate   = spec.get('rate', '+0%')

    out_dir = Path(__file__).parent / 'public' / vid_id
    out_dir.mkdir(parents=True, exist_ok=True)

    timeline = []
    cursor = 0.0
    for i, line in enumerate(spec['lines']):
        mp3 = out_dir / f"line_{i:02d}_{line['id']}.mp3"
        dur = await synth_line(voice, rate, line['text'], mp3)
        timeline.append({
            'id':       line['id'],
            'text':     line['text'],
            'mp3':      f"{vid_id}/{mp3.name}",
            'start_s':  round(cursor, 3),
            'dur_s':    round(dur, 3),
        })
        cursor += dur + GAP_S
        print(f"  [{i:02d}] {line['id']:6s}  {dur:5.2f}s  -> {mp3.name}")

    total = cursor - GAP_S
    timings = {
        'id':       vid_id,
        'title':    spec['title'],
        'voice':    voice,
        'total_s':  round(total, 3),
        'gap_s':    GAP_S,
        'fps':      30,
        'width':    1080,
        'height':   1920,
        'lines':    timeline,
    }
    (out_dir / 'timings.json').write_text(json.dumps(timings, indent=2))
    print(f"\nTotal: {total:.2f}s · {len(timeline)} lines · {out_dir / 'timings.json'}")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("usage: python generate_voice.py <script.json>")
        sys.exit(1)
    asyncio.run(main(Path(sys.argv[1])))
