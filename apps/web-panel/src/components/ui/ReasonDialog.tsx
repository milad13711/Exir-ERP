"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

/** تأیید یک اقدام حساس (ابطال/حذف نرم) با «دلیل» الزامی. onConfirm خطا بدهد، پیام همین‌جا نشان داده می‌شود. */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  tone = "danger",
  minLength = 3,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  minLength?: number;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (reason.trim().length < minLength) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "اقدام ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width="max-w-[460px]">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-[12.5px] leading-7 text-ink-soft">{description}</p>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">دلیل (الزامی)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 resize-none focus:border-primary"
          />
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || reason.trim().length < minLength}
            className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold cursor-pointer disabled:opacity-50 ${tone === "danger" ? "bg-danger text-white" : "bg-primary text-white"}`}
          >
            {busy ? "در حال انجام..." : confirmLabel}
          </button>
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer">
            انصراف
          </button>
        </div>
      </form>
    </Modal>
  );
}
