import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { fetchBookingSmsSettings, updateBookingSmsSettings, ApiError, type BookingSmsSettings } from "@/lib/api";

/** ویرایش متن پیامک تأییدِ نهاییِ نوبت — تا مثلاً شماره‌ی تماس واقعی برای هماهنگی در متن درج شود. */
export function MessageSettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<BookingSmsSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchBookingSmsSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof ApiError ? err.message : "بارگذاری تنظیمات ناموفق بود"));
  }, []);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      setSettings(await updateBookingSmsSettings(settings));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره‌سازی ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="متن پیامک تأیید نوبت" onClose={onClose} width="max-w-[480px]">
      {!settings ? (
        <div className="text-center text-muted py-6 text-[13px]">{error ?? "در حال بارگذاری..."}</div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-[12px] text-ink-soft">
            این متن هنگام تأیید نهایی نوبت (توسط شما یا کارشناس) برای مشتری پیامک می‌شود؛ تاریخ، ساعت، خدمت، آدرس و لینک جزئیات جلسه خودکار به آن اضافه می‌شود.
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">متن سرخط پیام</span>
            <textarea
              value={settings.confirmationTemplate}
              onChange={(e) => setSettings({ ...settings, confirmationTemplate: e.target.value })}
              rows={3}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            />
          </label>
          <div className="text-[11px] text-muted" dir="ltr">
            متغیرها: {"{name} {date} {time} {service} {phone}"}
          </div>
          {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}
          <button
            disabled={busy || !settings.confirmationTemplate.trim()}
            onClick={save}
            className="self-start text-[12.5px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white cursor-pointer disabled:opacity-50"
          >
            {saved ? "ذخیره شد ✓" : busy ? "در حال ذخیره..." : "ذخیره"}
          </button>
        </div>
      )}
    </Modal>
  );
}
