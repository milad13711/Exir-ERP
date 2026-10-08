import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** مبدأ API برای connect-src / report-uri (NEXT_PUBLIC_API_URL مثل http://host:3001/api). */
function apiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api").origin;
  } catch {
    return "";
  }
}

/**
 * CSP فقط در حالت Report-Only: Next.js اسکریپت‌های inline تزریق می‌کند (hydration) و فرانت‌اند منابع متنوعی می‌گیرد، پس سیاست
 * سخت‌گیر enforce می‌تواند پنل را بشکند. این سیاست در Report-Only فعال است و تخلف‌ها به /api/security/csp-report گزارش می‌شود؛
 * پس از چند هفته بدون تخلف، همین مقدار را به هدر Content-Security-Policy ارتقا دهید.
 */
function csp(opts: { framable: boolean }): string {
  const api = apiOrigin();
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' data: blob: https:",
    `connect-src 'self' ${api} ${api.replace(/^http/, "ws")} https:`,
    "frame-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https:",
    ...(opts.framable ? [] : ["frame-ancestors 'none'"]),
    ...(api ? [`report-uri ${api}/api/security/csp-report`] : []),
  ].join("; ");
}

const baseSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // دوربین: اسکن QR ورود رویداد؛ میکروفون: سافت‌فون VoIP؛ مکان: ناوگان. بقیه خاموش.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), bluetooth=()" },
  { key: "Strict-Transport-Security", value: "max-age=15552000" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Lean, self-contained production build for the Docker image (see
  // apps/web-panel/Dockerfile) — bundles only the node_modules this app
  // actually needs instead of shipping the whole workspace.
  output: "standalone",
  poweredByHeader: false,
  // اسکریپت جاسازی فرم‌ساز — نسخه‌دار (v1 پایدار می‌ماند) و قابل‌کش
  async rewrites() {
    return [{ source: "/embed/v1/exir-forms.js", destination: "/embed/exir-forms.js" }];
  },
  async headers() {
    return [
      // همه‌ی مسیرها جز فرم‌ساز قابل‌جاسازی (/f/* و /embed/*): ممنوعیت قرارگیری در iframe (clickjacking)
      {
        source: "/((?!f/|embed/).*)",
        headers: [
          ...baseSecurityHeaders,
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy-Report-Only", value: csp({ framable: false }) },
        ],
      },
      // صفحه‌ی عمومی فرم و اسکریپت جاسازی عمداً در سایت‌های دیگر iframe می‌شوند → بدون X-Frame-Options / frame-ancestors
      {
        source: "/f/:path*",
        headers: [...baseSecurityHeaders, { key: "Content-Security-Policy-Report-Only", value: csp({ framable: true }) }],
      },
      {
        source: "/embed/:path*",
        headers: [...baseSecurityHeaders, { key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
