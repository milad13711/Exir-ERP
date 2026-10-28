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
  archiveBom,
  restoreBom,
  deleteBom,
  archiveWorkCenter,
  restoreWorkCenter,
  deleteWorkCenter,
  ApiError,
  type ProductionOrder,
  type Bom,
  type BomListStatus,
  type WorkCenter,
} from "@/lib/api";
import { useModuleCan } from "@/hooks/useModuleCan";
import { MasterDeleteDialog } from "@/components/production/MasterDeleteDialog";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from "@/components/production/production-shared";
import { NewProductionOrderModal } from "@/components/production/NewProductionOrderModal";
import { NewBomModal } from "@/components/production/NewBomModal";
import { NewWorkCenterModal } from "@/components/production/NewWorkCenterModal";
import { ProductionOrderDetailModal } from "@/components/production/ProductionOrderDetailModal";
import { ExcelImportExportBar } from "@/components/shared/ExcelImportExportBar";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
type Tab = "orders" | "boms" | "workCenters";

function FilterChips({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex items-center gap-2 mt-5 flex-wrap">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`min-h-10 px-3.5 rounded-xl text-[12.5px] font-bold cursor-pointer border ${
            value === key ? "bg-primary text-white border-primary" : "bg-surface text-ink-soft border-border"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RowButton({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-10 px-3.5 rounded-lg text-[12px] font-bold cursor-pointer ${
        danger ? "text-danger bg-danger-soft" : "text-primary bg-primary-soft"
      }`}
    >
      {children}
    </button>
  );
}

export default function ProductionPage() {
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<ProductionOrder[] | null>(null);
  const [boms, setBoms] = useState<Bom[] | null>(null);
  const [workCenters, setWorkCenters] = useState<WorkCenter[] | null>(null);

  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newBomOpen, setNewBomOpen] = useState(false);
  const [newWorkCenterOpen, setNewWorkCenterOpen] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const can = useModuleCan("production");
  const [bomFilter, setBomFilter] = useState<BomListStatus>("active");
  const [wcFilter, setWcFilter] = useState<"active" | "archived">("active");
  const [editBom, setEditBom] = useState<Bom | null>(null);
  const [deleteBomTarget, setDeleteBomTarget] = useState<Bom | null>(null);
  const [editWc, setEditWc] = useState<WorkCenter | null>(null);
  const [deleteWcTarget, setDeleteWcTarget] = useState<WorkCenter | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(fn: () => Promise<unknown>, after: () => void) {
    setActionError(null);
    try {
      await fn();
      after();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "عملیات ناموفق بود");
    }
  }

  function reloadOrders() {
    fetchProductionOrders().then(setOrders).catch(() => setOrders([]));
  }
  function reloadBoms(filter: BomListStatus = bomFilter) {
    fetchBoms(filter).then(setBoms).catch(() => setBoms([]));
  }
  function reloadWorkCenters(filter: "active" | "archived" = wcFilter) {
    fetchWorkCenters(filter).then(setWorkCenters).catch(() => setWorkCenters([]));
  }

  useEffect(() => {
    reloadOrders();
  }, []);
  useEffect(() => {
    reloadBoms(bomFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomFilter]);
  useEffect(() => {
    reloadWorkCenters(wcFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wcFilter]);

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
        <>
          <FilterChips
            value={bomFilter}
            onChange={(v) => {
              setBoms(null);
              setBomFilter(v as BomListStatus);
            }}
            options={[
              ["active", "فعال"],
              ["archived", "بایگانی"],
              ["history", "نسخه‌های قبلی"],
            ]}
          />
          {actionError ? <div className="mt-3 text-[12px] text-danger">{actionError}</div> : null}
          <Card className="mt-3 p-2">
            {boms === null ? (
              <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
            ) : boms.length === 0 ? (
              <div className="p-8 text-center text-muted text-sm">
                {bomFilter === "active" ? "هنوز فرمول تولیدی ثبت نشده است" : "موردی وجود ندارد"}
              </div>
            ) : (
              boms.map((b, i) => (
                <div key={b.id} className={`px-4 py-3.5 ${i < boms.length - 1 ? "border-b border-border" : ""}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold">{b.outputProduct.name}</span>
                    <span className="text-[10.5px] text-muted">نسخه {formatNumber(b.version)}</span>
                    {(b.usageCount ?? 0) > 0 ? (
                      <Badge tone="neutral">در {formatNumber(b.usageCount ?? 0)} سفارش استفاده شده</Badge>
                    ) : null}
                    {b.archivedAt ? <Badge tone="warning">بایگانی</Badge> : !b.isActive ? <Badge tone="neutral">جایگزین‌شده</Badge> : null}
                  </div>
                  <div className="text-[11.5px] text-muted mt-1">
                    هر {formatNumber(b.batchOutputQty)} {b.outputProduct.unit} ⇐{" "}
                    {b.lines.map((l) => `${l.rawMaterial.name} ${formatNumber(l.quantityPerBatch)}${l.rawMaterial.unit}`).join("، ")}
                  </div>
                  {b.notes ? <div className="text-[11.5px] text-muted mt-0.5">{b.notes}</div> : null}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {b.isActive && can.canEdit ? (
                      <RowButton onClick={() => setEditBom(b)}>ویرایش</RowButton>
                    ) : null}
                    {b.archivedAt && can.canEdit ? (
                      <RowButton
                        onClick={() => runAction(() => restoreBom(b.id), () => reloadBoms())}
                      >
                        بازیابی
                      </RowButton>
                    ) : null}
                    {(can.canDelete || can.canEdit) && (b.isActive || b.archivedAt || (b.usageCount ?? 0) === 0) ? (
                      <RowButton danger onClick={() => setDeleteBomTarget(b)}>
                        حذف
                      </RowButton>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </Card>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap mt-5">
            <FilterChips
              value={wcFilter}
              onChange={(v) => {
                setWorkCenters(null);
                setWcFilter(v as "active" | "archived");
              }}
              options={[
                ["active", "فعال"],
                ["archived", "بایگانی"],
              ]}
            />
            <ExcelImportExportBar
              exportPath="/production/work-centers/export"
              exportFilename="work-centers.xlsx"
              importPath="/production/work-centers/import"
              templatePath="/production/work-centers/template"
              templateFilename="work-centers-template.xlsx"
              onImported={() => reloadWorkCenters()}
            />
          </div>
        <Card className="mt-3 p-2">
          {workCenters === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : workCenters.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">هنوز ایستگاه تولیدی ثبت نشده است</div>
          ) : (
            workCenters.map((w, i) => (
              <div key={w.id} className={`px-4 py-3.5 ${i < workCenters.length - 1 ? "border-b border-border" : ""}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold">{w.name}</span>
                  <span className="text-[10.5px] text-muted">ترتیب {formatNumber(w.sequenceOrder)}</span>
                  {(w.usageCount ?? 0) > 0 ? <Badge tone="neutral">در {formatNumber(w.usageCount ?? 0)} مرحله استفاده شده</Badge> : null}
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {w.isActive && can.canEdit ? <RowButton onClick={() => setEditWc(w)}>ویرایش</RowButton> : null}
                  {!w.isActive && can.canEdit ? (
                    <RowButton onClick={() => runAction(() => restoreWorkCenter(w.id), () => reloadWorkCenters())}>بازیابی</RowButton>
                  ) : null}
                  {can.canDelete || can.canEdit ? (
                    <RowButton danger onClick={() => setDeleteWcTarget(w)}>
                      حذف
                    </RowButton>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </Card>
        </>
      )}

      {newOrderOpen ? (
        <NewProductionOrderModal onClose={() => setNewOrderOpen(false)} onCreated={reloadOrders} />
      ) : null}
      {newBomOpen ? <NewBomModal onClose={() => setNewBomOpen(false)} onCreated={() => reloadBoms()} /> : null}
      {editBom ? <NewBomModal bom={editBom} onClose={() => setEditBom(null)} onCreated={() => reloadBoms()} /> : null}
      {newWorkCenterOpen ? (
        <NewWorkCenterModal onClose={() => setNewWorkCenterOpen(false)} onCreated={() => reloadWorkCenters()} />
      ) : null}
      {editWc ? (
        <NewWorkCenterModal workCenter={editWc} onClose={() => setEditWc(null)} onCreated={() => reloadWorkCenters()} />
      ) : null}
      {deleteBomTarget ? (
        <MasterDeleteDialog
          title={`${deleteBomTarget.outputProduct.name} — نسخه ${formatNumber(deleteBomTarget.version)}`}
          usageCount={deleteBomTarget.usageCount ?? 0}
          usageNoun="دستور تولید"
          canDelete={can.canDelete}
          onDelete={() => deleteBom(deleteBomTarget.id)}
          onArchive={() => (deleteBomTarget.isActive ? archiveBom(deleteBomTarget.id) : Promise.resolve())}
          onClose={() => setDeleteBomTarget(null)}
          onDone={() => reloadBoms()}
        />
      ) : null}
      {deleteWcTarget ? (
        <MasterDeleteDialog
          title={deleteWcTarget.name}
          usageCount={deleteWcTarget.usageCount ?? 0}
          usageNoun="مرحله‌ی دستور تولید"
          canDelete={can.canDelete}
          onDelete={() => deleteWorkCenter(deleteWcTarget.id)}
          onArchive={() => (deleteWcTarget.isActive ? archiveWorkCenter(deleteWcTarget.id) : Promise.resolve())}
          onClose={() => setDeleteWcTarget(null)}
          onDone={() => reloadWorkCenters()}
        />
      ) : null}
      {openOrderId ? (
        <ProductionOrderDetailModal orderId={openOrderId} onClose={() => setOpenOrderId(null)} onChanged={reloadOrders} />
      ) : null}
    </div>
  );
}
