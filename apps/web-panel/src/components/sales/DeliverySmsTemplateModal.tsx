import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { setDeliverySmsTemplate, fetchPaymentReminderDays, setPaymentReminderDays, ApiError } from "@/lib/api";

export function DeliverySmsTemplateModal({
  currentTemplate,
  onClose,
  onSaved,
}: {
  currentTemplate: string;
  onClose: () => void;
  onSaved: (template: string) => void;
}) {
  const [text, setText] = useState(currentTemplate);
  const [reminderDays, setReminderDays] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPaymentReminderDays()
      .then((res) => setReminderDays(String(res.days)))
      .catch(() => {});
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const [res] = await Promise.all([
        setDeliverySmsTemplate(text.trim()),
        setPaymentReminderDays(Number(reminderDays) || 0),
      ]);
      onSaved(res.template);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="تنظیمات فاکتور" onClose={onClose} width="max-w-[460px]">
      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">متن پیامک کد تأیید تحویل</label>
          <p className="text-[11.5px] text-muted leading-6 mb-2">
            از <code className="bg-slate-100 px-1 rounded">{"{code}"}</code> برای کد و{" "}
            <code className="bg-slate-100 px-1 rounded">{"{invoiceNo}"}</code> برای شماره فاکتور استفاده کنید.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={300}
            dir="rtl"
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors resize-none"
          />
          <div className="text-[11px] text-muted mt-1.5">
            پیش‌نمایش: {text.replace(/\{code\}/g, "۱۲۳۴۵۶").replace(/\{invoiceNo\}/g, "۱۲")}
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">
            یادآوری تکمیل وجه (چند روز قبل از سررسید، یا معوق‌شدن)
          </label>
          <p className="text-[11.5px] text-muted leading-6 mb-2">
            برای فاکتورهای دارای مانده که به این تعداد روز به سررسید نزدیک شده یا از آن گذشته باشند، پیامک به مشتری و
            اعلان به مدیر ارسال می‌شود.
          </p>
          <input
            value={reminderDays}
            onChange={(e) => setReminderDays(e.target.value.replace(/[^0-9]/g, ""))}
            dir="ltr"
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {busy ? "در حال ذخیره..." : "ذخیره"}
        </button>
      </form>
    </Modal>
  );
}
