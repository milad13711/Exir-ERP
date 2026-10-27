"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  type CategoryChannelPref,
  type NotificationCategoryKey,
  type NotificationPreferences,
} from "@/lib/api";
import { PushNotificationRow, Toggle } from "@/components/settings/PushNotificationRow";
import { PushDevicesPanel } from "@/components/settings/PushDevicesPanel";
import { InstallAppRow } from "@/components/settings/InstallAppRow";

const CATEGORIES: { key: NotificationCategoryKey; label: string; hint: string; pushDefault: boolean }[] = [
  { key: "messenger", label: "پیام‌رسان", hint: "پیام جدید گفتگوها (منشن حتی در حالت بی‌صدا می‌رسد)", pushDefault: true },
  { key: "tasks", label: "وظایف", hint: "ارجاع، نتیجه، تأیید/برگشت، مهلت و تمدید", pushDefault: true },
  { key: "reminders", label: "یادآوری‌ها", hint: "آلارم یادآوری‌های تقویم در لحظه‌ی موعد", pushDefault: true },
  { key: "correspondence", label: "مکاتبات", hint: "ارجاع و درخواست امضا", pushDefault: true },
  { key: "approvals", label: "تأییدیه‌ها", hint: "مرخصی، درخواست‌ها و گردش تأیید", pushDefault: true },
  { key: "system", label: "سیستم", hint: "هشدارهای عمومی، مالی و امنیتی", pushDefault: true },
  { key: "marketing", label: "بازاریابی", hint: "کمپین‌ها و پیشنهادها", pushDefault: false },
];

