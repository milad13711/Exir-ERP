"use client";

import { useState } from "react";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { DeleteRecordButton } from "@/components/ui/DeleteRecordButton";
import { useModuleCan } from "@/hooks/useModuleCan";
import { updateEvent, deleteEvent, ApiError, type EventItem } from "@/lib/api";

const inputClass =
  "w-full min-h-10 text-[16px] sm:text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1 block";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** ویرایش مشخصات رویداد + حذف (فقط رویداد بی‌رزرو؛ در غیر این صورت «لغو رویداد»). */
export function EventEditPanel({ event, onChanged, onDeleted }: { event: EventItem; onChanged: () => void; onDeleted: () => void }) {
  const can = useModuleCan("events");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? "");
  const [venue, setVenue] = useState(event.venue ?? "");
  const [category, setCategory] = useState(event.category ?? "");
  const [capacity, setCapacity] = useState(event.capacity != null ? String(event.capacity) : "");
  const [startAt, setStartAt] = useState(toLocalInput(event.startAt));
  const [endAt, setEndAt] = useState(toLocalInput(event.endAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!can.canEdit && !can.canDelete) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateEvent(event.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        venue: venue.trim() || undefined,
        category: category.trim() || undefined,
        capacity: capacity ? Number(capacity) : undefined,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
      });
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-xl p-3">
      {can.canEdit && event.status !== "CANCELLED" && event.status !== "COMPLETED" ? (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-[12.5px] font-bold text-primary min-h-10 cursor-pointer">
            {open ? "بستن ویرایش" : "ویرایش مشخصات رویداد"}
          </button>
          {open ? (
            <form onSubmit={save} className="flex flex-col gap-2.5 mt-2">
              <div>
                <label className={labelClass}>عنوان</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>توضیحات</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={labelClass}>محل برگزاری</label>
                  <input value={venue} onChange={(e) => setVenue(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>دسته‌بندی</label>
                  <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>شروع</label>
                  <JalaliDateTimeInput value={startAt} onChange={setStartAt} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>پایان</label>
                  <JalaliDateTimeInput value={endAt} onChange={setEndAt} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>ظرفیت کل</label>
                  <input value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" dir="ltr" className={inputClass} />
                </div>
              </div>
              {error ? <div className="text-[12px] text-danger">{error}</div> : null}
              <button type="submit" disabled={busy || !title.trim() || !startAt || !endAt} className="min-h-10 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50">
                {busy ? "در حال ذخیره..." : "ذخیره‌ی تغییرات"}
              </button>
            </form>
          ) : null}
        </>
      ) : null}
      {can.canDelete ? (
        <DeleteRecordButton
          label="حذف رویداد"
          confirmText="این رویداد حذف شود؟ (رویداد دارای رزرو یا بلیط حذف نمی‌شود؛ آن را لغو کنید)"
          onDelete={() => deleteEvent(event.id)}
          onDeleted={onDeleted}
        />
      ) : null}
    </div>
  );
}
