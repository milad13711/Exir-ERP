"use client";

import { useState } from "react";
import type { AudienceFilter, CrmFunnelStage } from "@/lib/api";

const inputClass =
  "w-full text-[12.5px] outline-none placeholder:text-muted bg-white border border-border rounded-lg px-3 py-2 focus:border-primary transition-colors";

const FUNNEL_STAGE_LABELS: Record<CrmFunnelStage, string> = {
  NEW_LEAD: "سرنخ جدید",
  CONTACTED: "در تماس",
  QUALIFIED: "واجد شرایط",
  CUSTOMER: "مشتری",
  REPEAT_CUSTOMER: "خرید تکراری",
  BRAND_AMBASSADOR: "سفیر برند",
  CHURN_RISK: "در معرض ریزش",
  CHURNED: "غیرفعال شده",
};

type ConditionKey = keyof AudienceFilter;

const CONDITION_LABELS: Record<ConditionKey, string> = {
  funnelStages: "مرحله‌ی قیف",
  minPurchaseCount: "حداقل تعداد خرید",
  isBrandAmbassador: "سفیر برند باشد",
  source: "منبع آشنایی شامل",
  minDaysSinceLastPurchase: "حداقل روز از آخرین خرید",
  maxDaysSinceLastPurchase: "حداکثر روز از آخرین خرید",
  frequentBuyerMaxGapDays: "مشتری منظم (حداکثر فاصله‌ی خرید — روز)",
  dueForRepurchase: "موعد خرید مجدد الان است",
  purchasedProductContains: "خریدار محصولی با نام",
};

const CONDITION_ORDER: ConditionKey[] = [
  "funnelStages",
  "isBrandAmbassador",
  "minPurchaseCount",
  "minDaysSinceLastPurchase",
  "maxDaysSinceLastPurchase",
  "frequentBuyerMaxGapDays",
  "dueForRepurchase",
  "purchasedProductContains",
  "source",
];

function isActive(filter: AudienceFilter, key: ConditionKey): boolean {
  return filter[key] !== undefined;
}

export function AudienceFilterBuilder({ value, onChange }: { value: AudienceFilter; onChange: (f: AudienceFilter) => void }) {
  const [addingKey, setAddingKey] = useState("");
  const activeKeys = CONDITION_ORDER.filter((k) => isActive(value, k));
  const availableKeys = CONDITION_ORDER.filter((k) => !isActive(value, k));

  function setField<K extends ConditionKey>(key: K, val: AudienceFilter[K]) {
    onChange({ ...value, [key]: val });
  }

  function removeField(key: ConditionKey) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }

  function addCondition(key: ConditionKey) {
    const defaults: AudienceFilter = {
      funnelStages: [],
      minPurchaseCount: 1,
      isBrandAmbassador: true,
      source: "",
      minDaysSinceLastPurchase: 30,
      maxDaysSinceLastPurchase: 90,
      frequentBuyerMaxGapDays: 35,
      dueForRepurchase: true,
      purchasedProductContains: "",
    };
    setField(key, defaults[key] as never);
    setAddingKey("");
  }

  return (
    <div className="flex flex-col gap-2">
      {activeKeys.length === 0 && <div className="text-[11.5px] text-muted bg-slate-50 rounded-lg px-3 py-2.5">بدون شرط — همه‌ی مخاطبین</div>}

      {activeKeys.map((key) => (
        <div key={key} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2">
          <span className="text-[11.5px] font-bold text-ink-soft shrink-0 min-w-[150px]">{CONDITION_LABELS[key]}</span>

          {key === "funnelStages" && (
            <div className="flex flex-wrap gap-1.5 flex-1">
              {(Object.keys(FUNNEL_STAGE_LABELS) as CrmFunnelStage[]).map((s) => {
                const selected = (value.funnelStages ?? []).includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      const cur = value.funnelStages ?? [];
                      setField("funnelStages", selected ? cur.filter((x) => x !== s) : [...cur, s]);
                    }}
                    className={`text-[11px] font-bold px-2 py-1 rounded-md cursor-pointer ${selected ? "bg-primary text-white" : "bg-white border border-border text-ink-soft"}`}
                  >
                    {FUNNEL_STAGE_LABELS[s]}
                  </button>
                );
              })}
            </div>
          )}

          {(key === "minPurchaseCount" || key === "minDaysSinceLastPurchase" || key === "maxDaysSinceLastPurchase" || key === "frequentBuyerMaxGapDays") && (
            <input
              value={String(value[key] ?? "")}
              onChange={(e) => setField(key, (e.target.value.replace(/[^0-9]/g, "") ? Number(e.target.value.replace(/[^0-9]/g, "")) : 0) as never)}
              inputMode="numeric"
              className={`${inputClass} flex-1 max-w-[100px]`}
            />
          )}

          {(key === "source" || key === "purchasedProductContains") && (
            <input value={String(value[key] ?? "")} onChange={(e) => setField(key, e.target.value as never)} className={`${inputClass} flex-1`} />
          )}

          {(key === "isBrandAmbassador" || key === "dueForRepurchase") && <span className="text-[11.5px] text-muted flex-1">فعال</span>}

          <button type="button" onClick={() => removeField(key)} className="text-danger text-[12px] font-bold cursor-pointer shrink-0">
            حذف
          </button>
        </div>
      ))}

      {availableKeys.length > 0 && (
        <div className="flex items-center gap-2">
          <select value={addingKey} onChange={(e) => setAddingKey(e.target.value)} className={`${inputClass} flex-1`}>
            <option value="">افزودن شرط...</option>
            {availableKeys.map((k) => (
              <option key={k} value={k}>
                {CONDITION_LABELS[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!addingKey}
            onClick={() => addCondition(addingKey as ConditionKey)}
            className="text-[12px] font-bold px-3 py-2 rounded-lg bg-primary-soft text-primary cursor-pointer disabled:opacity-40"
          >
            افزودن
          </button>
        </div>
      )}
    </div>
  );
}
