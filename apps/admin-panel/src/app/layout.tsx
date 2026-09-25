import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "پنل مدیریت اکسیر ERP",
  description: "کنسول داخلی تیم مدیریت اکسیر — تننت‌ها، اشتراک‌ها، پشتیبانی",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
  appleWebApp: { capable: true, title: "اکسیر ERP", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1a45c8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl" className="h-full antialiased">
      <body className="min-h-full flex flex-col text-ink app-backdrop">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
