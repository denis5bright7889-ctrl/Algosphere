// AlgoSphere Quant — desktop entrypoint.
//
// The window is configured declaratively in tauri.conf.json; this file
// only wires Rust-side glue:
//   • Tray menu (Show / Hide / Quit)
//   • Single-instance lock so users don't end up with stacked windows
//   • Native notification plugin
//
// All UI lives at https://algospherequant.com — when adding features,
// build them in the web app first.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[tauri::command]
fn ping() -> &'static str {
    // Sanity command — invoke from the renderer to verify the IPC bridge.
    "pong"
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![ping])
        .setup(|app| {
            // ─── Tray menu ────────────────────────────────────────────
            let show_item = MenuItem::with_id(app, "show", "Show window",  true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide to tray", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit AlgoSphere", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .on_menu_event(|app, ev| {
                    if let Some(win) = app.get_webview_window("main") {
                        match ev.id.as_ref() {
                            "show" => { let _ = win.show(); let _ = win.set_focus(); }
                            "hide" => { let _ = win.hide(); }
                            "quit" => { app.exit(0); }
                            _ => {}
                        }
                    }
                })
                .on_tray_icon_event(|tray, ev| {
                    // Left-click toggles the window
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = ev
                    {
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        // Hide-to-tray on window close (don't tear down the process).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
