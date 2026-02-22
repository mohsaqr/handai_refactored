"use strict";

/**
 * Handai — Electron main process
 *
 * Strategy: spawn the Next.js standalone server as a child process,
 * wait for it to accept connections, then open a BrowserWindow.
 * The entire Next.js API surface (Prisma, LLM calls, etc.) works unchanged.
 *
 * Build: next build (output: 'standalone') → electron-builder
 * Run dev: electron . (expects .next/standalone to exist)
 */

const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = 3947; // Avoid clashing with dev server on 3000
let serverProcess = null;
let mainWindow = null;

// ── Path resolution ──────────────────────────────────────────────────────────

function getNextRoot() {
  if (app.isPackaged) {
    // After electron-builder: extraResources lands in process.resourcesPath/nextjs
    return path.join(process.resourcesPath, "nextjs");
  }
  // Dev: use the web app's standalone build directly
  return path.resolve(__dirname, "..", "..", ".next", "standalone");
}

// ── Server management ────────────────────────────────────────────────────────

function startServer() {
  const nextRoot = getNextRoot();
  const serverScript = path.join(nextRoot, "server.js");

  serverProcess = spawn(process.execPath, [serverScript], {
    cwd: nextRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  serverProcess.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));

  serverProcess.on("exit", (code, signal) => {
    console.error(`[next] server exited: code=${code} signal=${signal}`);
    if (!app.isQuitting) app.quit();
  });
}

function waitForServer(maxMs = 15_000) {
  const deadline = Date.now() + maxMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() > deadline) {
        return reject(new Error(`Next.js server did not start within ${maxMs}ms`));
      }
      http
        .get(`http://127.0.0.1:${PORT}`, (res) => {
          res.resume(); // drain
          resolve();
        })
        .on("error", () => setTimeout(attempt, 300));
    };
    attempt();
  });
}

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Open external links in the system browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  app.isQuitting = false;
  startServer();

  try {
    await waitForServer();
    createWindow();
  } catch (err) {
    console.error(err.message);
    // Show a dialog in the packaged app so the user isn't left with a blank screen
    if (app.isPackaged) {
      const { dialog } = require("electron");
      dialog.showErrorBox("Startup failed", err.message);
    }
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverProcess) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
});
