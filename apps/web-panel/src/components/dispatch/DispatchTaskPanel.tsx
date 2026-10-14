"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDispatchDetail, type DispatchDetail } from "@/lib/dispatch-api";
import { toPersianDigits } from "@/lib/persian";
import { DispatchDocsBlock, DispatchReadyBlock } from "./ShipmentDispatchDetail";
import { Section, StatusBadge, kgText } from "./dispatch-ui";

/**
 * پنل اقدام اعلام بار داخل جزئیات وظیفه — فقط وقتی relatedModule === "Shipment" و ماژول dispatch نصب است
 * (TaskDetailModal کنترل می‌کند). «آماده حرکت» فقط از همین پنل و صفحه‌ی بار صادر می‌شود؛ در فرم عمومی وظایف نیست.
 */
export function DispatchTaskPanel({ shipmentId }: { shipmentId: string }) {
  const [d, setD] = useState<DispatchDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchDispatchDetail(shipmentId).then(setD).catch(() => setFailed(true));
  }, [shipmentId]);

  if (failed) return null;
  if (!d) return <div className="text-[12px] text-muted">در حال بارگذاری اطلاعات بار...</div>;
  const l = d.shipment.loading;

  return (
    <Section
      title={`بار #${toPersianDigits(d.shipment.shipmentNo)} — ${d.shipment.cargoType}`}
      right={<StatusBadge status={d.shipment.status} />}
      className="!bg-primary-soft/20"
    >
      <div className="flex flex-col gap-3">
        {l ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
            <div>مشتری: <b>{l.customerName ?? "—"}</b></div>
            <div>وزن خالص: <b>{kgText(l.netKg)}</b></div>
            <div>شناسه یکتا: <b>{l.uniqueId ?? "—"}</b></div>
            <div>کد ملی: <b>{l.nationalId ?? "—"}</b></div>
            <div>کد پستی: <b>{l.postalCode ?? "—"}</b></div>
            <div className="col-span-2">آدرس پستی: <b>{l.postalAddress ?? "—"}</b></div>
          </div>
        ) : null}
        <div>
          <div className="text-[12px] font-bold mb-1.5">اسناد (بارنامه، برگ قرنطینه، …)</div>
          <DispatchDocsBlock d={d} onChange={setD} />
        </div>
        <div>
          <div className="text-[12px] font-bold mb-1.5">مجوز آماده حرکت</div>
          <DispatchReadyBlock d={d} onChange={setD} />
        </div>
        {!d.handlerOnly ? (
          <Link href={`/dispatch/${shipmentId}`} className="text-[12px] font-bold text-primary">
            صفحه‌ی کامل بار (چک‌لیست، وزن، تایم‌لاین) ←
          </Link>
        ) : null}
      </div>
    </Section>
  );
}
