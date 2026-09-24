"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { createInternalTask, fetchStaff, ApiError, type StaffMember } from "@/lib/api";

const FIELD = "w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5";

/** ساخت وظیفه‌ی داخلی روی یک تیکت پشتیبانی — عنوان از موضوع تیکت پر می‌شود، ارجاع و موعد اختیاری است. */
export function TicketTaskModal({
  ticketId,
  ticketSubject,
  tenantName,
  onClose,
  onCreated,
}: {
  ticketId: string;
  ticketSubject: string;
  tenantName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState(`پیگیری تیکت: ${ticketSubject}`);
  const [description, setDescription] = useState(`تننت: ${tenantName}`);
  const [dueAt, setDueAt] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStaff().then(setStaff).catch(() => setStaff([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createInternalTask({
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        assignedToId: assignedToId || undefined,
        ticketId,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت وظیفه ناموفق بود");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="ایجاد وظیفه روی این تیکت" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">عنوان</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">توضیحات</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={FIELD} />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">ارجاع به</label>
          <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className={FIELD}>
            <option value="">بدون ارجاع</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">موعد انجام</label>
          <JalaliDateTimeInput value={dueAt} onChange={setDueAt} placeholder="اختیاری" />
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !title.trim()}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "ثبت وظیفه"}
        </button>
      </form>
    </Modal>
  );
}
