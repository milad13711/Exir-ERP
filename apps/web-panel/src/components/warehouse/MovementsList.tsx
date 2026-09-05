import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime, formatNumber } from "@/lib/persian";
import { fetchStockMovements, type StockMovementRecord } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { NewShipmentModal } from "@/components/fleet/NewShipmentModal";

const TYPE_LABELS: Record<string, string> = {
  RECEIPT: "رسید ورودی",
  ISSUE: "حواله خروجی",
  ADJUSTMENT: "اصلاح موجودی",
  SALES_RETURN: "مرجوعی فروش",
  PURCHASE_RETURN: "مرجوعی خرید",
  TRANSFER_OUT: "انتقال (خروج)",
  TRANSFER_IN: "انتقال (ورود)",
  PRODUCTION_CONSUME: "مصرف تولید",
};
const TYPE_TONES: Record<string, "primary" | "success" | "warning" | "neutral" | "danger"> = {
  RECEIPT: "success",
  ISSUE: "warning",
  ADJUSTMENT: "neutral",
  SALES_RETURN: "primary",
  PURCHASE_RETURN: "danger",
  TRANSFER_OUT: "neutral",
  TRANSFER_IN: "neutral",
  PRODUCTION_CONSUME: "neutral",
};

type TypeFilter = "همه" | "ISSUE" | "RECEIPT" | "ADJUSTMENT";

export function MovementsList() {
  const [movements, setMovements] = useState<StockMovementRecord[] | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("همه");
  const [shipmentPrefillFor, setShipmentPrefillFor] = useState<StockMovementRecord | null>(null);
  const { installedModules } = useWorkspace();

  function reload(type?: string) {
    fetchStockMovements(type ? { type } : {}).then(setMovements).catch(() => setMovements([]));
  }
  useEffect(() => reload(typeFilter === "همه" ? undefined : typeFilter), [typeFilter]);

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {(["همه", "ISSUE", "RECEIPT", "ADJUSTMENT"] as TypeFilter[]).map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={clsx(
              "text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border transition-colors",
              typeFilter === t ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft",
            )}
          >
            {t === "همه" ? "همه" : TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <Card className="p-2">
        {movements === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : movements.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">حواله‌ای یافت نشد</div>
        ) : (
          movements.map((m, i) => (
            <div
              key={m.id}
              className={clsx(
                "flex items-center gap-3 px-4 py-3.5 flex-wrap",
                i < movements.length - 1 && "border-b border-border",
              )}
            >
              <Badge tone={TYPE_TONES[m.type] ?? "neutral"}>{TYPE_LABELS[m.type] ?? m.type}</Badge>
              <div className="flex-1 min-w-[160px]">
                <div className="text-[13px] font-bold">{m.product.name}</div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {m.warehouse.name}
                  {m.reference ? ` · ${m.reference}` : ""}
                </div>
              </div>
              <div className="text-[13px] font-extrabold w-[110px] text-left shrink-0">
                {m.quantityDelta > 0 ? "+" : ""}
                {formatNumber(m.quantityDelta)} <span className="text-[11px] font-normal text-muted">{m.product.unit}</span>
              </div>
              <div className="text-[11.5px] text-muted w-[150px] text-left shrink-0 hidden sm:block">
                {formatJalaliDateTime(m.createdAt)}
              </div>
              {m.type === "ISSUE" && installedModules.has("fleet") ? (
                <button
                  onClick={() => setShipmentPrefillFor(m)}
                  className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg cursor-pointer shrink-0"
                >
                  ثبت بار برای این حواله
                </button>
              ) : null}
            </div>
          ))
        )}
      </Card>

      {shipmentPrefillFor ? (
        <NewShipmentModal
          onClose={() => setShipmentPrefillFor(null)}
          onCreated={() => setShipmentPrefillFor(null)}
          prefill={{
            cargoType: shipmentPrefillFor.product.name,
            quantity: Math.abs(shipmentPrefillFor.quantityDelta),
            sourceType: "STOCK_MOVEMENT",
            sourceStockMovementId: shipmentPrefillFor.id,
          }}
        />
      ) : null}
    </div>
  );
}
