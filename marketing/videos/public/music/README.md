# Background music — drop-in directory

The asset-worker's video producer looks for MP3 tracks here at render
time. Drop royalty-free `.mp3` files into this folder, commit them,
and the next deploy will use them automatically. No code change needed.

## Recommended filenames (per-kind theme)

| Filename            | Used by asset_kinds                                 |
| ------------------- | --------------------------------------------------- |
| `tense.mp3`         | `signal_reel`, `daily_market_video`                 |
| `reflective.mp3`    | `trade_recap_video`                                 |
| `institutional.mp3` | `weekly_recap_video`, `monthly_recap_video`,        |
|                     | `educational_video`, `investor_update_video`        |
| `lift.mp3`          | `feature_demo_video`, `achievement_video`           |
| `default.mp3`       | Fallback when no theme-specific track is present    |

## Resolution order (see `apps/asset-worker/producers/video.py`)

1. `ALGOSPHERE_AUDIO_THEME` env var → `<theme>.mp3`  (force-pin override)
2. `<theme>.mp3` for the current asset_kind
3. `default.mp3`
4. First alphabetical `*.mp3` in this folder
5. None present → video renders silent (no failure)

## Sourcing tracks

Recommended free-license libraries:

- https://pixabay.com/music/  (CC0 / Pixabay license)
- https://www.fesliyanstudios.com/royalty-free-music
- https://incompetech.com/  (Kevin MacLeod — CC-BY 4.0; credit in caption / description)

Pick instrumentals around 80–110 BPM, no vocals, 30–90s long. The
producer loops the track if the video is longer, normalises gain to
-25dB so captions stay readable, and fades out the last 0.5s to avoid
an audio cliff.

## Audio gain / mix

Music is mixed at **-25 dB** below the silent video render so it stays
supportive of the captions + motion graphics. Override via ffmpeg
filter in `_ffmpeg_mux_music` if a track is too loud after testing.
