"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createReport, fetchReportCategories, ApiError, type ReportCategory } from "@/lib/api";

export function NewReportModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [executionAt, setExecutionAt] = useState("");
  const [categories, setCategories] = useState<ReportCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReportCategories().then(setCategories);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createReport({
        title: title.trim(),
        body: body.trim(),
        categoryId: categoryId || undefined,
        executionAt: executionAt || undefined,
      });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت گزارش ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="گزارش جدید" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">عنوان گزارش</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">متن گزارش</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={5}
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary resize-none"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">دسته‌بندی (اختیاری)</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            >
              <option value="">بدون دسته‌بندی</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">زمان اجرا (اختیاری)</span>
            <input
              type="date"
              dir="ltr"
              value={executionAt}
              onChange={(e) => setExecutionAt(e.target.value)}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            />
          </label>
        </div>

        {error && <div className="text-[12.5px] text-danger">{error}</div>}

        <button
          type="submit"
          disabled={busy || !title.trim() || !body.trim()}
          className="text-[13px] font-bold px-4 py-2.5 rounded-xl bg-primary text-white disabled:opacity-50 cursor-pointer"
        >
          {busy ? "در حال ثبت..." : "ثبت گزارش"}
        </button>
      </form>
    </Modal>
  );
}
