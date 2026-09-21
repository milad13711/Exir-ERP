"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";

/** دکمه‌ی حذف رکورد با تأیید و نمایش پیام روشن اگر رکورد به سوابق دیگر وصل باشد. */
export function DeleteRecordButton({
  label = "حذف",
  confirmText = "این رکورد برای همیشه حذف شود؟",
  onDelete,
  onDeleted,
}: {
  label?: string;
  confirmText?: string;
  onDelete: () => Promise<unknown>;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4 pt-3 border-t border-border flex items-center gap-3 flex-wrap">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(confirmText)) return;
          setBusy(true);
          setError(null);
          try {
            await onDelete();
            onDeleted();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "حذف ناموفق بود");
          } finally {
            setBusy(false);
          }
        }}
        className="text-[12px] font-bold text-danger bg-danger-soft px-3.5 py-2 rounded-lg cursor-pointer disabled:opacity-50"
      >
        {busy ? "در حال حذف..." : label}
      </button>
      {error && <span className="text-[12px] text-danger font-semibold">{error}</span>}
    </div>
  );
}
