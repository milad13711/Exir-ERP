import { useEffect, useRef, useState } from "react";
import { toJalali, toGregorian, jalaliMonthLength, toPersianDigits, JALALI_MONTHS, WEEKDAYS_SHORT_FA } from "@/lib/persian";
import { CalendarIcon } from "@/components/icons";

/** "YYYY-MM-DDTHH:mm" in local time — matches what native `<input type="datetime-local">` values look like. */
function toIsoLocalString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// جمعه = آخر هفته؛ هفته‌ی فارسی از شنبه شروع می‌شود. Date.getDay(): 0=یکشنبه..6=شنبه.
const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5]; // شنبه..جمعه به ترتیب اندیس getDay()

export function JalaliDateTimeInput({
  value,
  onChange,
  placeholder = "انتخاب تاریخ و ساعت",
  className = "",
}: {
  value: string; // "YYYY-MM-DDTHH:mm" (local time) or ""
  onChange: (isoLocal: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedDate = value ? new Date(value) : null;
  const selectedJalali = selectedDate ? toJalali(selectedDate) : null;

  const [viewYear, setViewYear] = useState(() => (selectedJalali ?? toJalali(new Date())).year);
  const [viewMonth, setViewMonth] = useState(() => (selectedJalali ?? toJalali(new Date())).month);
  const [hour, setHour] = useState(() => (selectedDate ? String(selectedDate.getHours()).padStart(2, "0") : "12"));
  const [minute, setMinute] = useState(() => (selectedDate ? String(selectedDate.getMinutes()).padStart(2, "0") : "00"));
  const [pickedDay, setPickedDay] = useState<number | null>(selectedJalali?.day ?? null);

  // Re-point the calendar/time view at the selected value whenever it changes
  // from outside — the React-recommended "adjust state during render"
  // pattern (not an effect), so it doesn't cause a cascading extra render.
  const [lastSyncedValue, setLastSyncedValue] = useState(value);
  if (value !== lastSyncedValue) {
    setLastSyncedValue(value);
    const jj = selectedJalali ?? toJalali(new Date());
    setViewYear(jj.year);
    setViewMonth(jj.month);
    setPickedDay(selectedJalali?.day ?? null);
    setHour(selectedDate ? String(selectedDate.getHours()).padStart(2, "0") : "12");
    setMinute(selectedDate ? String(selectedDate.getMinutes()).padStart(2, "0") : "00");
  }

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function goPrevMonth() {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }
  function goNextMonth() {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }
  function pickNow() {
    const now = new Date();
    onChange(toIsoLocalString(now));
    setOpen(false);
  }
  function confirm() {
    if (pickedDay == null) return;
    const g = toGregorian(viewYear, viewMonth, pickedDay);
    g.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);
    onChange(toIsoLocalString(g));
    setOpen(false);
  }

  const monthLength = jalaliMonthLength(viewYear, viewMonth);
  const firstOfMonthGregorian = toGregorian(viewYear, viewMonth, 1);
  const firstWeekdayIndex = WEEKDAY_ORDER.indexOf(firstOfMonthGregorian.getDay());
  const cells: (number | null)[] = [...Array(firstWeekdayIndex).fill(null), ...Array.from({ length: monthLength }, (_, i) => i + 1)];

  const label = selectedDate
    ? `${toPersianDigits(`${selectedJalali!.year}/${String(selectedJalali!.month).padStart(2, "0")}/${String(selectedJalali!.day).padStart(2, "0")}`)} ساعت ${toPersianDigits(`${String(selectedDate.getHours()).padStart(2, "0")}:${String(selectedDate.getMinutes()).padStart(2, "0")}`)}`
    : "";

  return (
    <div ref={containerRef} className="relative" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2 text-right cursor-pointer focus:border-primary transition-colors ${className}`}
      >
        <span className={label ? "" : "text-muted"}>{label || placeholder}</span>
        <CalendarIcon className="w-4 h-4 text-muted shrink-0" />
      </button>

      {open ? (
        <div className="absolute z-[60] mt-1.5 right-0 bg-surface border border-border rounded-xl shadow-xl p-3 w-[280px]" dir="rtl">
          {/* راست‌چین: سمت راست = ماه قبل، سمت چپ = ماه بعد (قرارداد تقویم فارسی این پروژه). */}
          <div className="flex items-center justify-between mb-2.5">
            <button
              type="button"
              onClick={goPrevMonth}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-soft hover:bg-slate-100 cursor-pointer"
              aria-label="ماه قبل"
            >
              ‹
            </button>
            <div className="text-[13px] font-bold">
              {JALALI_MONTHS[viewMonth - 1]} {toPersianDigits(viewYear)}
            </div>
            <button
              type="button"
              onClick={goNextMonth}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-soft hover:bg-slate-100 cursor-pointer"
              aria-label="ماه بعد"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS_SHORT_FA.slice().reverse().map((w, i) => (
              <div key={i} className="text-center text-[10.5px] text-muted font-bold py-1">
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              return day == null ? (
                <div key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPickedDay(day)}
                  className={`w-9 h-9 rounded-lg text-[12px] font-bold cursor-pointer ${
                    pickedDay === day ? "bg-primary text-white" : "text-ink hover:bg-slate-100"
                  }`}
                >
                  {toPersianDigits(day)}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
            <span className="text-[11.5px] text-muted">ساعت</span>
            <input
              value={hour}
              onChange={(e) => setHour(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
              dir="ltr"
              className="w-12 text-center text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-1 py-1.5"
              placeholder="۰۰"
            />
            <span className="text-muted">:</span>
            <input
              value={minute}
              onChange={(e) => setMinute(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
              dir="ltr"
              className="w-12 text-center text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-1 py-1.5"
              placeholder="۰۰"
            />
          </div>

          <div className="flex items-center gap-2 mt-2.5">
            <button
              type="button"
              onClick={pickNow}
              className="flex-1 py-2 rounded-lg bg-slate-100 text-ink-soft text-[12px] font-bold cursor-pointer"
            >
              همین الان
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pickedDay == null}
              className="flex-1 py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer disabled:opacity-50"
            >
              تأیید
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
