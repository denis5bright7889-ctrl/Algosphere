"""
Auto-generate SRT caption files from each video's timings.json.
SRT is the universal subtitle format — drop into CapCut, Premiere,
Instagram (caption.txt), TikTok, YouTube.

Run:  python generate_captions.py
Out:  public/<id>/captions.srt for every video.
"""
import json
from pathlib import Path


def fmt_ts(s: float) -> str:
    h  = int(s // 3600)
    m  = int((s % 3600) // 60)
    sec = s - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{int(sec):02d},{int(round((sec - int(sec)) * 1000)):03d}"


def main():
    public = Path(__file__).parent / 'public'
    for timings_path in public.glob('*/timings.json'):
        spec = json.loads(timings_path.read_text(encoding='utf-8'))
        srt_lines: list[str] = []
        for i, line in enumerate(spec['lines'], start=1):
            start = line['start_s']
            end   = start + line['dur_s'] + 0.1
            srt_lines.append(str(i))
            srt_lines.append(f"{fmt_ts(start)} --> {fmt_ts(end)}")
            srt_lines.append(line['text'])
            srt_lines.append('')
        out = timings_path.parent / 'captions.srt'
        out.write_text('\n'.join(srt_lines), encoding='utf-8')
        print(f"  {spec['id']}: {len(spec['lines'])} cues -> {out}")


if __name__ == '__main__':
    main()
