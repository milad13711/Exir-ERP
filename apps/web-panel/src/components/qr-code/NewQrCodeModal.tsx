"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createQrCode, ApiError } from "@/lib/api";

export function NewQrCodeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createQrCode({ label: label.trim(), targetUrl: targetUrl.trim() });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ساخت کد QR ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="کد QR جدید" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">عنوان (برای شناسایی در این لیست)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="مثلاً: برچسب بسته‌بندی محصول X"
            required
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">لینک مقصد</span>
          <input
            dir="ltr"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://..."
            required
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
          <span className="text-[11px] text-muted">هر لینک — از سایت خودتان، لینک عمومی یکی از ماژول‌های اکسیر، یا هر آدرس دیگری</span>
        </label>

        {error && <div className="text-[12.5px] text-danger">{error}</div>}

        <button type="submit" disabled={busy} className="text-[13px] font-bold px-4 py-2.5 rounded-xl bg-primary text-white disabled:opacity-50 cursor-pointer">
          {busy ? "در حال ساخت..." : "ساخت کد QR"}
        </button>
      </form>
    </Modal>
  );
}
