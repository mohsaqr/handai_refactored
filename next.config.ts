import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 'standalone' bundles the server + minimal node_modules into .next/standalone/
  // so Electron and Tauri wrappers can ship `node server.js` without the full
  // node_modules tree. Does not affect `next dev` or web deployment.
  output: "standalone",
  devIndicators: false,
};

export default nextConfig;
