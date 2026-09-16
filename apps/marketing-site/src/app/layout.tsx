import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { GROUP_BRAND, EXIR_PRODUCTS, EXIR_INFRASTRUCTURE } from "@/lib/content";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://eta.co.ir").replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${GROUP_BRAND.name} — نرم‌افزارهای تخصصی برای هر صنف`,
    template: `%s | ${GROUP_BRAND.name}`,
  },
  description: `${GROUP_BRAND.claim}. ${GROUP_BRAND.subClaim}`,
  keywords: [
    "نرم‌افزار ERP فارسی",
    "بهترین ERP ایرانی",
    "نرم‌افزار مدیریت کسب‌وکار فارسی",
    "نرم‌افزار مدیریت املاک",
    "نرم‌افزار مدیریت باشگاه مشتریان سالن زیبایی",
    "ERP با هوش مصنوعی",
  ],
  openGraph: {
    title: `${GROUP_BRAND.name} — ${GROUP_BRAND.claim}`,
    description: GROUP_BRAND.subClaim,
    locale: "fa_IR",
    type: "website",
    images: ["/logo-full.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

/** سازمان مادر + هر محصول زنده (بدون محصولات «به‌زودی» تا نه لینک مرده در ایندکس گوگل ثبت شود، نه سازمانی که هنوز موجود نیست). */
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: GROUP_BRAND.name,
  description: `${GROUP_BRAND.claim}. ${GROUP_BRAND.subClaim}`,
  logo: `${SITE_URL}/logo-icon.png`,
  inLanguage: "fa-IR",
  brand: [...EXIR_PRODUCTS.filter((p) => p.status === "live"), EXIR_INFRASTRUCTURE].map((p) => ({
    "@type": "SoftwareApplication",
    name: p.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: p.description,
    url: `https://${p.domain}`,
  })),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-ink">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
