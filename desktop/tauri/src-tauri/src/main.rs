// Prevents console window on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Handai — Tauri main process
//!
//! Strategy (Phase A — sidecar): in production builds, spawn the Next.js
//! standalone server as a child process via tauri-plugin-shell, wait for it
//! to bind on port 3947, then navigate the WebView there.
//!
//! In dev mode (`tauri dev`) the sidecar is NOT spawned — Tauri loads the
//! Next.js dev server directly via the `devUrl` in tauri.conf.json.
//!
//! Phase B (future): migrate API routes to Tauri commands + tauri-plugin-sql
//! so no sidecar is needed. See ARCHITECTURE.md for the migration plan.

use std::{net::TcpStream, sync::Mutex, thread, time::Duration};
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_shell::process::CommandChild;

// Only needed in production builds (sidecar is not spawned in dev)
#[cfg(not(debug_assertions))]
use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

const PORT: u16 = 3947;

struct ServerState(Mutex<Option<CommandChild>>);

/// Polls 127.0.0.1:{port} with a TCP connect until the port accepts
/// connections or the deadline passes. Uses only std — no extra crate needed.
#[cfg_attr(debug_assertions, allow(dead_code))]
fn wait_for_server(port: u16, max_secs: u64) -> bool {
    let deadline = std::time::Instant::now() + Duration::from_secs(max_secs);
    let addr = format!("127.0.0.1:{port}");
    loop {
        if std::time::Instant::now() > deadline {
            return false;
        }
        if TcpStream::connect(&addr as &str).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(300));
    }
}

#[tauri::command]
fn get_server_url() -> String {
    format!("http://127.0.0.1:{PORT}")
}

/// Show a native save-file dialog and write CSV content to the chosen path.
/// WKWebView (macOS) does not support the HTML `download` attribute, so the
/// web layer detects Tauri and calls this command instead.
/// Returns `true` if saved, `false` if the user cancelled.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, filename: String, content: String) -> Result<bool, String> {
    let path = app
        .dialog()
        .file()
        .set_file_name(&filename)
        .add_filter("CSV Files", &["csv"])
        .blocking_save_file();

    match path {
        Some(FilePath::Path(p)) => {
            std::fs::write(&p, content.as_bytes()).map_err(|e| e.to_string())?;
            Ok(true)
        }
        Some(_) => Err("Unsupported path type".into()),
        None => Ok(false), // user cancelled
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(ServerState(Mutex::new(None)))
        .setup(|_app| {
            // In production builds only: spawn the Next.js standalone server
            // as a sidecar, wait for it, then navigate the WebView.
            // In dev mode, `devUrl` in tauri.conf.json handles loading.
            #[cfg(not(debug_assertions))]
            {
                let handle: AppHandle = _app.handle().clone();
                let state: State<ServerState> = handle.state();

                // Resolve app data dir for DB and pass as DATABASE_URL so
                // Prisma writes to a writable location in production bundles.
                // macOS: ~/Library/Application Support/me.saqr.handai/handai.db
                let data_dir = _app
                    .path()
                    .app_data_dir()
                    .expect("app data dir unavailable");
                std::fs::create_dir_all(&data_dir).ok();
                let db_url = format!("file:{}/handai.db", data_dir.display());

                let (_, child) = _app
                    .shell()
                    .sidecar("node")
                    .expect("node sidecar not configured — see desktop/README.md")
                    .args(["server.js"])
                    .env("PORT", PORT.to_string())
                    .env("HOSTNAME", "127.0.0.1")
                    .env("NODE_ENV", "production")
                    .env("DATABASE_URL", &db_url)
                    .spawn()
                    .expect("Failed to spawn Next.js server");

                *state.0.lock().unwrap() = Some(child);

                // Wait in a background thread; navigate WebView once server is up
                let handle2 = handle.clone();
                thread::spawn(move || {
                    if wait_for_server(PORT, 20) {
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
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Kill the sidecar when the window closes.
                let child = {
                    let state: State<ServerState> = window.state();
                    let x = state.0.lock().unwrap().take();
                    x
                };
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_server_url, save_file])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
