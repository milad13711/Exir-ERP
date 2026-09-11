"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { fetchWarrantyProducts, manualIssueWarrantyCodes, type WarrantyProduct } from "@/lib/api";

export function ManualIssueModal({ onClose, onIssued }: { onClose: () => void; onIssued: () => void }) {
  const [products, setProducts] = useState<WarrantyProduct[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [durationDays, setDurationDays] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [manualInvoiceNumber, setManualInvoiceNumber] = useState("");
  const [issuedCodes, setIssuedCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWarrantyProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  const selectedProduct = products.find((p) => p.id === productId);

  async function handleSubmit() {
    if (!productId) return;
    setBusy(true);
    setError(null);
    try {
      const { codes } = await manualIssueWarrantyCodes({
        productId,
        quantity,
        durationDays: durationDays ? Number(durationDays) : undefined,
        serialNumber: serialNumber || undefined,
        manualInvoiceNumber: manualInvoiceNumber || undefined,
      });
      setIssuedCodes(codes);
      onIssued();
    } catch (err) {
      setError(err instanceof Error ? err.message : "صدور با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  if (issuedCodes) {
    return (
      <Modal title="کدهای صادرشده" onClose={onClose}>
        <div className="flex flex-col gap-2">
          {issuedCodes.map((c) => (
            <div key={c} className="text-center font-extrabold text-lg tracking-wider bg-slate-50 border border-border rounded-xl py-2" dir="ltr">
              {c}
            </div>
          ))}
          <button onClick={onClose} className="mt-3 text-[12.5px] font-bold px-4 py-2.5 rounded-xl bg-primary text-white cursor-pointer">
            بستن
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="صدور دستی گارانتی" onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        {!productId && products.every((p) => !p.warrantyEnabled) && (
          <div className="text-[12.5px] text-warning bg-warning-soft rounded-xl p-3">
            هیچ کالایی گارانتی فعال ندارد — ابتدا از بخش «کالاها» گارانتی کالای مورد نظر را فعال کنید.
          </div>
        )}
        <Field label="کالا">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          >
            <option value="">انتخاب کالا...</option>
            {products
              .filter((p) => p.warrantyEnabled)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
          </select>
        </Field>
        <Field label="تعداد">
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
        </Field>
        <Field label={`مدت گارانتی (روز) — خالی یعنی ${selectedProduct?.warrantyDurationDays ?? "پیش‌فرض ماژول"}`}>
          <input
            type="number"
            min={1}
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
        </Field>
        {quantity === 1 && (
          <Field label="شماره سریال (اختیاری)">
            <input
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            />
          </Field>
        )}
        <Field label="شماره فاکتور خارج از سیستم (اختیاری)">
          <input
            value={manualInvoiceNumber}
            onChange={(e) => setManualInvoiceNumber(e.target.value)}
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
        </Field>

        {error && <div className="text-[12.5px] text-danger">{error}</div>}

        <button
          onClick={handleSubmit}
          disabled={!productId || busy}
          className="text-[13px] font-bold px-4 py-2.5 rounded-xl bg-primary text-white disabled:opacity-50 cursor-pointer"
        >
          {busy ? "در حال صدور..." : "صدور گارانتی"}
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
