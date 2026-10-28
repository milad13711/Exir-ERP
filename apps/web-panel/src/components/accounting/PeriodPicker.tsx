"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { ReasonDialog } from "@/components/ui/ReasonDialog";
import { toJalali, toPersianDigits } from "@/lib/persian";
import { fetchPeriods, lockPeriod, unlockPeriod, type PeriodSel, type PeriodsInfo } from "@/lib/accounting-api";

export function currentMonthKey(): string {
  const j = toJalali(new Date());
  return `${j.year}-${String(j.month).padStart(2, "0")}`;
}

/** برچسب کوتاه انتخاب فعلی (برای عنوان گزارش/چاپ). */
export function selLabel(sel: PeriodSel, info?: PeriodsInfo | null): string {
  if (sel.mode === "month") return info?.months.find((m) => m.key === sel.key)?.label ?? toPersianDigits(sel.key);
  if (sel.mode === "fiscal") return `سال مالی ${toPersianDigits(sel.fiscalYear)}`;
  if (sel.mode === "all") return "کل دوره (تجمیعی)";
  return "بازه‌ی دلخواه";
}

function Arrow({ dir }: { dir: "right" | "left" }) {
  // پیکان با مسیر صریح (نه نویسه‌ی یونیکد) تا آینه‌شدن دوسویه (bidi) جهت را عوض نکند
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === "right" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
    </svg>
  );
}

const MODES: Array<[PeriodSel["mode"], string]> = [
  ["month", "ماه"],
  ["fiscal", "سال مالی"],
  ["all", "تجمیعی"],
  ["custom", "بازه‌ی دلخواه"],
];

/**
 * انتخاب‌گر دوره‌ی گزارش: شبکه‌ی ماه‌های سال مالی، کلید «سال مالی»، «تجمیعی» و بازه‌ی دلخواه. ماه قفل‌شده نشان «بسته» دارد؛
 * مالک/مدیر می‌تواند ماه انتخاب‌شده را ببندد یا قفلش را باز کند.
 */
