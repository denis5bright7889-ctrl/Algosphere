# AlgoSphere Quant — Desktop Terminal (Tauri 2)

A thin native shell around `https://algospherequant.com`. **All product
logic lives in the web app** — this binary just wraps the same UI in an
OS-native window so traders get:

- One launcher icon (no "open a browser tab" friction)
- System tray + always-on-top quick-bar
- Native OS push notifications (zero VAPID configuration)
- Offline alert queue (signals queued in IndexedDB are replayed when net comes back)
- Auto-update via Tauri's signed updater

If a feature needs more than that, build it in the web app — the desktop
binary should not diverge.

---

## Toolchain

- **Tauri 2** (Rust 1.78+, `cargo install tauri-cli@^2`)
- **Node 20** for the CLI scripts
- Platform SDKs:
  - macOS: Xcode CLT
  - Windows: WebView2 (ships with Win11) + MSVC build tools
  - Linux: `libwebkit2gtk-4.1-dev libssl-dev` + `librsvg2-dev`

```
rustup default stable
cargo install tauri-cli --version "^2.1"
cd apps/desktop
npm install
```

## Development

```
npm run dev
```

Loads `https://algospherequant.com` inside a Tauri window. Edits to the
web app appear after a reload (Cmd-R / Ctrl-R). For pre-deploy testing
against `localhost:3000`, edit `src-tauri/tauri.conf.json → build.devUrl`.

## Production build

```
npm run build
```

Produces signed installers in `src-tauri/target/release/bundle/`:

| Platform | Output |
|----------|--------|
| macOS    | `AlgoSphereQuant.dmg`, `.app` |
| Windows  | `AlgoSphereQuant_x64_en-US.msi`, `.exe` |
| Linux    | `algosphere-quant.deb`, `.AppImage` |

For Apple notarization + Microsoft code-signing, set the env vars
documented at https://tauri.app/v2/guides/distribution/sign-macos/ and
.../sign-windows/. Without them you get an unsigned binary that triggers
SmartScreen / Gatekeeper warnings — fine for internal testing, not for
public release.

## Auto-update

`src-tauri/tauri.conf.json → plugins.updater` points at:

```
https://algospherequant.com/api/desktop/update/{{target}}/{{current_version}}
```

This endpoint is **not yet implemented on the web side** — it should
return Tauri's standard JSON payload (`version`, `notes`, `pub_date`,
`platforms[]` with `signature` + `url`). Disable the updater plugin
(`active: false`) until that route exists or builds will warn.

---

## What's NOT in this wrapper

- No proprietary chart engine — uses TradingView widget from the web app
- No local broker SDK — order routing always goes through the signal-engine
- No local key storage — all secrets live in Supabase or the signal-engine vault

This keeps the security surface identical to the web app: the desktop
binary is a window, not a privileged client.
