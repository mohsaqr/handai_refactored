// Prevents console window on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Handai — Tauri main process (Phase B)
//!
//! Phase B: no Node.js sidecar. The web app is a static export (`output: "export"`
//! from Next.js). All LLM calls go directly from the browser (WebView) to provider
//! APIs. SQLite is managed by tauri-plugin-sql. Window loads `tauri://localhost`
//! which serves the static files from the `frontendDist` directory.
//!
//! See web/desktop/README.md and web/ARCHITECTURE.md for full details.

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

// ── Database migrations ────────────────────────────────────────────────────────
// Replicates the Prisma schema used in the web app's SQLite DB.
// The frontend uses @tauri-apps/plugin-sql to read/write this schema.

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  mode        TEXT    NOT NULL,
  settingsJson TEXT   NOT NULL DEFAULT '{}',
  createdAt   TEXT    NOT NULL DEFAULT (datetime('now')),
  updatedAt   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id               TEXT    PRIMARY KEY,
  sessionId        TEXT    NOT NULL,
  runType          TEXT    NOT NULL DEFAULT 'full',
  provider         TEXT    NOT NULL DEFAULT 'openai',
  model            TEXT    NOT NULL DEFAULT 'unknown',
  temperature      REAL    NOT NULL DEFAULT 0.7,
  maxTokens        INTEGER NOT NULL DEFAULT 2048,
  systemPrompt     TEXT    NOT NULL DEFAULT '',
  schemaJson       TEXT    NOT NULL DEFAULT '{}',
  variablesJson    TEXT    NOT NULL DEFAULT '{}',
  inputFile        TEXT    NOT NULL DEFAULT 'unnamed',
  inputRows        INTEGER NOT NULL DEFAULT 0,
  status           TEXT    NOT NULL DEFAULT 'processing',
  successCount     INTEGER NOT NULL DEFAULT 0,
  errorCount       INTEGER NOT NULL DEFAULT 0,
  retryCount       INTEGER NOT NULL DEFAULT 0,
  avgLatency       REAL    NOT NULL DEFAULT 0.0,
  totalDuration    REAL    NOT NULL DEFAULT 0.0,
  jsonMode         INTEGER NOT NULL DEFAULT 0,
  maxConcurrency   INTEGER NOT NULL DEFAULT 5,
  autoRetry        INTEGER NOT NULL DEFAULT 1,
  maxRetryAttempts INTEGER NOT NULL DEFAULT 3,
  runSettingsJson  TEXT    NOT NULL DEFAULT '{}',
  startedAt        TEXT    NOT NULL DEFAULT (datetime('now')),
  completedAt      TEXT,
  FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_results (
  id           TEXT    PRIMARY KEY,
  runId        TEXT    NOT NULL,
  rowIndex     INTEGER NOT NULL,
  inputJson    TEXT    NOT NULL,
  output       TEXT    NOT NULL,
  status       TEXT    NOT NULL,
  errorType    TEXT,
  errorMessage TEXT,
  latency      REAL    NOT NULL DEFAULT 0.0,
  retryAttempt INTEGER NOT NULL DEFAULT 0,
  createdAt    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
);
"#;

// ── Commands ───────────────────────────────────────────────────────────────────

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

// ── Main ───────────────────────────────────────────────────────────────────────

fn main() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_handai_schema",
        sql: MIGRATION_V1,
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:handai.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_cors_fetch::init())
        .setup(|app| {
            // Resolve app data dir so tauri-plugin-sql writes the DB to a
            // writable location instead of the app bundle directory.
            // macOS: ~/Library/Application Support/me.saqr.handai/handai.db
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data dir unavailable");
            std::fs::create_dir_all(&data_dir).ok();

            // Override the default DB path so the plugin uses the app data dir.
            // tauri-plugin-sql resolves "sqlite:handai.db" relative to app_data_dir()
            // automatically on Tauri v2 — no extra env var needed.

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_file])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
