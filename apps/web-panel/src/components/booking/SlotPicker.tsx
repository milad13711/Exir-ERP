"use client";

import { useEffect, useState } from "react";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { toPersianDigits } from "@/lib/persian";
import type { FreeSlot } from "@/lib/api";

/** انتخاب زمان فقط از وقت‌های آزاد: ابتدا روز (تقویم شمسی)، سپس یکی از ساعت‌های آزاد همان روز. */
export function SlotPicker({
  loadSlots,
  value,
  onChange,
  refreshKey,
}: {
  loadSlots: (isoDate: string) => Promise<FreeSlot[]>;
  value: string; // ISO لحظه‌ی انتخاب‌شده یا ""
  onChange: (startAtIso: string) => void;
  /** تغییر این مقدار (مثلاً کارشناس/خدمت) فهرست را دوباره می‌گیرد */
  refreshKey?: string;
}) {
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<FreeSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    loadSlots(date)
      .then((s) => {
        if (!cancelled) {
          setSlots(s);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSlots([]);
          setError("دریافت وقت‌های آزاد ناموفق بود");
        }
      });
    return () => {
      cancelled = true;
    };
    // loadSlots هر رندر تازه ساخته می‌شود؛ فقط روز/کلید تازه‌سازی مهم است
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, refreshKey]);

  return (
    <div className="flex flex-col gap-3">
      <JalaliDateInput
        value={date}
        onChange={(d) => {
          setDate(d);
          setSlots(null);
          onChange("");
        }}
        placeholder="ابتدا روز را انتخاب کنید"
        className="w-full text-[13.5px] outline-none bg-white border-2 border-border focus:border-primary rounded-xl px-3.5 py-3"
      />
      {date && slots === null && <div className="text-[12.5px] text-muted">در حال دریافت وقت‌های آزاد...</div>}
      {error && <div className="text-[12.5px] text-danger">{error}</div>}
      {date && slots !== null && slots.length === 0 && !error && (
        <div className="text-[12.5px] text-warning bg-warning-soft rounded-xl p-3">در این روز وقت آزادی وجود ندارد؛ روز دیگری را انتخاب کنید.</div>
      )}
      {slots && slots.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {slots.map((s) => {
            const active = value === s.startAt;
            return (
              <button
                key={s.startAt}
                type="button"
                onClick={() => onChange(s.startAt)}
                className={`py-2.5 rounded-xl text-[13px] font-bold border-2 cursor-pointer ${active ? "bg-primary text-white border-primary" : "bg-white border-border hover:border-primary"}`}
              >
                {toPersianDigits(s.time)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
