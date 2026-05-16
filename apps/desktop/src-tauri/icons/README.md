# Icons

Tauri expects the following icons in this directory. Run
`cargo tauri icon path/to/source.png` (a 1024×1024 PNG) to generate
all platform variants automatically:

```
icons/
├── 32x32.png
├── 128x128.png
├── 128x128@2x.png      ← 256x256
├── icon.icns           ← macOS
├── icon.ico            ← Windows
└── icon.png            ← tray icon (Linux + general fallback)
```

Until you run that command, `cargo tauri build` will fail with a
missing-icon error. Use the AlgoSphere mark — the gold spiral on dark
gradient — as the source PNG.
