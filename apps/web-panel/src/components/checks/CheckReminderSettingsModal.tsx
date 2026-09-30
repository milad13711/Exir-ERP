import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  setCheckReminderChannels,
  fetchChecksSmsSettings,
  updateChecksSmsSettings,
  type ChecksSmsSettings,
  ApiError,
} from "@/lib/api";

export function CheckReminderSettingsModal({
  currentSms,
  currentNotification,
  onClose,
  onSaved,
}: {
  currentSms: boolean;
  currentNotification: boolean;
  onClose: () => void;
  onSaved: (sms: boolean, notification: boolean) => void;
}) {
  const [sms, setSms] = useState(currentSms);
  const [notification, setNotification] = useState(currentNotification);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [smsSettings, setSmsSettings] = useState<ChecksSmsSettings | null>(null);
  const [smsSaved, setSmsSaved] = useState(false);

  useEffect(() => {
    fetchChecksSmsSettings().then(setSmsSettings);
  }, []);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const res = await setCheckReminderChannels({ sms, notification });
      onSaved(res.sms, res.notification);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSms() {
    if (!smsSettings) return;
    setSmsSettings(await updateChecksSmsSettings(smsSettings));
    setSmsSaved(true);
    setTimeout(() => setSmsSaved(false), 2000);
  }

  return (
    <Modal title="تنظیمات یادآوری چک" onClose={onClose} width="max-w-[440px]">
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted leading-6">
          هر چک بر اساس تعداد روز تعیین‌شده‌ی خودش (قابل ویرایش هنگام ثبت) پیش از سررسید یادآوری می‌شود. کانال‌های
          ارسال یادآوری را این‌جا فعال یا غیرفعال کنید.
        </p>

        <label className="flex items-center gap-2 text-[13px] font-bold cursor-pointer">
          <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} className="w-4 h-4" />
          پیامک به طرف حساب (مشتری برای چک دریافتی، تأمین‌کننده برای چک صادرشده)
        </label>

        <label className="flex items-center gap-2 text-[13px] font-bold cursor-pointer">
          <input
            type="checkbox"
            checked={notification}
            onChange={(e) => setNotification(e.target.checked)}
            className="w-4 h-4"
          />
          اعلان داخلی و ایمیل برای کارشناس ثبت‌کننده‌ی چک
        </label>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button
          onClick={handleSave}
          disabled={busy}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {busy ? "در حال ذخیره..." : "ذخیره"}
        </button>

        {smsSettings ? (
          <div className="border-t border-border pt-4 flex flex-col gap-3">
            <div className="text-[13px] font-extrabold">متن پیامک‌ها</div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={smsSettings.enabled}
                onChange={(e) => setSmsSettings({ ...smsSettings, enabled: e.target.checked })}
                className="w-4 h-4 cursor-pointer"
              />
              <span className="text-[12.5px] font-bold">ارسال پیامک برای این ماژول فعال باشد</span>
            </label>

            {(
              [
                ["یادآوری سررسید — چک دریافتی", "dueReminderReceivedTemplate"],
                ["یادآوری سررسید — چک صادرشده", "dueReminderIssuedTemplate"],
                ["هشدار برگشت چک (به مدیران)", "bounceAlertTemplate"],
              ] as const
            ).map(([label, key]) => (
              <div key={key} className="border border-border rounded-xl p-3">
                <div className="text-[12px] font-bold mb-2">{label}</div>
                <textarea
                  value={smsSettings[key]}
                  onChange={(e) => setSmsSettings({ ...smsSettings, [key]: e.target.value })}
                  rows={2}
                  className="w-full text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary resize-none"
                />
                <div className="text-[11px] text-muted mt-1.5" dir="ltr">
                  {key === "bounceAlertTemplate" ? "متغیرها: {direction} {partyName} {sayadId} {amount}" : "متغیرها: {sayadId} {amount} {dueDate}"}
                </div>
              </div>
            ))}

            <button
              onClick={handleSaveSms}
              className="self-start text-[12.5px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white cursor-pointer"
            >
              {smsSaved ? "ذخیره شد ✓" : "ذخیره متن پیامک‌ها"}
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
