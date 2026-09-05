import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { BRAND } from "@/lib/content";

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — نرم‌افزار یکپارچه مدیریت کسب‌وکار فارسی`,
    template: `%s | ${BRAND.name}`,
  },
  description: `${BRAND.claim}. ${BRAND.subClaim}`,
  keywords: [
    "نرم‌افزار ERP فارسی",
    "بهترین ERP ایرانی",
    "نرم‌افزار مدیریت کسب‌وکار فارسی",
    "ERP با هوش مصنوعی",
    "نرم‌افزار حسابداری و انبارداری یکپارچه",
  ],
  openGraph: {
    title: `${BRAND.name} — ${BRAND.claim}`,
    description: BRAND.subClaim,
    locale: "fa_IR",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#4338ca",
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: BRAND.name,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: `${BRAND.claim}. ${BRAND.subClaim}`,
  inLanguage: "fa-IR",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-ink">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
