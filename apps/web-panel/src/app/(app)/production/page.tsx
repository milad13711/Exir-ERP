"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PlusIcon, FactoryIcon } from "@/components/icons";
import { formatJalaliDate, formatNumber } from "@/lib/persian";
import {
  fetchProductionOrders,
  fetchBoms,
  fetchWorkCenters,
  type ProductionOrder,
  type Bom,
  type WorkCenter,
} from "@/lib/api";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from "@/components/production/production-shared";
import { NewProductionOrderModal } from "@/components/production/NewProductionOrderModal";
import { NewBomModal } from "@/components/production/NewBomModal";
import { NewWorkCenterModal } from "@/components/production/NewWorkCenterModal";
import { ProductionOrderDetailModal } from "@/components/production/ProductionOrderDetailModal";
import { ExcelImportExportBar } from "@/components/shared/ExcelImportExportBar";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
type Tab = "orders" | "boms" | "workCenters";

export default function ProductionPage() {
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<ProductionOrder[] | null>(null);
  const [boms, setBoms] = useState<Bom[] | null>(null);
  const [workCenters, setWorkCenters] = useState<WorkCenter[] | null>(null);

  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newBomOpen, setNewBomOpen] = useState(false);
  const [newWorkCenterOpen, setNewWorkCenterOpen] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  function reloadOrders() {
    fetchProductionOrders().then(setOrders).catch(() => setOrders([]));
  }
  function reloadBoms() {
    fetchBoms().then(setBoms).catch(() => setBoms([]));
  }
  function reloadWorkCenters() {
    fetchWorkCenters().then(setWorkCenters).catch(() => setWorkCenters([]));
  }

  useEffect(() => {
    reloadOrders();
    reloadBoms();
    reloadWorkCenters();
  }, []);

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">تولید</h1>
            <ModuleHelp code="production" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">فرمولاسیون، دستور تولید و مراحل خط تولید</p>
        </div>
        <button
          onClick={() => {
            if (tab === "orders") setNewOrderOpen(true);
            else if (tab === "boms") setNewBomOpen(true);
            else setNewWorkCenterOpen(true);
          }}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          {tab === "orders" ? "دستور تولید جدید" : tab === "boms" ? "فرمول جدید" : "ایستگاه جدید"}
        </button>
      </div>

      <div className="flex items-center gap-2 mt-6 border-b border-border">
        {(
          [
            ["orders", "دستورهای تولید"],
            ["boms", "فرمول‌ها"],
            ["workCenters", "ایستگاه‌های تولید"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-[13px] font-bold border-b-2 -mb-px cursor-pointer transition-colors ${
              tab === key ? "border-primary text-primary" : "border-transparent text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "orders" ? (
        <Card className="mt-5 p-2">
          {orders === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : orders.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
              <FactoryIcon className="w-6 h-6" />
              هنوز دستور تولیدی ثبت نشده است
            </div>
          ) : (
            orders.map((o, i) => (
              <button
                key={o.id}
                onClick={() => setOpenOrderId(o.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                  i < orders.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold">
                    #{o.orderNo} — {o.bom.outputProduct.name}
                  </div>
                  <div className="text-[11.5px] text-muted mt-0.5">
                    {formatNumber(o.quantityPlanned)} {o.bom.outputProduct.unit} · انبار {o.warehouse.name} · {formatJalaliDate(o.createdAt)}
                  </div>
                </div>
                <Badge tone={ORDER_STATUS_TONES[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
              </button>
            ))
          )}
        </Card>
      ) : tab === "boms" ? (
        <Card className="mt-5 p-2">
          {boms === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : boms.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">هنوز فرمول تولیدی ثبت نشده است</div>
          ) : (
            boms.map((b, i) => (
              <div
                key={b.id}
                className={`px-4 py-3.5 ${i < boms.length - 1 ? "border-b border-border" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold">{b.outputProduct.name}</span>
                  <span className="text-[10.5px] text-muted">نسخه {b.version}</span>
                </div>
                <div className="text-[11.5px] text-muted mt-1">
                  هر {formatNumber(b.batchOutputQty)} {b.outputProduct.unit} ⇐{" "}
                  {b.lines.map((l) => `${l.rawMaterial.name} ${formatNumber(l.quantityPerBatch)}${l.rawMaterial.unit}`).join("، ")}
                </div>
              </div>
            ))
          )}
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-end mt-5">
            <ExcelImportExportBar
              exportPath="/production/work-centers/export"
              exportFilename="work-centers.xlsx"
              importPath="/production/work-centers/import"
              templatePath="/production/work-centers/template"
              templateFilename="work-centers-template.xlsx"
              onImported={reloadWorkCenters}
            />
          </div>
        <Card className="mt-3 p-2">
          {workCenters === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : workCenters.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">هنوز ایستگاه تولیدی ثبت نشده است</div>
          ) : (
            workCenters.map((w, i) => (
              <div key={w.id} className={`px-4 py-3.5 text-[13px] font-semibold ${i < workCenters.length - 1 ? "border-b border-border" : ""}`}>
                {w.name}
              </div>
            ))
          )}
        </Card>
        </>
      )}

      {newOrderOpen ? (
        <NewProductionOrderModal onClose={() => setNewOrderOpen(false)} onCreated={reloadOrders} />
      ) : null}
      {newBomOpen ? <NewBomModal onClose={() => setNewBomOpen(false)} onCreated={reloadBoms} /> : null}
      {newWorkCenterOpen ? (
        <NewWorkCenterModal onClose={() => setNewWorkCenterOpen(false)} onCreated={reloadWorkCenters} />
      ) : null}
      {openOrderId ? (
        <ProductionOrderDetailModal orderId={openOrderId} onClose={() => setOpenOrderId(null)} onChanged={reloadOrders} />
      ) : null}
    </div>
  );
}
