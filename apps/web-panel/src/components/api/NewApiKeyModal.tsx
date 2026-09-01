import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createApiKey, type ApiKeyEntry } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";

export function NewApiKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: ApiKeyEntry) => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const key = await createApiKey(name.trim());
      setRawKey(key.rawKey);
      onCreated(key);
    } finally {
      setSubmitting(false);
    }
  }

  function handleCopy() {
    if (!rawKey) return;
    navigator.clipboard.writeText(rawKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Modal title="کلید API جدید" onClose={onClose}>
      {rawKey ? (
        <div className="flex flex-col gap-4">
          <div className="text-[12.5px] text-warning bg-warning-soft rounded-xl p-3.5 leading-relaxed">
            این کلید فقط همین یک‌بار نمایش داده می‌شود. آن را در جای امنی ذخیره کنید — بعد از بستن این پنجره
            دیگر قابل مشاهده نیست.
          </div>
          <div
            className="bg-slate-900 text-slate-100 rounded-xl p-3.5 text-[12.5px] font-mono break-all"
            dir="ltr"
          >
            {rawKey}
          </div>
          <button
            onClick={handleCopy}
            className="w-full py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer"
          >
            {copied ? "کپی شد ✓" : "کپی کردن کلید"}
          </button>
          <button onClick={onClose} className="text-[12.5px] text-muted font-semibold cursor-pointer">
            بستن
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">
              نام کلید (برای شناسایی بعدی)
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثلاً اسکریپت گزارش‌گیری"
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submitting ? "در حال ساخت..." : "ساخت کلید"}
          </button>
        </form>
      )}
    </Modal>
  );
}
