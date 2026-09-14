"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { fetchReportCategories, createReportCategory, deleteReportCategory, ApiError, type ReportCategory } from "@/lib/api";

export function ReportCategoriesTab({ onClose }: { onClose: () => void }) {
  const [categories, setCategories] = useState<ReportCategory[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchReportCategories().then(setCategories);
  }
  useEffect(reload, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createReportCategory(name.trim());
      setName("");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "افزودن دسته‌بندی ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("این دسته‌بندی حذف شود؟")) return;
    await deleteReportCategory(id);
    reload();
  }

  return (
    <Modal title="دسته‌بندی‌های گزارش" onClose={onClose} width="max-w-[420px]">
      <div className="flex flex-col gap-3">
        {categories === null ? (
          <div className="text-center text-muted py-6 text-sm">در حال بارگذاری...</div>
        ) : categories.length === 0 ? (
          <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border">
            دسته‌بندی‌ای ثبت نشده است
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5">
                <span className="text-[12.5px] font-semibold min-w-0 break-words">{c.name}</span>
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1 rounded-lg cursor-pointer shrink-0"
                >
                  حذف
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="نام دسته‌بندی جدید"
            className="flex-1 min-w-[160px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
          >
            افزودن
          </button>
        </form>
        {error && <div className="text-[12.5px] text-danger">{error}</div>}
      </div>
    </Modal>
  );
}