export function PeriodPicker({
  value,
  onChange,
  allowedModes = ["month", "fiscal", "all", "custom"],
  canManage = false,
  className,
}: {
  value: PeriodSel;
  onChange: (sel: PeriodSel) => void;
  allowedModes?: Array<PeriodSel["mode"]>;
  canManage?: boolean;
  className?: string;
}) {
  const [fy, setFy] = useState<number | null>(null);
  const [info, setInfo] = useState<PeriodsInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<"lock" | "unlock" | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchPeriods(fy ?? undefined)
      .then((r) => {
        if (!alive) return;
        setFailed(false);
        setInfo(r);
        if (fy === null) setFy(r.fiscalYear);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [fy, reload]);

  const selected = value.mode === "month" ? info?.months.find((m) => m.key === value.key) : undefined;
  const shownFy = fy ?? info?.fiscalYear ?? null;

  return (
    <div className={clsx("bg-surface border border-border rounded-2xl p-3.5 print:hidden", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1" role="tablist" aria-label="نوع بازه">
          {MODES.filter(([m]) => allowedModes.includes(m)).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={value.mode === m}
              onClick={() => {
                if (m === "month") onChange({ mode: "month", key: currentMonthKey() });
                else if (m === "fiscal") onChange({ mode: "fiscal", fiscalYear: info?.currentFiscalYear ?? shownFy ?? toJalali(new Date()).year });
                else if (m === "all") onChange({ mode: "all" });
                else onChange({ mode: "custom", from: "", to: "" });
              }}
              className={clsx("min-h-[36px] px-3 rounded-lg text-[12.5px] font-bold cursor-pointer", value.mode === m ? "bg-primary text-white" : "text-ink-soft")}
            >
              {label}
            </button>
          ))}
        </div>

        {(value.mode === "month" || value.mode === "fiscal") && shownFy ? (
          <div className="flex items-center gap-1 me-auto">
            <button
              type="button"
              aria-label="سال مالی قبل"
              onClick={() => {
                const next = shownFy - 1;
                setFy(next);
                if (value.mode === "fiscal") onChange({ mode: "fiscal", fiscalYear: next });
              }}
              className="w-10 h-10 rounded-xl border border-border flex items-center justify-center text-ink-soft cursor-pointer"
            >
              <Arrow dir="right" />
            </button>
            <span className="min-w-[96px] text-center text-[13px] font-extrabold">سال مالی {toPersianDigits(shownFy)}</span>
            <button
              type="button"
              aria-label="سال مالی بعد"
              onClick={() => {
                const next = shownFy + 1;
                setFy(next);
                if (value.mode === "fiscal") onChange({ mode: "fiscal", fiscalYear: next });
              }}
              className="w-10 h-10 rounded-xl border border-border flex items-center justify-center text-ink-soft cursor-pointer"
            >
              <Arrow dir="left" />
            </button>
          </div>
        ) : null}
      </div>

      {value.mode === "month" ? (
        failed ? (
          <div className="mt-3 text-[12px] text-danger">بارگذاری ماه‌ها ناموفق بود.</div>
        ) : !info ? (
          <div className="mt-3 text-[12px] text-muted">در حال بارگذاری ماه‌ها...</div>
        ) : (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {info.months.map((m) => {
              const active = value.key === m.key;
              const isCurrent = m.key === info.currentKey;
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ mode: "month", key: m.key })}
                  className={clsx(
                    "min-h-[44px] rounded-xl border px-2 py-1.5 text-[12.5px] font-bold cursor-pointer flex flex-col items-center justify-center leading-tight",
                    active ? "bg-primary text-white border-primary" : "bg-slate-50 border-border text-ink-soft hover:border-primary",
                  )}
                >
                  <span>{m.label.split(" ")[0]}</span>
                  {m.locked ? <span className={clsx("text-[10px] font-semibold", active ? "text-white/90" : "text-warning")}>بسته</span> : isCurrent ? <span className={clsx("text-[10px] font-semibold", active ? "text-white/90" : "text-success")}>جاری</span> : null}
                </button>
              );
            })}
          </div>
        )
      ) : null}

      {value.mode === "custom" ? (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">از تاریخ</label>
            <JalaliDateInput value={value.from} onChange={(from) => onChange({ ...value, from })} />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">تا تاریخ (همان روز هم شمرده می‌شود)</label>
            <JalaliDateInput value={value.to} onChange={(to) => onChange({ ...value, to })} />
          </div>
        </div>
      ) : null}

      {value.mode === "fiscal" ? <p className="mt-2.5 text-[12px] text-muted">گزارش کل سال مالی (۱۲ ماه) — درآمد و هزینه‌ها از ابتدای سال مالی جمع می‌شوند.</p> : null}
      {value.mode === "all" ? <p className="mt-2.5 text-[12px] text-muted">جمع تجمیعی از ابتدای ثبت اسناد تا امروز، بدون تفکیک ماه.</p> : null}

      {value.mode === "month" && selected && canManage ? (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {selected.locked ? (
            <>
              <span className="text-[12px] text-warning font-semibold">این ماه بسته است؛ سندی با تاریخ این ماه ثبت، ویرایش یا ابطال نمی‌شود.</span>
              <button type="button" onClick={() => setDialog("unlock")} className="min-h-[36px] px-3 rounded-lg text-[12px] font-bold bg-warning-soft text-warning cursor-pointer">
                باز کردن قفل ماه
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setDialog("lock")} className="min-h-[36px] px-3 rounded-lg text-[12px] font-bold bg-slate-100 text-ink-soft cursor-pointer">
              بستن ماه
            </button>
          )}
        </div>
      ) : null}

      {dialog === "lock" && selected ? (
        <ReasonDialog
          title={`بستن ${selected.label}`}
          description="پس از بستن، هیچ سندی با تاریخ این ماه ثبت، ویرایش یا ابطال نمی‌شود (فاکتور، دریافت/پرداخت و ... هم همین‌طور). هر زمان مدیر می‌تواند قفل را باز کند و این کار در گزارش فعالیت ثبت می‌شود."
          confirmLabel="بستن ماه"
          tone="primary"
          minLength={0}
          onConfirm={async (note) => {
            await lockPeriod(selected.key, note || undefined);
            setReload((n) => n + 1);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "unlock" && selected ? (
        <ReasonDialog
          title={`باز کردن قفل ${selected.label}`}
          description="با باز کردن قفل، تغییر اسناد این ماه دوباره ممکن می‌شود. دلیل شما در گزارش فعالیت ثبت می‌شود."
          confirmLabel="باز کردن قفل"
          onConfirm={async (reason) => {
            await unlockPeriod(selected.key, reason);
            setReload((n) => n + 1);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
