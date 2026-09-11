"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { copyToClipboard } from "@/lib/clipboard";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { fetchQrCode, updateQrCode, deleteQrCode, fetchQrCodeImageObjectUrl, ApiError, type QrCodeItem } from "@/lib/api";

export function QrCodeDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [item, setItem] = useState<QrCodeItem | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchQrCode(id).then((r) => {
      setItem(r);
      setLabel(r.label);
      setTargetUrl(r.targetUrl);
    });
    fetchQrCodeImageObjectUrl(id).then(setImageUrl).catch(() => setImageUrl(null));
  }
  useEffect(reload, [id]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateQrCode(id, { label: label.trim(), targetUrl: targetUrl.trim() });
      setItem(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm("این کد QR حذف شود؟ لینک آن دیگر کار نخواهد کرد.")) return;
    await deleteQrCode(id);
    onChanged();
    onClose();
  }

  async function handleCopyLink() {
    if (!item) return;
    const ok = await copyToClipboard(item.redirectUrl);
    if (ok) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }

  if (!item) {
    return (
      <Modal title="جزئیات کد QR" onClose={onClose}>
        <div className="text-center text-muted py-6">در حال بارگذاری...</div>
      </Modal>
    );
  }

  return (
    <Modal title={item.label} onClose={onClose} width="max-w-[480px]">
      <div className="flex flex-col gap-4">
        {imageUrl && (
          <div className="flex flex-col items-center gap-2">
            <img src={imageUrl} alt="کد QR" className="w-48 h-48 rounded-xl border border-border" />
            <a href={imageUrl} download={`qr-${item.code}.png`} className="text-[12px] font-bold text-primary">
              دانلود تصویر
            </a>
          </div>
        )}

        <div>
          <div className="text-[12px] font-semibold text-ink-soft mb-1.5">لینک اسکن (داخل تصویر QR)</div>
          <div className="flex items-center gap-2">
            <input readOnly value={item.redirectUrl} dir="ltr" className="flex-1 text-[12px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2 text-muted" />
            <button onClick={handleCopyLink} className="text-[12px] font-bold px-3 py-2 rounded-lg bg-primary-soft text-primary cursor-pointer shrink-0">
              {linkCopied ? "کپی شد ✓" : "کپی"}
            </button>
          </div>
        </div>

        <div className="text-[12px] text-muted">
          {toPersianDigits(item.scanCount)} بار اسکن شده
          {item.lastScannedAt ? ` · آخرین بار ${formatJalaliDateTime(item.lastScannedAt)}` : ""}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">عنوان</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">لینک مقصد</span>
          <input
            dir="ltr"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
        </label>

        {error && <div className="text-[12.5px] text-danger">{error}</div>}

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={busy}
            className="flex-1 text-[13px] font-bold px-4 py-2.5 rounded-xl bg-primary text-white disabled:opacity-50 cursor-pointer"
          >
            {saved ? "ذخیره شد ✓" : "ذخیره تغییرات"}
          </button>
          <button onClick={handleDelete} className="text-[13px] font-bold px-4 py-2.5 rounded-xl bg-danger-soft text-danger cursor-pointer">
            حذف
          </button>
        </div>
      </div>
    </Modal>
  );
}
