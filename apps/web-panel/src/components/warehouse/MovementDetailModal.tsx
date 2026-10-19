"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { ReasonDialog } from "@/components/ui/ReasonDialog";
import { RevisionHistory } from "@/components/shared/RevisionHistory";
import { useModuleCan } from "@/hooks/useModuleCan";
import { formatJalaliDateTime, formatNumber, formatToman } from "@/lib/persian";
import { ApiError, editStockMovement, fetchStockMovement, voidStockMovement, type StockMovementDetail } from "@/lib/api";

const TYPE_LABELS: Record<string, string> = {
  RECEIPT: "رسید ورودی",
  ISSUE: "حواله خروجی",
  ADJUSTMENT: "اصلاح موجودی",
};

/** جزئیات رسید/حواله + ویرایش (با دلیل) + ابطال نرم + تاریخچه. علت مسدودی از سرور می‌آید و به فارسی نمایش داده می‌شود. */
export function MovementDetailModal({ movementId, onClose, onChanged }: { movementId: string; onClose: () => void; onChanged: () => void }) {
  const [m, setM] = useState<StockMovementDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revKey, setRevKey] = useState(0);
  const can = useModuleCan("warehouse");

  function load() {
    fetchStockMovement(movementId).then((r) => {
      setM(r);
      setQuantity(String(r.type === "ADJUSTMENT" ? r.quantityDelta : Math.abs(r.quantityDelta)));
      setUnitCost(r.unitCost != null ? String(r.unitCost) : "");
      setReference(r.reference ?? "");
      setNote(r.note ?? "");
    });
  }
  useEffect(load, [movementId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!m) return;
    setBusy(true);
    setError(null);
    try {
      await editStockMovement(m.id, {
        quantity: Number(quantity),
        ...(m.type === "RECEIPT" && unitCost !== "" ? { unitCost: Number(unitCost) } : {}),
        reference,
        note,
        reason: reason.trim(),
      });
      setEditing(false);
      setReason("");
      setRevKey((k) => k + 1);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ویرایش ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const voided = !!m?.voidedAt;
  const block = m?.amendBlock ?? null;
  const inputCls = "w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary";

  return (
    <Modal title="رسید / حواله انبار" onClose={onClose} width="max-w-[560px]">
      {!m ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-extrabold">{m.product.name}</div>
              <div className="text-[12px] text-muted mt-1">
                {m.warehouse.name} · {formatJalaliDateTime(m.createdAt)}
                {m.createdBy ? ` · ${m.createdBy.name}` : ""}
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap justify-end">
              <Badge tone="neutral">{TYPE_LABELS[m.type] ?? m.type}</Badge>
              {voided ? <Badge tone="danger">باطل‌شده</Badge> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[12.5px]">
            <div className="bg-slate-50 border border-border rounded-xl p-3">
              <div className="text-muted text-[11px]">مقدار</div>
              <div className="font-extrabold mt-0.5" dir="ltr">
                {m.quantityDelta > 0 ? "+" : ""}
                {formatNumber(m.quantityDelta)} {m.product.unit}
              </div>
            </div>
            <div className="bg-slate-50 border border-border rounded-xl p-3">
              <div className="text-muted text-[11px]">بهای واحد</div>
              <div className="font-extrabold mt-0.5">{m.unitCost != null ? formatToman(m.unitCost) : "—"}</div>
            </div>
          </div>
          {m.reference ? <div className="text-[12.5px] text-ink-soft">مرجع: {m.reference}</div> : null}
          {m.note ? <div className="text-[12.5px] text-ink-soft">توضیح: {m.note}</div> : null}
          {voided ? <div className="text-[12.5px] text-danger font-semibold">دلیل ابطال: {m.voidReason}</div> : null}

          {block && !voided ? <div className="text-[12px] leading-6 bg-slate-50 border border-border rounded-xl px-3.5 py-3 text-ink-soft">ویرایش/ابطال ممکن نیست: {block}</div> : null}

          {editing && !block ? (
            <form onSubmit={save} className="flex flex-col gap-3 border border-border rounded-xl p-3.5">
              <div className="text-[12px] leading-6 text-ink-soft">
                موجودی و بهای تمام‌شده‌ی کالا بر اساس تغییر شما بازمحاسبه می‌شود. اگر تغییر باعث منفی‌شدن موجودی یا برهم‌خوردن حواله‌های بعدی شود، سرور آن را رد می‌کند.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-ink-soft">{m.type === "ADJUSTMENT" ? "مقدار (با علامت ±)" : "تعداد"}</span>
                  <input value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^0-9-]/g, ""))} dir="ltr" className={inputCls} />
                </label>
                {m.type === "RECEIPT" ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-ink-soft">بهای واحد (تومان)</span>
                    <input value={unitCost} onChange={(e) => setUnitCost(e.target.value.replace(/[^0-9]/g, ""))} dir="ltr" className={inputCls} />
                  </label>
                ) : null}
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-ink-soft">مرجع</span>
                <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-ink-soft">توضیح</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-ink-soft">دلیل ویرایش (الزامی)</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
              </label>
              {error ? <div className="text-[12px] text-danger">{error}</div> : null}
              <div className="flex gap-2">
                <button type="submit" disabled={busy || reason.trim().length < 3} className="flex-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50">
                  {busy ? "در حال ذخیره..." : "ذخیره‌ی ویرایش"}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer">
                  انصراف
                </button>
              </div>
            </form>
          ) : null}

          {!editing && !block && !voided ? (
            <div className="flex gap-2 flex-wrap">
              {can.canEdit ? (
                <button onClick={() => setEditing(true)} className="text-[12.5px] font-bold text-primary bg-primary-soft px-4 py-2.5 rounded-xl cursor-pointer">
                  ویرایش
                </button>
              ) : null}
              {can.canDelete ? (
                <button onClick={() => setVoidOpen(true)} className="text-[12.5px] font-bold text-danger bg-danger-soft px-4 py-2.5 rounded-xl cursor-pointer">
                  ابطال (حذف نرم)
                </button>
              ) : null}
            </div>
          ) : null}

          <RevisionHistory load={async () => (await fetchStockMovement(movementId)).revisions} refreshKey={revKey} />
        </div>
      )}
      {voidOpen && m ? (
        <ReasonDialog
          title="ابطال رسید / حواله"
          description="ردیف حذف نمی‌شود؛ با یک ردیف معکوس خنثی و «باطل‌شده» علامت می‌خورد و موجودی و بهای تمام‌شده بازمحاسبه می‌شود. اگر حواله‌ها یا فاکتورهای بعدی به این موجودی تکیه کرده باشند، ابطال رد می‌شود."
          confirmLabel="ابطال"
          onConfirm={async (r) => {
            await voidStockMovement(m.id, r);
            setRevKey((k) => k + 1);
            load();
            onChanged();
          }}
          onClose={() => setVoidOpen(false)}
        />
      ) : null}
    </Modal>
  );
}
