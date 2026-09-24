"use client";

import type { RefObject } from "react";

export const CONTRACT_PLACEHOLDERS = [
  "شرکت", "نام_طرف_اول", "نام_طرف_دوم",
  "شماره_تماس_طرف_اول", "شماره_تماس_طرف_دوم",
  "شماره_ملی_طرف_اول", "شماره_ملی_طرف_دوم",
  "شماره_ثبت_طرف_اول", "شماره_ثبت_طرف_دوم",
  "آدرس_طرف_اول", "آدرس_طرف_دوم",
  "تاریخ_شروع", "تاریخ_پایان", "مبلغ_قرارداد",
  "عنوان_قرارداد", "تاریخ_امروز",
];

export const RECRUITMENT_PLACEHOLDERS = [
  "نام_متقاضی", "شماره_تماس_متقاضی", "عنوان_شغل", "شرح_وظایف", "نوع_همکاری",
  "ساعت_کاری", "حقوق", "مزایا", "مدت_قرارداد_ماه", "تاریخ_شروع",
];

/** دکمه‌های درج فیلد پویا — با کلیک، {{نام_فیلد}} در محل مکان‌نمای همان کادر متن درج می‌شود. */
export function PlaceholderPalette({
  fields,
  targetRef,
  value,
  onChange,
  label = "درج فیلد پویا:",
}: {
  fields: string[];
  targetRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  function insert(name: string) {
    const token = `{{${name}}}`;
    const el = targetRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      <span className="text-[11px] text-muted">{label}</span>
      {fields.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => insert(f)}
          className="text-[10.5px] font-semibold bg-primary-soft text-primary border border-primary/20 rounded-md px-1.5 py-0.5 cursor-pointer hover:bg-primary hover:text-white transition-colors"
        >
          {f.replace(/_/g, " ")}
        </button>
      ))}
    </div>
  );
}
