import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean, self-contained production build for the Docker image (see
  // apps/web-panel/Dockerfile) — bundles only the node_modules this app
  // actually needs instead of shipping the whole workspace.
  output: "standalone",
};

export default nextConfig;
