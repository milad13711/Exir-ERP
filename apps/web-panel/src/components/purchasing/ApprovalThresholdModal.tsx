import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { setPurchaseApprovalThreshold, ApiError } from "@/lib/api";

export function ApprovalThresholdModal({
  currentThreshold,
  onClose,
  onSaved,
}: {
  currentThreshold: number | null;
  onClose: () => void;
  onSaved: (threshold: number | null) => void;
}) {
  const [enabled, setEnabled] = useState(currentThreshold != null);
  const [amount, setAmount] = useState(currentThreshold ? String(currentThreshold) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const threshold = enabled ? Number(amount) : null;
    if (enabled && !threshold) return;
    setBusy(true);
    setError(null);
    try {
      const res = await setPurchaseApprovalThreshold(threshold);
      onSaved(res.threshold);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="تنظیمات تأیید سفارش خرید" onClose={onClose} width="max-w-[440px]">
      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted leading-6">
          سفارش‌های خرید با مبلغ بیشتر از آستانه‌ی زیر، پیش از دریافت کالا نیازمند تأیید مالک یا مدیر سیستم خواهند بود.
        </p>

        <label className="flex items-center gap-2 text-[13px] font-bold cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4" />
          فعال‌سازی نیاز به تأیید برای سفارش‌های بزرگ
        </label>

        {enabled ? (
          <div>
            <label className="text-[12px] text-muted mb-1.5 block">آستانه‌ی مبلغ (تومان)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              dir="ltr"
              placeholder="مثلاً 50000000"
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors"
            />
          </div>
        ) : null}

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button
          type="submit"
          disabled={busy || (enabled && !Number(amount))}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {busy ? "در حال ذخیره..." : "ذخیره"}
        </button>
      </form>
    </Modal>
  );
}
