import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean, self-contained production build for the Docker image (see
  // apps/web-panel/Dockerfile) — bundles only the node_modules this app
  // actually needs instead of shipping the whole workspace.
  output: "standalone",
  // اسکریپت جاسازی فرم‌ساز — نسخه‌دار (v1 پایدار می‌ماند) و قابل‌کش
  async rewrites() {
    return [{ source: "/embed/v1/exir-forms.js", destination: "/embed/exir-forms.js" }];
  },
  async headers() {
    return [{ source: "/embed/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=3600" }] }];
  },
};

export default nextConfig;
