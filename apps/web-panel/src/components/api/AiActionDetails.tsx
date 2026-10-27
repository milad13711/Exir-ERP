"use client";

import { useEffect, useState } from "react";
import { fetchAiActionCurrent, type AiActionRequest } from "@/lib/api";
import { FREE_TEXT_FIELDS, fieldLabel, formatValue } from "./ai-action-fields";

/** جدول فیلد/مقدار آرگومان‌های اعتبارسنجی‌شده؛ متن آزاد ایجنت جدا و برچسب‌دار؛ برای ویرایش، مقدار فعلی کنار پیشنهادی. */
export function AiActionDetails({ action }: { action: AiActionRequest }) {
  const [current, setCurrent] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (action.operationType !== "UPDATE") return;
    fetchAiActionCurrent(action.id).then(setCurrent).catch(() => setCurrent(null));
  }, [action.id, action.operationType]);

  const entries = Object.entries(action.arguments ?? {});
  const structured = entries.filter(([k]) => !FREE_TEXT_FIELDS.has(k));
  const free = entries.filter(([k]) => FREE_TEXT_FIELDS.has(k));

  return (
    <div className="mt-2.5 flex flex-col gap-2.5">
      <div className="text-[10.5px] text-muted">ابزار: <code dir="ltr">{action.toolName}</code></div>
      {current ? (
        <div className="rounded-lg bg-slate-50 border border-border p-2.5">
          <div className="text-[11px] font-bold mb-1">مقدار فعلی در سامانه</div>
          {Object.entries(current).map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[11.5px]">
              <span className="text-muted w-28 shrink-0">{fieldLabel(k)}</span>
              <span className="break-all">{formatValue(v)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="bg-slate-50 px-2.5 py-1.5 text-[11px] font-bold">آنچه ثبت خواهد شد (فیلدهای اعتبارسنجی‌شده)</div>
        {structured.map(([k, v]) => (
          <div key={k} className="flex gap-2 px-2.5 py-1.5 text-[11.5px] border-t border-border">
            <span className="text-muted w-28 shrink-0">{fieldLabel(k)}</span>
            <span className="break-all whitespace-pre-wrap">{formatValue(v)}</span>
          </div>
        ))}
      </div>
      {free.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning-soft/40 p-2.5">
          <div className="text-[11px] font-bold text-warning mb-1">توضیح ایجنت (تأییدنشده)</div>
          {free.map(([k, v]) => (
            <div key={k} className="text-[11.5px] mb-1 whitespace-pre-wrap break-words">
              <span className="text-muted">{fieldLabel(k)}: </span>
              {formatValue(v)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
