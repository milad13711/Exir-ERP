import { Suspense } from "react";
import type { Metadata } from "next";
import { ConfigureClient } from "./ConfigureClient";
import { BRAND } from "@/lib/content";

export const metadata: Metadata = {
  title: "قیمت نرم‌افزار ERP فارسی | پیکربندی پلن اکسیر",
  description: `پلن و ماژول‌های مورد نیازتان را انتخاب کنید و قیمت دقیق ${BRAND.name}، نرم‌افزار ERP فارسی، را همین حالا ببینید — بدون نیاز به تماس تلفنی.`,
  alternates: { canonical: "/configure" },
};

export default function ConfigurePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-muted text-sm">در حال بارگذاری...</div>}>
      <ConfigureClient />
    </Suspense>
  );
}
