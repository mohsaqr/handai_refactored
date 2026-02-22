// Prevents console window on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Handai — Tauri main process
//!
//! Strategy (Phase A — sidecar): spawn the Next.js standalone server as a
//! child process via tauri-plugin-shell, wait ~3 s for it to boot, then load
//! the WebView at http://127.0.0.1:3947.
//!
//! Phase B (future): migrate API routes to Tauri commands + tauri-plugin-sql
//! so no sidecar is needed.  See ARCHITECTURE.md for the migration plan.

use std::{sync::Mutex, thread, time::Duration};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

const PORT: u16 = 3947;

struct ServerState(Mutex<Option<CommandChild>>);

/// Polls http://127.0.0.1:{PORT} until a response arrives or we time out.
fn wait_for_server(max_secs: u64) -> bool {
    let deadline = std::time::Instant::now() + Duration::from_secs(max_secs);
    loop {
        if std::time::Instant::now() > deadline {
            return false;
        }
        if ureq::get(&format!("http://127.0.0.1:{PORT}"))
            .call()
            .is_ok()
        {
            return true;
        }
        thread::sleep(Duration::from_millis(300));
    }
}

#[tauri::command]
fn get_server_url() -> String {
    format!("http://127.0.0.1:{PORT}")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerState(Mutex::new(None)))
        .setup(|app| {
            let handle: AppHandle = app.handle().clone();
            let state: State<ServerState> = handle.state();

            // Spawn the Next.js standalone server as a sidecar.
            // The sidecar binary is configured in tauri.conf.json under
            // bundle.externalBin. For development, it falls back to `node`.
            let (_, child) = app
                .shell()
                .sidecar("node")
                .expect("node sidecar not configured — see desktop/tauri/README.md")
                .args(["server.js"])
                .env("PORT", PORT.to_string())
                .env("HOSTNAME", "127.0.0.1")
                .env("NODE_ENV", "production")
                .spawn()
                .expect("Failed to spawn Next.js server");

            *state.0.lock().unwrap() = Some(child);

            // Wait in a background thread; open WebView once server is up
            let handle2 = handle.clone();
            thread::spawn(move || {
                if wait_for_server(20) {
                    let url = format!("http://127.0.0.1:{PORT}");
                    if let Some(window) = handle2.get_webview_window("main") {
                        let _ = window.eval(&format!(
                            "window.location.href = '{url}'"
                        ));
                    }
                } else {
                    eprintln!("[handai] Next.js server failed to start within 20s");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Kill the sidecar when the window closes
                let state: State<ServerState> = window.state();
                if let Some(child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_server_url])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