export default function NotificationsSettingsPage() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    fetchNotificationPreferences().then(setPrefs).catch(() => {});
  }, []);

  async function handleChange(patch: Partial<NotificationPreferences>) {
    if (!prefs) return;
    setPrefs({ ...prefs, ...patch });
    try {
      const next = await updateNotificationPreferences(patch);
      setPrefs(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      fetchNotificationPreferences().then(setPrefs).catch(() => {});
    }
  }

  function setCat(cat: NotificationCategoryKey, ch: keyof CategoryChannelPref, v: boolean) {
    if (!prefs) return;
    const cur = prefs.categoryPrefs[cat] ?? {};
    void handleChange({ categoryPrefs: { ...prefs.categoryPrefs, [cat]: { ...cur, [ch]: v } } });
  }

  return (
    <div className="pb-10">
      <h1 className="text-xl font-extrabold">اعلان‌ها</h1>
      <p className="text-[13.5px] text-muted mt-1">
        تعیین کنید چه اعلانی، از چه راهی و چه ساعتی به شما برسد؛ دستگاه‌ها را مدیریت و اعلان آزمایشی بفرستید.
      </p>

      <Card className="mt-6 p-2 max-w-[640px]">
        {prefs === null ? (
          <div className="py-6 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : (
          <>
            <PushNotificationRow onChanged={() => setReload((n) => n + 1)} />
            <InstallAppRow />
            <PushDevicesPanel reloadKey={reload} />
            <div className="px-4 pb-4 -mt-1">
              <Link href="/settings/notifications/diagnostics" className="text-[12px] font-bold text-primary">
                اعلان نمی‌رسد؟ عیب‌یابی اتصال و پوش ←
              </Link>
            </div>
          </>
        )}
      </Card>

      {prefs ? (
        <>
          <Card className="mt-5 p-2 max-w-[640px]">
            <div className="px-4 pt-3 pb-1 text-[13px] font-bold">اعلان هر بخش</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-muted">
                    <th className="text-start font-semibold px-4 py-2">بخش</th>
                    <th className="font-semibold px-2 py-2">پوش</th>
                    <th className="font-semibold px-2 py-2">درون‌برنامه</th>
                    <th className="font-semibold px-2 py-2">پیامک</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIES.map((c) => {
                    const p = prefs.categoryPrefs[c.key] ?? {};
                    return (
                      <tr key={c.key} className="border-t border-border">
                        <td className="px-4 py-3">
                          <div className="font-bold text-[12.5px]">{c.label}</div>
                          <div className="text-[11px] text-muted leading-5">{c.hint}</div>
                        </td>
                        <td className="px-2 py-3"><div className="flex justify-center"><Toggle checked={p.push ?? c.pushDefault} onClick={() => setCat(c.key, "push", !(p.push ?? c.pushDefault))} /></div></td>
                        <td className="px-2 py-3"><div className="flex justify-center"><Toggle checked={p.inApp ?? true} onClick={() => setCat(c.key, "inApp", !(p.inApp ?? true))} /></div></td>
                        <td className="px-2 py-3"><div className="flex justify-center"><Toggle checked={p.sms ?? prefs.smsEnabled} onClick={() => setCat(c.key, "sms", !(p.sms ?? prefs.smsEnabled))} /></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 text-[11px] text-muted leading-5 border-t border-border">
              آلارم یادآوری در لحظه‌ی موعد و هشدارهای امنیتی «حیاتی» هستند: از ساعات سکوت مستثنا می‌شوند و همیشه درون‌برنامه ثبت می‌شوند.
            </div>
          </Card>

          <Card className="mt-5 p-2 max-w-[640px]">
            <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-border">
              <div>
                <div className="text-[13px] font-bold">ساعات سکوت (به وقت تهران)</div>
                <div className="text-[11.5px] text-muted mt-0.5 leading-5">در این بازه پوش و پیامک نمی‌آید (اعلان درون‌برنامه ثبت می‌شود). فقط اعلان‌های حیاتی استثنا هستند.</div>
              </div>
              <Toggle checked={prefs.quietHoursEnabled} onClick={() => handleChange({ quietHoursEnabled: !prefs.quietHoursEnabled })} />
            </div>
            {prefs.quietHoursEnabled ? (
              <div className="flex items-center gap-3 px-4 py-4 border-b border-border text-[12.5px]">
                <label className="flex items-center gap-2">
                  از
                  <input type="time" dir="ltr" value={prefs.quietStart} onChange={(e) => e.target.value && handleChange({ quietStart: e.target.value })} className="border border-border rounded-lg px-2 py-1.5" />
                </label>
                <label className="flex items-center gap-2">
                  تا
                  <input type="time" dir="ltr" value={prefs.quietEnd} onChange={(e) => e.target.value && handleChange({ quietEnd: e.target.value })} className="border border-border rounded-lg px-2 py-1.5" />
                </label>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-border">
              <div>
                <div className="text-[13px] font-bold">پیامک جایگزین برای اعلان مهم</div>
                <div className="text-[11.5px] text-muted mt-0.5 leading-5">اگر آلارم یادآوری، وظیفه‌ی فوری یا درخواست امضا به هیچ دستگاهی نرسید، یک پیامک (حداکثر ۳ بار در روز) می‌فرستیم.</div>
              </div>
              <Toggle checked={prefs.smsFallbackEnabled} onClick={() => handleChange({ smsFallbackEnabled: !prefs.smsFallbackEnabled })} />
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-border">
              <div>
                <div className="text-[13px] font-bold">پخش صدا هنگام اعلان جدید</div>
                <div className="text-[11.5px] text-muted mt-0.5">با رسیدن اعلان جدید در زنگوله، یک صدای کوتاه پخش شود</div>
              </div>
              <Toggle checked={prefs.soundEnabled} onClick={() => handleChange({ soundEnabled: !prefs.soundEnabled })} />
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-border">
              <div>
                <div className="text-[13px] font-bold">ایمیل</div>
                <div className="text-[11.5px] text-muted mt-0.5">ارسال به ایمیل ثبت‌شده در پروفایل کاربری</div>
              </div>
              <Toggle checked={prefs.emailEnabled} onClick={() => handleChange({ emailEnabled: !prefs.emailEnabled })} />
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-4">
              <div>
                <div className="text-[13px] font-bold">پیامک (پیش‌فرض همه‌ی بخش‌ها)</div>
                <div className="text-[11.5px] text-muted mt-0.5">ارسال به شماره موبایل ثبت‌شده؛ هر بخش در جدول بالا جدا قابل تنظیم است</div>
              </div>
              <Toggle checked={prefs.smsEnabled} onClick={() => handleChange({ smsEnabled: !prefs.smsEnabled })} />
            </div>
          </Card>
        </>
      ) : null}
      {saved ? <div className="mt-3 text-[12.5px] text-success font-semibold">ذخیره شد ✓</div> : null}
    </div>
  );
}
