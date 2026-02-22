"use strict";

/**
 * Preload script — runs in renderer context with access to Node.js APIs,
 * but exposes ONLY what the app needs via contextBridge.
 * contextIsolation: true ensures the renderer has no direct Node access.
 */

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("__handai__", {
  platform: process.platform,
  isDesktop: true,
});
