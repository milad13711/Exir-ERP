import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

function apiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api").origin;
  } catch {
    return "";
  }
}

// پنل ادمین فقط داخلی است و هرگز نباید در iframe قرار گیرد. CSP در حالت Report-Only (اسکریپت‌های inline خودِ Next) —
// گزارش‌ها به /api/security/csp-report؛ پس از بی‌تخلف‌بودن چند هفته به Content-Security-Policy ارتقا دهید.
function csp(): string {
  const api = apiOrigin();
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${api} ${api.replace(/^http/, "ws")}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(api ? [`report-uri ${api}/api/security/csp-report`] : []),
  ].join("; ");
}

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Content-Security-Policy-Report-Only", value: csp() },
        ],
      },
    ];
  },
};

export default nextConfig;
