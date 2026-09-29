"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import clsx from "clsx";
import Link from "next/link";
import { toJalali, toGregorian, toPersianDigits, JALALI_MONTHS, WEEKDAYS_SHORT_FA } from "@/lib/persian";
import {
  fetchDashboardCalendar,
  createDashboardReminder,
  deleteDashboardReminder,
  type DashboardCalendarDay,
  type DashboardCalendarEvent,
  type DashboardCalendarEventType,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import {
  CakeIcon,
  TasksIcon,
  BriefcaseIcon,
  ChatIcon,
  BillingIcon,
  CurrencyIcon,
  DocsIcon,
  FlagIcon,
  TrashIcon,
  PlusIcon,
} from "@/components/icons";

// جمعه = آخر هفته؛ هفته‌ی فارسی از شنبه شروع می‌شود. Date.getDay(): 0=یکشنبه..6=شنبه.
const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5]; // شنبه..جمعه به ترتیب اندیس getDay()

const EVENT_META: Record<DashboardCalendarEventType, { label: string; icon: (p: { className?: string }) => ReactElement }> = {
  "birthday-employee": { label: "تولد پرسنل", icon: CakeIcon },
  "birthday-contact": { label: "تولد مشتری", icon: CakeIcon },
  task: { label: "وظیفه", icon: TasksIcon },
  interview: { label: "مصاحبه", icon: BriefcaseIcon },
  "mentoring-session": { label: "جلسه‌ی مشاوره", icon: ChatIcon },
  "invoice-due": { label: "سررسید فاکتور", icon: BillingIcon },
  "check-due": { label: "سررسید چک", icon: CurrencyIcon },
  "contract-end": { label: "پایان قرارداد", icon: DocsIcon },
  reminder: { label: "یادآوری", icon: FlagIcon },
};

