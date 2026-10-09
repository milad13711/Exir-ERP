"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/lib/workspace-context";
import { toPersianDigits } from "@/lib/persian";

const DISMISS_KEY = "exir_2fa_banner_dismissed";

/**
 * بنر مهلت الزام 2FA برای مالک/مدیر: تا فعال‌سازی نمایش داده می‌شود. بستن آن فقط تا پایان همین نشست مرورگر
 * است (با ورود بعدی دوباره می‌آید) و در ۳ روز آخر مهلت قابل بستن نیست.
 */
export function TwoFactorGraceBanner() {
  const { me } = useWorkspace();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(window.sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const t = me?.twoFactor;
  if (!t || !t.required || t.enrolled || t.restricted) return null;
  const msLeft = t.graceEndsAt ? new Date(t.graceEndsAt).getTime() - Date.now() : null;
  const days = msLeft === null ? null : Math.max(0, Math.ceil(msLeft / 86_400_000));
  const urgent = days !== null && days <= 3;
  if (dismissed && !urgent) return null;

  return (
    <div role="alert" className="flex items-center gap-3 flex-wrap px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-[12.5px]">
      <span className="font-semibold flex-1 min-w-[220px]">
        {days === null
          ? "ورود دومرحله‌ای برای مالک و مدیران اجباری است؛ لطفاً آن را فعال کنید."
          : `تا ${toPersianDigits(String(days))} روز دیگر فعال‌سازی ورود دو مرحله‌ای برای مالک و مدیران اجباری می‌شود.`}
      </span>
      <Link href="/settings/profile#two-factor" className="px-3.5 py-1.5 rounded-lg bg-primary text-white font-bold">
        فعال‌سازی اکنون
      </Link>
      {urgent ? null : (
        <button
          type="button"
          className="text-muted cursor-pointer"
          aria-label="بستن"
          onClick={() => {
            setDismissed(true);
            try {
              window.sessionStorage.setItem(DISMISS_KEY, "1");
            } catch {
              /* ignore */
            }
          }}
        >
          بستن
        </button>
      )}
    </div>
  );
}
