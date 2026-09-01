"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/api";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer shrink-0 ${
        checked ? "bg-primary" : "bg-slate-200"
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[-22px]" : "translate-x-[-2px]"
        }`}
        style={{ right: 0 }}
      />
    </button>
  );
}

export default function NotificationsSettingsPage() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchNotificationPreferences().then(setPrefs);
  }, []);

  async function handleChange(patch: Partial<NotificationPreferences>) {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await updateNotificationPreferences(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold">اعلان‌ها</h1>
      <p className="text-[13.5px] text-muted mt-1">
        کانال‌های دریافت اعلان را برای رویدادهایی مثل بررسی مرخصی یا تغییر مرحله‌ی فرصت فروش تنظیم کنید
      </p>

      <Card className="mt-6 p-2 max-w-[540px]">
        {prefs === null ? (
          <div className="py-6 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <div>
                <div className="text-[13px] font-bold">اعلان داخل‌برنامه‌ای</div>
                <div className="text-[11.5px] text-muted mt-0.5">همیشه فعال — از زنگوله‌ی بالای صفحه قابل مشاهده است</div>
              </div>
              <Toggle checked onChange={() => {}} />
            </div>
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <div>
                <div className="text-[13px] font-bold">ایمیل</div>
                <div className="text-[11.5px] text-muted mt-0.5">ارسال به ایمیل ثبت‌شده در پروفایل کاربری</div>
              </div>
              <Toggle checked={prefs.emailEnabled} onChange={(v) => handleChange({ emailEnabled: v })} />
            </div>
            <div className="flex items-center justify-between px-4 py-4">
              <div>
                <div className="text-[13px] font-bold">پیامک</div>
                <div className="text-[11.5px] text-muted mt-0.5">ارسال به شماره موبایل ثبت‌شده در پروفایل کاربری</div>
              </div>
              <Toggle checked={prefs.smsEnabled} onChange={(v) => handleChange({ smsEnabled: v })} />
            </div>
          </>
        )}
      </Card>
      {saved ? <div className="mt-3 text-[12.5px] text-success font-semibold">ذخیره شد ✓</div> : null}
    </div>
  );
}
