"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { dismissDispatchSource, fetchSourceStatus, setProductionTrigger, type DispatchSourceType, type SourceStatus } from "@/lib/dispatch-api";
import { toPersianDigits } from "@/lib/persian";
import { DeclareShipmentModal } from "./DeclareShipmentModal";
import { BTN_PRIMARY, BTN_SOFT, INPUT, errText } from "./dispatch-ui";

type Src = Exclude<DispatchSourceType, "MANUAL">;

/**
 * پیشنهاد/دکمه‌ی «اعلام بار» روی دستور تولید، فاکتور (پیش‌نویس هم) و حواله خروج — فقط وقتی ماژول dispatch نصب است
 * (فراخواننده با installedModules.has("dispatch") کنترل می‌کند). ضدتکرار: اگر بار فعالی وجود دارد فقط لینکش را نشان می‌دهد.
 */
export function SourceDispatch({
  sourceType,
  sourceId,
  compact = false,
  label = "اعلام بار",
  onCreated,
}: {
  sourceType: Src;
  sourceId: string;
  compact?: boolean;
  label?: string;
  onCreated?: () => void;
}) {
  const [st, setSt] = useState<SourceStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [n, setN] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchSourceStatus(sourceType, sourceId)
      .then((r) => {
        setSt(r);
        setN(r.production?.override != null ? String(r.production.override) : "");
      })
      .catch(() => setSt(null));
  }, [sourceType, sourceId]);
  useEffect(load, [load]);

  if (!st) return null;

  if (st.existing) {
    return (
      <Link href={`/dispatch/${st.existing.id}`} className={compact ? "text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg shrink-0" : "block w-full text-center py-2.5 rounded-xl bg-primary-soft text-primary text-[13px] font-bold"}>
        بار #{toPersianDigits(st.existing.shipmentNo ?? 0)} در اعلام بار ←
      </Link>
    );
  }

  const modal = open ? (
    <DeclareShipmentModal
      source={{ type: sourceType, id: sourceId }}
      onClose={() => {
        setOpen(false);
        load();
      }}
      onCreated={onCreated}
    />
  ) : null;

  if (compact) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg cursor-pointer shrink-0">
          {label}
        </button>
        {modal}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {st.suggested ? (
        <div className="flex items-center gap-2 bg-warning-soft rounded-xl px-3 py-2.5 text-[12.5px]">
          <Badge tone="warning">پیشنهاد</Badge>
          <span className="flex-1">
            {sourceType === "PRODUCTION_ORDER" ? "این دستور تولید به مرحله‌ی تعیین‌شده برای فراخوان راننده رسیده است." : "برای این مورد هنوز بار اعلام نشده است."}
          </span>
        </div>
      ) : null}
      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={() => setOpen(true)} className={`${BTN_PRIMARY} flex-1`}>
          {label}
        </button>
        {st.suggested ? (
          <button type="button" onClick={() => dismissDispatchSource(sourceType, sourceId).then(load)} className={BTN_SOFT}>
            فعلاً نه
          </button>
        ) : null}
      </div>
      {sourceType === "PRODUCTION_ORDER" && st.production ? (
        <div className="bg-slate-50 border border-border rounded-xl p-3 text-[12px] flex flex-col gap-2">
          <div>
            ماشه‌ی اعلام بار: <b>{st.production.enabled ? `${toPersianDigits(st.production.stagesBeforeEnd)} مرحله مانده به پایان` : "غیرفعال در تنظیمات"}</b>{" "}
            <span className="text-muted">(پیشرفت: {toPersianDigits(st.production.doneStages)} از {toPersianDigits(st.production.totalStages)} مرحله — ۰ یعنی آخرین مرحله)</span>
          </div>
          <div className="flex gap-2 items-center">
            <input value={n} onChange={(e) => setN(e.target.value.replace(/[^\d]/g, ""))} placeholder={`پیش‌فرض: ${toPersianDigits(st.production.tenantDefault)}`} dir="ltr" className={`${INPUT} !w-24`} />
            <button
              type="button"
              className={BTN_SOFT}
              onClick={() => setProductionTrigger(sourceId, n === "" ? null : Number(n)).then((r) => { setSt(r); setErr(null); }).catch((e) => setErr(errText(e)))}
            >
              ذخیره برای همین دستور
            </button>
          </div>
          {err ? <div className="text-danger">{err}</div> : null}
        </div>
      ) : null}
      {modal}
    </div>
  );
}
