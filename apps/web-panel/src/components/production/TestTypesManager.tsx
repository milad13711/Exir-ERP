"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { MasterDeleteDialog } from "@/components/production/MasterDeleteDialog";
import { useModuleCan } from "@/hooks/useModuleCan";
import {
  fetchTestTypes,
  updateTestType,
  archiveTestType,
  restoreTestType,
  deleteTestType,
  ApiError,
  type QualityTestType,
} from "@/lib/api";

const input = "min-h-10 text-[16px] sm:text-[12.5px] bg-surface border border-border rounded-lg px-2.5 outline-none focus:border-primary";
const btn = "min-h-10 px-3 rounded-lg text-[11.5px] font-bold cursor-pointer disabled:opacity-50";

/** مدیریت کامل انواع آزمون: ویرایش، بایگانی/بازیابی، حذف (فقط بی‌سابقه). */
export function TestTypesManager({ onChanged }: { onChanged: () => void }) {
  const can = useModuleCan("quality-control");
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [rows, setRows] = useState<QualityTestType[] | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", unit: "", min: "", max: "" });
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState<QualityTestType | null>(null);

  function reload() {
    fetchTestTypes(filter).then(setRows).catch(() => setRows([]));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [filter]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "عملیات ناموفق بود");
    }
  }

  return (
    <div className="mt-3 bg-slate-50 border border-border rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[12px] font-bold flex-1">مدیریت انواع آزمون</div>
        {(["active", "archived"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`${btn} ${filter === f ? "bg-primary text-white" : "bg-surface border border-border text-ink-soft"}`}>
            {f === "active" ? "فعال" : "بایگانی"}
          </button>
        ))}
      </div>
      {error ? <div className="text-[11.5px] text-danger mb-2">{error}</div> : null}
      {rows === null ? (
        <div className="text-muted text-[12px] py-2">در حال بارگذاری...</div>
      ) : rows.length === 0 ? (
        <div className="text-muted text-[12px] py-2">موردی نیست</div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((t) =>
            editId === t.id ? (
              <div key={t.id} className="flex items-center gap-2 flex-wrap">
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${input} flex-1 min-w-[120px]`} />
                <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} className={`${input} w-20`} dir="ltr" />
                <input value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} placeholder="حداقل" className={`${input} w-24`} dir="ltr" inputMode="decimal" />
                <input value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} placeholder="حداکثر" className={`${input} w-24`} dir="ltr" inputMode="decimal" />
                <button
                  className={`${btn} bg-primary text-white`}
                  onClick={() =>
                    run(async () => {
                      await updateTestType(t.id, {
                        name: draft.name.trim(),
                        unit: draft.unit.trim(),
                        acceptableMin: draft.min === "" ? null : Number(draft.min),
                        acceptableMax: draft.max === "" ? null : Number(draft.max),
                      });
                      setEditId(null);
                    })
                  }
                >
                  ذخیره
                </button>
                <button className={`${btn} bg-slate-100 text-ink-soft`} onClick={() => setEditId(null)}>
                  انصراف
                </button>
              </div>
            ) : (
              <div key={t.id} className="flex items-center gap-2 flex-wrap">
                <div className="flex-1 min-w-[120px] text-[12.5px] font-semibold">
                  {t.name} <span className="text-muted font-normal">({t.unit}{t.acceptableMin != null || t.acceptableMax != null ? ` — ${t.acceptableMin ?? "…"} تا ${t.acceptableMax ?? "…"}` : ""})</span>
                  {(t.usageCount ?? 0) > 0 ? <span className="ms-2"><Badge tone="neutral">{(t.usageCount ?? 0).toLocaleString("fa-IR")} نتیجه</Badge></span> : null}
                </div>
                {can.canEdit ? (
                  <button
                    className={`${btn} bg-primary-soft text-primary`}
                    onClick={() => {
                      setEditId(t.id);
                      setDraft({ name: t.name, unit: t.unit, min: t.acceptableMin ?? "", max: t.acceptableMax ?? "" });
                    }}
                  >
                    ویرایش
                  </button>
                ) : null}
                {filter === "archived" && can.canEdit ? (
                  <button className={`${btn} bg-success-soft text-success`} onClick={() => run(() => restoreTestType(t.id))}>
                    بازیابی
                  </button>
                ) : null}
                {can.canDelete || can.canEdit ? (
                  <button className={`${btn} bg-danger-soft text-danger`} onClick={() => setDel(t)}>
                    حذف
                  </button>
                ) : null}
              </div>
            ),
          )}
        </div>
      )}
      {del ? (
        <MasterDeleteDialog
          title={del.name}
          usageCount={del.usageCount ?? 0}
          usageNoun="نتیجه‌ی آزمایش"
          canDelete={can.canDelete}
          onDelete={() => deleteTestType(del.id)}
          onArchive={() => archiveTestType(del.id)}
          onClose={() => setDel(null)}
          onDone={() => {
            reload();
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
