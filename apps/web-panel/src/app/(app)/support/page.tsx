"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { requestSupportOpen } from "@/lib/support-open";

// لینک اعلان‌های پشتیبانی: /support?ticket=ID — پنل چت پشتیبانی را روی همان تیکت باز می‌کند
// و کاربر را به داشبورد می‌برد (پشتیبانی صفحه‌ی مستقل ندارد، پنل شناور است).
function SupportRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  const ticketId = params.get("ticket");
  useEffect(() => {
    requestSupportOpen({ ticketId: ticketId && /^[0-9a-fA-F-]{8,64}$/.test(ticketId) ? ticketId : null });
    router.replace("/dashboard");
  }, [ticketId, router]);
  return <div className="p-6 text-sm text-slate-500">در حال باز کردن پشتیبانی…</div>;
}

export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportRedirect />
    </Suspense>
  );
}
