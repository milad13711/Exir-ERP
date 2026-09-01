import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { setCheckReminderChannels, ApiError } from "@/lib/api";

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
      </div>
    </Modal>
  );
}
