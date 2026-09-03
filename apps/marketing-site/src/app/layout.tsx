import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "اکسیر ERP — نرم‌افزار یکپارچه مدیریت کسب‌وکار",
  description: "قالب صنفی خودتان را انتخاب کنید، ماژول‌های موردنیازتان را بچینید، و همین امروز شروع کنید.",
};

export const viewport: Viewport = {
  themeColor: "#4338ca",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-ink">{children}</body>
    </html>
  );
}
