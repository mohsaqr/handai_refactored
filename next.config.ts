import type { NextConfig } from "next";

const isStaticExport = process.env.TAURI_BUILD === "1" || process.env.STATIC_BUILD === "1";

const nextConfig: NextConfig = {
  // 'standalone' for web deployment / Docker (bundles server + minimal node_modules).
  // 'export' for Tauri desktop or static web (GitHub Pages) — no API routes.
  // Toggle via: TAURI_BUILD=1 npm run build:tauri  OR  STATIC_BUILD=1 npm run build:static
  output: isStaticExport ? "export" : "standalone",
  // GitHub Pages serves from a subpath (/repo-name/). Tauri serves from root.
  ...(process.env.STATIC_BUILD === "1" && process.env.PAGES_BASE_PATH
    ? { basePath: process.env.PAGES_BASE_PATH, assetPrefix: process.env.PAGES_BASE_PATH }
    : {}),
  devIndicators: false,
  // Tauri dev mode loads the Next.js dev server from 127.0.0.1 (not localhost),
  // triggering a cross-origin warning. Explicitly allow it to silence the noise.
  allowedDevOrigins: ["127.0.0.1"],
  // pdf-parse v2 and pdfjs-dist v4 are ESM-only packages. They CANNOT be listed
  // in serverExternalPackages because that path uses require(), which fails on ESM.
  // Let Turbopack bundle them normally. The server-side code already disables the
  // pdfjs worker (workerSrc = "") so no worker resolution is needed at runtime.
};

export default nextConfig;
