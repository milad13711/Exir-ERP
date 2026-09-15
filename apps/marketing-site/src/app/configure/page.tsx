import { Suspense } from "react";
import type { Metadata } from "next";
import { ConfigureClient } from "./ConfigureClient";
import { BRAND } from "@/lib/content";

export const metadata: Metadata = {
  title: "پیکربندی پلن و قیمت",
  description: `پلن و ماژول‌های مورد نیازتان را انتخاب کنید و قیمت دقیق ${BRAND.name} را همین حالا ببینید — بدون نیاز به تماس تلفنی.`,
};

export default function ConfigurePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-muted text-sm">در حال بارگذاری...</div>}>
      <ConfigureClient />
    </Suspense>
  );
}
