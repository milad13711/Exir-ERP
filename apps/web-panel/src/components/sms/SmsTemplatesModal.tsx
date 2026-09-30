"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";

export type SmsTemplateField<T> = { label: string; key: keyof T & string; placeholders?: string };

/**
 * ماژول عمومی «تنظیمات پیامک» — الگوبرداری از RecruitmentSettingsTab: یک
 * سوییچ فعال/غیرفعال کلی، و یک textarea مستقل برای هر پیامک با یادداشت
 * متغیرهای قابل استفاده. برای هر ماژولی که چند قالب پیامک متفاوت دارد و
 * صفحه‌ی خودش تب/زیرصفحه‌ی جداگانه‌ای برای تنظیمات ندارد، به‌جای پیاده‌سازی
 * جداگانه از این کامپوننت به‌همراه fetch/update خودِ آن ماژول استفاده کنید.
 */
export function SmsTemplatesModal<T extends { enabled: boolean }>({
  title,
  fields,
  fetchSettings,
  updateSettings,
  onClose,
}: {
  title: string;
  fields: ReadonlyArray<SmsTemplateField<T>>;
  fetchSettings: () => Promise<T>;
  updateSettings: (data: T) => Promise<T>;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<T | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchSettings().then(setSettings);
  }, [fetchSettings]);

  async function handleSave() {
    if (!settings) return;
    setBusy(true);
    try {
      setSettings(await updateSettings(settings));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width="max-w-[520px]">
      {!settings ? (
        <div className="p-4 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              className="w-4 h-4 cursor-pointer"
            />
            <span className="text-[13px] font-bold">ارسال پیامک برای این ماژول فعال باشد</span>
          </label>

          {fields.map((f) => (
            <div key={f.key} className="border border-border rounded-xl p-3">
              <div className="text-[12.5px] font-bold mb-2">{f.label}</div>
              <textarea
                value={(settings[f.key] as unknown as string) ?? ""}
                onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })}
                rows={2}
                className="w-full text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary resize-none"
              />
              {f.placeholders ? (
                <div className="text-[11px] text-muted mt-1.5" dir="ltr">
                  متغیرها: {f.placeholders}
                </div>
              ) : null}
            </div>
          ))}

          <button
            onClick={handleSave}
            disabled={busy}
            className="self-start text-[12.5px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white cursor-pointer disabled:opacity-50"
          >
            {saved ? "ذخیره شد ✓" : busy ? "در حال ذخیره..." : "ذخیره"}
          </button>
        </div>
      )}
    </Modal>
  );
}
