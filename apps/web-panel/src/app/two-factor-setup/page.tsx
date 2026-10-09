"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/icons";
import { TwoFactorCard } from "@/components/settings/TwoFactorCard";
import { clearToken, fetchTwoFaStatus, getToken } from "@/lib/api";

/**
 * صفحه‌ی ثبت اجباری 2FA برای مالک/مدیر (نشست محدود). تا ثبت کامل نشود هیچ بخش دیگری از پنل کار نمی‌کند
 * (بک‌اند همه‌ی مسیرهای دیگر را ۴۰۳ TWO_FACTOR_ENROLLMENT_REQUIRED می‌دهد). بعد از ثبت، توکن عادی جایگزین می‌شود.
 */
export default function TwoFactorSetupPage() {
  const router = useRouter();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // قبلاً ثبت شده (مثلاً در تب دیگر): اجازه‌ی ادامه بده.
    fetchTwoFaStatus().then((s) => s.enabled && setDone(true)).catch(() => {});
  }, [router]);

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <div dir="rtl" className="min-h-dvh flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-[520px]">
        <div className="flex items-center gap-2.5 justify-center mb-4">
          <LogoMark className="w-8 h-8" />
          <div className="text-lg font-extrabold">exir ERP</div>
        </div>
        <div className="text-center text-[13.5px] leading-relaxed mb-1">
          برای امنیت اطلاعات کسب‌وکار، ورود دومرحله‌ای برای مالک و مدیران اجباری است. لطفاً آن را همین حالا فعال کنید.
        </div>
        <TwoFactorCard mandatory onEnabled={() => setDone(true)} />
        <div className="flex items-center justify-between mt-4 max-w-[480px]">
          {done ? (
            <button type="button" onClick={() => router.push("/dashboard")} className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer">
              ذخیره کردم، ادامه
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={handleLogout} className="text-[12.5px] text-muted underline cursor-pointer">
            خروج از حساب
          </button>
        </div>
      </div>
    </div>
  );
}
