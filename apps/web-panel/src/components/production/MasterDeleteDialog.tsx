"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ApiError } from "@/lib/api";

/**
 * حذف امن داده‌ی پایه‌ی تولید (فرمول/ایستگاه): اگر در سوابق استفاده شده باشد، حذف ممکن نیست و
 * با یک کلیک «بایگانی» پیشنهاد می‌شود؛ اگر استفاده نشده باشد، حذف قطعی با تأیید.
 */
export function MasterDeleteDialog({
  title,
  usageCount,
  usageNoun,
  canDelete,
  onDelete,
  onArchive,
  onClose,
  onDone,
}: {
  title: string;
  usageCount: number;
  /** مثلاً «دستور تولید» یا «مرحله‌ی دستور تولید» */
  usageNoun: string;
  canDelete: boolean;
  onDelete: () => Promise<unknown>;
  onArchive: () => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const used = usageCount > 0;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={used ? "حذف ممکن نیست" : "حذف قطعی"} onClose={onClose} width="max-w-[440px]">
      <div className="flex flex-col gap-3.5">
        <div className="text-[13px] font-bold">{title}</div>
        {used ? (
          <p className="text-[12.5px] text-ink-soft leading-6">
            در {usageCount.toLocaleString("fa-IR")} {usageNoun} استفاده شده است؛ برای حفظ تاریخچه و بهای تمام‌شده حذف نمی‌شود.
            با «بایگانی» از فهرست‌های انتخاب پنهان می‌شود ولی در سوابق باقی می‌ماند و هر زمان قابل بازیابی است.
          </p>
        ) : (
          <p className="text-[12.5px] text-ink-soft leading-6">این مورد در هیچ سابقه‌ای استفاده نشده و برای همیشه حذف می‌شود.</p>
        )}
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <div className="flex gap-2 flex-wrap">
          {used || !canDelete ? (
            <button
              disabled={busy}
              onClick={() => run(onArchive)}
              className="flex-1 min-h-10 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
            >
              {busy ? "..." : "بایگانی"}
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => run(onDelete)}
              className="flex-1 min-h-10 rounded-xl bg-danger text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
            >
              {busy ? "..." : "حذف قطعی"}
            </button>
          )}
          <button onClick={onClose} className="min-h-10 px-4 rounded-xl border border-border text-[13px] font-bold cursor-pointer">
            انصراف
          </button>
        </div>
      </div>
    </Modal>
  );
}
