# AlgoSphere Marketing Videos

Programmatic short-form video pipeline. Voice + animated text + AlgoSphere brand
styling → 1080×1920 MP4 files ready for Instagram Reels, YouTube Shorts, TikTok.

## What's in here

```
marketing/videos/
├── generate_voice.py      Python — edge-tts → per-line MP3 + timings.json
├── src/
│   ├── index.ts           Remotion entry
│   ├── Root.tsx           Composition registry
│   ├── Video.tsx          Master video shell (backdrop + header + footer + per-line sequence)
│   ├── scenes.tsx         Scene library — one component per (videoId, lineId)
│   └── scripts/           Source JSON per video — text + voice + timings
├── public/                Generated voiceover MP3s + timings.json per video
└── out/                   Rendered MP4s
```

## Output (5 videos ready to post)

| File | Length | Topic | Voice |
|---|---|---|---|
| `out/v2.mp4`  | ~44s | Why 90% of traders blow accounts | Christopher (authority) |
| `out/v49.mp4` | ~36s | Profit Factor explained | Aria (confident) |
| `out/v58.mp4` | ~42s | Risk-on vs Risk-off | Jenny (friendly) |
| `out/v69.mp4` | ~48s | Coverage / Reliability / Data Quality | Christopher |
| `out/v82.mp4` | ~54s | 15-gate institutional risk system | Guy (passion) |

All 1080×1920, 30fps, no screen recordings required. Ready for vertical shorts.

## Add a new video (5-step recipe)

1. **Write the script JSON** in `src/scripts/<id>_script.json` — pick a voice from
   `edge-tts --list-voices`, break the narration into short lines.
2. **Generate voiceover** — `python generate_voice.py src/scripts/<id>_script.json`
   → produces MP3s + `timings.json` in `public/<id>/`.
3. **Add scenes** in `src/scenes.tsx` — register `<id>:<lineId>` → React component
   in the `SCENES` lookup table. Reuse `Headline`, `PillRow`, `BigStat`, `CtaCard`.
4. **Register the composition** in `src/Root.tsx` — import the new timings.json,
   add it to the `SHOWS` array.
5. **Render** — `npx remotion render <id> out/<id>.mp4`.

## Render commands

```bash
# Install once
npm install

# Render any video by id
npx remotion render v2  out/v2.mp4
npx remotion render v49 out/v49.mp4

# Render all
for id in v2 v49 v58 v69 v82; do npx remotion render $id out/$id.mp4; done

# Preview / iterate visually (opens browser)
npx remotion studio
```

## Design notes

- **Inline styles are required.** Remotion interpolates per-frame via
  `useCurrentFrame`. External CSS files can't be animated this way. The
  inline-style lint warnings are noise — ignore them.
- **Brand palette**: amber `#fcd34d` / amber-deep `#f59e0b` / emerald `#34d399`
  / rose `#f43f5e` / sky `#60a5fa` / near-black `#06070A`.
- **Voice TTS**: edge-tts uses Microsoft's free TTS endpoint. No API key, no
  auth, no quota visible. Voice quality is high — not human, but professional.
- **Scene grammar**: `BrandHeader` + content + `BrandFooter` are always on
  screen. Per-line scenes occupy the centre slot only. Stagger animations
  via `spring({frame, fps})` and `interpolate` for smooth entries.

## Limits this pipeline does NOT cover

- **Screen recordings of the live app.** You need to record those externally
  (OBS / Loom / phone) and composite. The pipeline can drop a `<Video>` clip
  in place of any scene — see Remotion docs for `<OffthreadVideo>`.
- **Human voiceover.** Replace `edge-tts` with ElevenLabs API calls if you
  want a paid human-grade voice. Drop the MP3 into `public/<id>/` and keep
  the same `timings.json` shape — nothing else changes.
- **B-roll lifestyle footage.** Source from Pexels/Pixabay and composite via
  Remotion's `<OffthreadVideo>` or `<Img>`.
