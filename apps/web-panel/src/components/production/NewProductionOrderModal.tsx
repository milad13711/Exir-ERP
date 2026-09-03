import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { PlusIcon, TrashIcon } from "@/components/icons";
import {
  fetchBoms,
  fetchWarehouses,
  fetchWorkCenters,
  fetchUsers,
  fetchSalesInvoices,
  createProductionOrder,
  ApiError,
  type Bom,
  type Warehouse,
  type WorkCenter,
  type TenantUser,
  type SalesInvoice,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

type StageDraft = { workCenterId: string; assignedUserId: string };

export function NewProductionOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [boms, setBoms] = useState<Bom[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);

  const [bomId, setBomId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantityPlanned, setQuantityPlanned] = useState("");
  const [relatedInvoiceId, setRelatedInvoiceId] = useState("");
  const [plannedStartAt, setPlannedStartAt] = useState("");
  const [plannedEndAt, setPlannedEndAt] = useState("");
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBoms().then(setBoms).catch(() => setBoms([]));
    fetchWarehouses().then((ws) => {
      setWarehouses(ws);
      const def = ws.find((w) => w.isDefault) ?? ws[0];
      if (def) setWarehouseId(def.id);
    }).catch(() => setWarehouses([]));
    fetchWorkCenters().then(setWorkCenters).catch(() => setWorkCenters([]));
    fetchUsers().then(setUsers).catch(() => setUsers([]));
    fetchSalesInvoices().then(setInvoices).catch(() => setInvoices([]));
  }, []);

  const selectedBom = boms.find((b) => b.id === bomId);
  const valid = bomId && warehouseId && Number(quantityPlanned) > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await createProductionOrder({
        bomId,
        warehouseId,
        quantityPlanned: Number(quantityPlanned),
        relatedInvoiceId: relatedInvoiceId || undefined,
        plannedStartAt: plannedStartAt || undefined,
        plannedEndAt: plannedEndAt || undefined,
        stages: stages.length > 0
          ? stages
              .filter((s) => s.workCenterId)
              .map((s) => ({ workCenterId: s.workCenterId, assignedUserId: s.assignedUserId || undefined }))
          : undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="دستور تولید جدید" onClose={onClose} width="max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>فرمول تولید</label>
          <select value={bomId} onChange={(e) => setBomId(e.target.value)} className={inputClass}>
            <option value="">انتخاب کنید...</option>
            {boms.map((b) => (
              <option key={b.id} value={b.id}>
                {b.outputProduct.name} (نسخه {b.version})
              </option>
            ))}
          </select>
          {selectedBom ? (
            <p className="text-[11px] text-muted mt-1.5">
              مواد اولیه: {selectedBom.lines.map((l) => `${l.rawMaterial.name} (${l.quantityPerBatch}${l.rawMaterial.unit}/${selectedBom.batchOutputQty}${selectedBom.outputProduct.unit})`).join("، ")}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>انبار</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={inputClass}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>مقدار برنامه‌ریزی‌شده {selectedBom ? `(${selectedBom.outputProduct.unit})` : ""}</label>
            <input
              value={quantityPlanned}
              onChange={(e) => setQuantityPlanned(e.target.value.replace(/[^0-9]/g, ""))}
              className={inputClass}
              dir="ltr"
              inputMode="numeric"
            />
          </div>
        </div>

        {invoices.length > 0 ? (
          <div>
            <label className={labelClass}>مرتبط با فاکتور فروش (اختیاری — برای تولید سفارشی)</label>
            <select value={relatedInvoiceId} onChange={(e) => setRelatedInvoiceId(e.target.value)} className={inputClass}>
              <option value="">بدون فاکتور — تولید عمومی</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  فاکتور #{inv.invoiceNo} — {inv.contact.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>شروع برنامه‌ریزی‌شده (اختیاری)</label>
            <JalaliDateInput value={plannedStartAt} onChange={setPlannedStartAt} />
          </div>
          <div>
            <label className={labelClass}>پایان برنامه‌ریزی‌شده (اختیاری)</label>
            <JalaliDateInput value={plannedEndAt} onChange={setPlannedEndAt} />
          </div>
        </div>

        {workCenters.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] font-semibold text-ink-soft">مراحل تولید (اختیاری)</label>
              <button
                type="button"
                onClick={() => setStages((prev) => [...prev, { workCenterId: "", assignedUserId: "" }])}
                className="text-[11.5px] font-bold text-primary flex items-center gap-1 cursor-pointer"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                افزودن مرحله
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {stages.map((s, i) => (
                <div key={i} className="flex items-center gap-2 bg-slate-50 border border-border rounded-xl p-2.5">
                  <select
                    value={s.workCenterId}
                    onChange={(e) =>
                      setStages((prev) => prev.map((x, idx) => (idx === i ? { ...x, workCenterId: e.target.value } : x)))
                    }
                    className="flex-[2] text-[12px] bg-surface border border-border rounded-lg px-2 py-2 outline-none min-w-0"
                  >
                    <option value="">ایستگاه...</option>
                    {workCenters.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={s.assignedUserId}
                    onChange={(e) =>
                      setStages((prev) => prev.map((x, idx) => (idx === i ? { ...x, assignedUserId: e.target.value } : x)))
                    }
                    className="flex-[2] text-[12px] bg-surface border border-border rounded-lg px-2 py-2 outline-none min-w-0"
                  >
                    <option value="">مسئول (اختیاری)...</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setStages((prev) => prev.filter((_, idx) => idx !== i))}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer shrink-0"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !valid}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "ثبت دستور تولید"}
        </button>
      </form>
    </Modal>
  );
}
