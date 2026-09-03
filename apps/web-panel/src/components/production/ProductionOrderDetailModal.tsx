import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDate, formatNumber } from "@/lib/persian";
import {
  fetchProductionOrder,
  fetchSalesInvoice,
  approveRawMaterials,
  startProductionOrder,
  updateProductionStage,
  completeProductionOrder,
  rejectProductionOrder,
  ApiError,
  type ProductionOrder,
  type SalesInvoice,
} from "@/lib/api";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES, STAGE_STATUS_LABELS } from "./production-shared";
import { QualityControlSection } from "./QualityControlSection";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { useWorkspace } from "@/lib/workspace-context";

const btnBase = "text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50";

export function ProductionOrderDetailModal({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { installedModules } = useWorkspace();
  const [order, setOrder] = useState<ProductionOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quantityProduced, setQuantityProduced] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [reportDrafts, setReportDrafts] = useState<Record<string, string>>({});
  const [expandedStageDocs, setExpandedStageDocs] = useState<Record<string, boolean>>({});
  const [relatedInvoice, setRelatedInvoice] = useState<SalesInvoice | null>(null);

  function reload() {
    fetchProductionOrder(orderId).then((o) => {
      setOrder(o);
      setQuantityProduced(String(o.quantityPlanned));
      if (o.relatedInvoiceId) {
        fetchSalesInvoice(o.relatedInvoiceId).then(setRelatedInvoice).catch(() => setRelatedInvoice(null));
      } else {
        setRelatedInvoice(null);
      }
    });
  }
  useEffect(reload, [orderId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    return (
      <Modal title="دستور تولید" onClose={onClose}>
        <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      </Modal>
    );
  }

  const requirements = order.bom.lines.map((l) => ({
    ...l,
    required: Math.ceil((l.quantityPerBatch * order.quantityPlanned) / order.bom.batchOutputQty),
  }));

  return (
    <Modal title={`دستور تولید #${order.orderNo} — ${order.bom.outputProduct.name}`} onClose={onClose} width="max-w-[640px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Badge tone={ORDER_STATUS_TONES[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
          <div className="text-[12.5px] text-muted">
            انبار: {order.warehouse.name} · مقدار برنامه‌ریزی‌شده: {formatNumber(order.quantityPlanned)} {order.bom.outputProduct.unit}
            {order.quantityProduced != null ? ` · مقدار واقعی: ${formatNumber(order.quantityProduced)}` : ""}
          </div>
        </div>

        {relatedInvoice ? (
          <div className="text-[12px] bg-primary/5 text-primary rounded-lg px-3 py-2">
            تولید سفارشی برای فاکتور #{relatedInvoice.invoiceNo} — {relatedInvoice.contact.name}
          </div>
        ) : null}

        <div>
          <div className="text-[13px] font-bold mb-2">مواد اولیه لازم</div>
          <div className="flex flex-col gap-1.5">
            {requirements.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-[12.5px] bg-slate-50 rounded-lg px-3 py-2">
                <span>{r.rawMaterial.name}</span>
                <span className="font-bold">
                  {formatNumber(r.required)} {r.rawMaterial.unit}
                </span>
              </div>
            ))}
          </div>
          {order.rawMaterialApprovedAt ? (
            <p className="text-[11.5px] text-success mt-1.5">
              تأییدشده در {formatJalaliDate(order.rawMaterialApprovedAt)}
              {order.rawMaterialApprovalNotes ? ` — ${order.rawMaterialApprovalNotes}` : ""}
            </p>
          ) : null}
        </div>

        {order.stages.length > 0 ? (
          <div>
            <div className="text-[13px] font-bold mb-2">مراحل تولید</div>
            <div className="flex flex-col gap-2">
              {order.stages.map((stage) => (
                <div key={stage.id} className="bg-slate-50 border border-border rounded-xl p-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-[12.5px] font-bold">
                      {stage.workCenter.name}
                      {stage.assignedUser ? <span className="text-muted font-normal"> — {stage.assignedUser.name}</span> : null}
                    </div>
                    <select
                      value={stage.status}
                      disabled={busy || order.status !== "IN_PROGRESS"}
                      onChange={(e) =>
                        run(() => updateProductionStage(order.id, stage.id, { status: e.target.value as never }))
                      }
                      className="text-[11.5px] font-bold bg-surface border border-border rounded-lg px-2.5 py-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {(["PENDING", "IN_PROGRESS", "DONE"] as const).map((s) => (
                        <option key={s} value={s}>
                          {STAGE_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <textarea
                      value={reportDrafts[stage.id] ?? stage.report ?? ""}
                      onChange={(e) => setReportDrafts((prev) => ({ ...prev, [stage.id]: e.target.value }))}
                      placeholder="گزارش / مستندات این مرحله..."
                      rows={2}
                      className="flex-1 text-[11.5px] bg-surface border border-border rounded-lg px-2.5 py-2 outline-none resize-none"
                    />
                    <button
                      disabled={busy || (reportDrafts[stage.id] ?? stage.report ?? "") === (stage.report ?? "")}
                      onClick={() => run(() => updateProductionStage(order.id, stage.id, { report: reportDrafts[stage.id] ?? "" }))}
                      className="text-[11px] font-bold text-primary cursor-pointer disabled:opacity-40 disabled:cursor-default self-start py-2"
                    >
                      ذخیره
                    </button>
                  </div>
                  <button
                    onClick={() => setExpandedStageDocs((prev) => ({ ...prev, [stage.id]: !prev[stage.id] }))}
                    className="text-[11px] text-muted mt-1.5 cursor-pointer"
                  >
                    {expandedStageDocs[stage.id] ? "بستن مستندات پیوست‌شده" : "مستندات پیوست‌شده"}
                  </button>
                  {expandedStageDocs[stage.id] ? (
                    <div className="mt-2">
                      <AttachmentsSection entityType="production_order_stage" entityId={stage.id} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {installedModules.has("quality-control") ? <QualityControlSection productionOrderId={order.id} /> : null}

        <div>
          <div className="text-[13px] font-bold mb-2">مستندات دستور تولید</div>
          <AttachmentsSection entityType="production_order" entityId={order.id} />
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border">
          {order.status === "DRAFT" ? (
            <button
              disabled={busy}
              onClick={() => run(() => approveRawMaterials(order.id))}
              className={`${btnBase} bg-primary text-white`}
            >
              تأیید سلامت مواد اولیه و کسر انبار
            </button>
          ) : null}
          {order.status === "RAW_MATERIAL_APPROVED" ? (
            <button disabled={busy} onClick={() => run(() => startProductionOrder(order.id))} className={`${btnBase} bg-primary text-white`}>
              شروع تولید
            </button>
          ) : null}
          {order.status === "IN_PROGRESS" ? (
            <div className="flex items-center gap-2">
              <input
                value={quantityProduced}
                onChange={(e) => setQuantityProduced(e.target.value.replace(/[^0-9]/g, ""))}
                dir="ltr"
                inputMode="numeric"
                className="w-24 text-[12.5px] bg-slate-50 border border-border rounded-xl px-3 py-2.5 outline-none"
              />
              <button
                disabled={busy || !Number(quantityProduced)}
                onClick={() => run(() => completeProductionOrder(order.id, Number(quantityProduced)))}
                className={`${btnBase} bg-success text-white`}
              >
                {installedModules.has("quality-control") ? "پایان تولید و ارسال به کنترل کیفیت" : "تکمیل و افزودن به انبار"}
              </button>
            </div>
          ) : null}
          {order.status === "QC_PENDING" ? (
            <button disabled={busy} onClick={() => run(() => completeProductionOrder(order.id))} className={`${btnBase} bg-success text-white`}>
              تکمیل نهایی و افزودن به انبار
            </button>
          ) : null}
          {order.status !== "COMPLETED" && order.status !== "CANCELLED" && order.status !== "REJECTED" ? (
            showReject ? (
              <div className="flex items-center gap-2">
                <input
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="دلیل"
                  className="w-40 text-[12.5px] bg-slate-50 border border-border rounded-xl px-3 py-2.5 outline-none"
                />
                <button
                  disabled={busy || !rejectReason.trim()}
                  onClick={() => run(() => rejectProductionOrder(order.id, rejectReason.trim()))}
                  className={`${btnBase} bg-danger-soft text-danger`}
                >
                  {order.status === "DRAFT" ? "ثبت لغو" : "ثبت رد"}
                </button>
              </div>
            ) : (
              <button disabled={busy} onClick={() => setShowReject(true)} className={`${btnBase} bg-danger-soft text-danger`}>
                {order.status === "DRAFT" ? "لغو دستور تولید" : "رد کردن دستور تولید"}
              </button>
            )
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