/** تقویم ماهانه‌ی شمسی روی داشبورد — تولد/وظیفه/مصاحبه/جلسه/سررسید فاکتور و چک/پایان قرارداد + یادآوری‌های دستی. */
export function DashboardCalendar() {
  const today = new Date();
  const todayJalali = toJalali(today);

  const [viewYear, setViewYear] = useState(todayJalali.year);
  const [viewMonth, setViewMonth] = useState(todayJalali.month);
  const [selectedDay, setSelectedDay] = useState<number>(todayJalali.day);
  const [data, setData] = useState<{ monthLength: number; days: DashboardCalendarDay[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  function load(year: number, month: number) {
    setLoading(true);
    fetchDashboardCalendar(year, month)
      .then((res) => setData({ monthLength: res.monthLength, days: res.days }))
      .catch(() => setData({ monthLength: 0, days: [] }))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(viewYear, viewMonth);
  }, [viewYear, viewMonth]);

  const isCurrentMonth = viewYear === todayJalali.year && viewMonth === todayJalali.month;

  function goPrevMonth() {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
    setSelectedDay(1);
  }
  function goNextMonth() {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
    setSelectedDay(1);
  }
  function goToday() {
    setViewYear(todayJalali.year);
    setViewMonth(todayJalali.month);
    setSelectedDay(todayJalali.day);
  }

  const monthLength = data?.monthLength ?? 0;
  const dayByNumber = useMemo(() => {
    const map = new Map<number, DashboardCalendarDay>();
    (data?.days ?? []).forEach((d) => map.set(d.day, d));
    return map;
  }, [data]);

  const firstOfMonthGregorian = useMemo(() => {
    // فقط برای محاسبه‌ی روز هفته‌ی شروع ماه — از همان الگوریتم toGregorian در persian.ts استفاده می‌شود.
    return firstWeekdayOfJalaliMonth(viewYear, viewMonth);
  }, [viewYear, viewMonth]);
  const firstWeekdayIndex = WEEKDAY_ORDER.indexOf(firstOfMonthGregorian);
  const cells: (number | null)[] = [
    ...Array(firstWeekdayIndex).fill(null),
    ...Array.from({ length: monthLength }, (_, i) => i + 1),
  ];

  const selected = dayByNumber.get(selectedDay);

  function refreshAndSelect(day: number) {
    load(viewYear, viewMonth);
    setSelectedDay(day);
  }

  async function handleDeleteReminder(id: string) {
    await deleteDashboardReminder(id);
    load(viewYear, viewMonth);
  }

  return (
    <Card className="p-4 sm:p-5 mb-5">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <span className="text-[14.5px] font-bold">تقویم رویدادها</span>
        {!isCurrentMonth ? (
          <button
            type="button"
            onClick={goToday}
            className="text-[11.5px] font-bold text-primary cursor-pointer shrink-0"
          >
            برو به امروز
          </button>
        ) : null}
      </div>

      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={goPrevMonth}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-soft hover:bg-slate-100 cursor-pointer shrink-0"
          aria-label="ماه قبل"
        >
          ‹
        </button>
        <div className="text-[13.5px] font-bold">
          {JALALI_MONTHS[viewMonth - 1]} {toPersianDigits(viewYear)}
        </div>
        <button
          type="button"
          onClick={goNextMonth}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-soft hover:bg-slate-100 cursor-pointer shrink-0"
          aria-label="ماه بعد"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_ORDER.map((idx) => WEEKDAYS_SHORT_FA[idx]).map((w, i) => (
          <div key={i} className="text-center text-[10.5px] text-muted font-bold py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {cells.map((day, i) => {
          if (day == null) return <div key={i} />;
          const info = dayByNumber.get(day);
          const isToday = isCurrentMonth && todayJalali.day === day;
          const isSelected = selectedDay === day;
          const isFriday = info?.isFriday ?? false;
          const isHoliday = info?.isHoliday ?? false;
          const hasBirthday = info?.hasBirthday ?? false;
          const eventCount = info?.events.length ?? 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelectedDay(day)}
              className={clsx(
                "relative aspect-square sm:h-11 sm:aspect-auto rounded-lg text-[11.5px] sm:text-[12px] font-bold cursor-pointer flex flex-col items-center justify-center gap-0.5 transition-colors",
                isSelected
                  ? "bg-primary text-white"
                  : isToday
                    ? "ring-1 ring-inset ring-primary text-primary hover:bg-slate-100"
                    : isHoliday || isFriday
                      ? "text-danger hover:bg-slate-100"
                      : "text-ink hover:bg-slate-100",
                hasBirthday && !isSelected && "bg-gradient-to-b from-warning-soft to-transparent",
              )}
              title={info?.holidayName ?? undefined}
            >
              {hasBirthday ? (
                <CakeIcon className={clsx("w-3 h-3 absolute top-0.5 left-0.5", isSelected ? "text-white" : "text-warning")} />
              ) : null}
              <span>{toPersianDigits(day)}</span>
              {eventCount > 0 ? (
                <span
                  className={clsx(
                    "w-1 h-1 rounded-full",
                    isSelected ? "bg-white" : "bg-primary",
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center text-muted text-sm py-4">در حال بارگذاری...</div>
      ) : (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-bold">
              {toPersianDigits(selectedDay)} {JALALI_MONTHS[viewMonth - 1]}
              {selected?.isHoliday && selected.holidayName ? (
                <span className="text-danger font-normal text-[11.5px] mr-2">— {selected.holidayName}</span>
              ) : selected?.isFriday ? (
                <span className="text-danger font-normal text-[11.5px] mr-2">— جمعه</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1 text-[11.5px] font-bold text-primary cursor-pointer"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              افزودن یادآوری
            </button>
          </div>

          {!selected || selected.events.length === 0 ? (
            <div className="text-center text-muted text-sm py-3">رویدادی برای این روز ثبت نشده است</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {selected.events.map((e) => (
                <CalendarEventRow key={`${e.type}-${e.id}`} event={e} onDelete={e.type === "reminder" ? () => handleDeleteReminder(e.id) : undefined} />
              ))}
            </div>
          )}
        </div>
      )}

      {showAddModal ? (
        <AddReminderModal
          jalaliYear={viewYear}
          jalaliMonth={viewMonth}
          day={selectedDay}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            refreshAndSelect(selectedDay);
          }}
        />
      ) : null}
    </Card>
  );
}

function CalendarEventRow({ event, onDelete }: { event: DashboardCalendarEvent; onDelete?: () => void }) {
  const meta = EVENT_META[event.type];
  const Icon = meta.icon;
  const content = (
    <div className="flex items-center gap-2.5 py-2 px-2.5 rounded-xl bg-slate-50">
      <div className="w-7 h-7 rounded-[9px] flex items-center justify-center shrink-0 bg-primary-soft text-primary">
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-bold truncate">{event.title}</div>
        <div className="text-[10.5px] text-muted">{meta.label}</div>
      </div>
      {onDelete ? (
        <button
          type="button"
          onClick={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onDelete();
          }}
          className="w-6.5 h-6.5 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer shrink-0"
          aria-label="حذف یادآوری"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      ) : null}
    </div>
  );
  if (event.link) {
    return (
      <Link href={event.link} className="block">
        {content}
      </Link>
    );
  }
  return content;
}

function AddReminderModal({
  jalaliYear,
  jalaliMonth,
  day,
  onClose,
  onSaved,
}: {
  jalaliYear: number;
  jalaliMonth: number;
  day: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const g = toGregorianIso(jalaliYear, jalaliMonth, day);
      await createDashboardReminder({ date: g, title: trimmed, note: note.trim() || undefined });
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`یادآوری برای ${toPersianDigits(day)} ${JALALI_MONTHS[jalaliMonth - 1]}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-[12px] font-bold text-ink-soft block mb-1.5">عنوان</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            placeholder="مثلاً: تماس با تأمین‌کننده"
            autoFocus
          />
        </div>
        <div>
          <label className="text-[12px] font-bold text-ink-soft block mb-1.5">توضیح (اختیاری)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary resize-none"
          />
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!title.trim() || submitting}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
        >
          ذخیره
        </button>
      </div>
    </Modal>
  );
}

// ── کمک‌تابع‌های محلی: محاسبه‌ی روز هفته‌ی شروع ماه و تبدیل به تاریخ میلادی ISO ──
// همان الگوریتم jalaali استاندارد که در lib/persian.ts پیاده‌سازی و تأیید شده است.

function firstWeekdayOfJalaliMonth(jy: number, jm: number): number {
  return toGregorian(jy, jm, 1).getDay();
}

function toGregorianIso(jy: number, jm: number, jd: number): string {
  const g = toGregorian(jy, jm, jd);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${g.getFullYear()}-${pad(g.getMonth() + 1)}-${pad(g.getDate())}`;
}
