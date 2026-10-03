import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { TrashIcon, PlusIcon } from "@/components/icons";
import {
  fetchSuppliers,
  createSupplier,
  fetchProducts,
  createPurchaseOrder,
  updatePurchaseOrder,
  ApiError,
  type Supplier,
  type Product,
  type PurchaseOrderDetail,
} from "@/lib/api";

type DraftLine = {
  productId: string;
  description: string;
  quantity: string;
  unitCost: string;
  currencyId?: string;
  unitCostFx?: number;
  exchangeRateFx?: number;
};

function emptyLine(): DraftLine {
  return { productId: "", description: "", quantity: "1", unitCost: "" };
}

export function NewPurchaseOrderModal({
  onClose,
  onCreated,
  order: editing,
}: {
  onClose: () => void;
  onCreated: (order: PurchaseOrderDetail) => void;
  /** ویرایش سفارش پیش‌نویس */
  order?: PurchaseOrderDetail;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState(editing?.supplier.id ?? "");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>(
    editing
      ? editing.lines.map((l) => ({
          productId: l.product?.id ?? "",
          description: l.description,
          quantity: String(l.quantity),
          unitCost: String(l.unitCost),
          currencyId: l.currencyId ?? undefined,
          unitCostFx: l.unitCostFx != null ? Number(l.unitCostFx) : undefined,
          exchangeRateFx: l.exchangeRateFx != null ? Number(l.exchangeRateFx) : undefined,
        }))
      : [emptyLine()],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reloadSuppliers() {
    fetchSuppliers().then(setSuppliers).catch(() => setSuppliers([]));
  }
  useEffect(() => {
    reloadSuppliers();
    fetchProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function handleProductPick(i: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    updateLine(i, {
      productId,
      description: product?.name ?? "",
      unitCost: product ? String(product.costPrice) : "",
      currencyId: product?.currencyId ?? undefined,
      unitCostFx: product?.currencyId && product.costPriceFx != null ? Number(product.costPriceFx) : undefined,
      exchangeRateFx: product?.currencyId && product.currency ? Number(product.currency.rate) : undefined,
    });
  }

  async function handleAddSupplier() {
    if (!newSupplierName.trim()) return;
    setAddingSupplier(true);
    try {
      const supplier = await createSupplier({ name: newSupplierName.trim() });
      setSuppliers((prev) => [supplier, ...prev]);
      setSupplierId(supplier.id);
      setNewSupplierName("");
    } finally {
      setAddingSupplier(false);
    }
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validLines = lines.filter((l) => l.description.trim() && Number(l.quantity) > 0);
    if (!supplierId || validLines.length === 0) return;
    setSubmitting(true);
    try {
      const payload = {
        supplierId,
        lines: validLines.map((l) => ({
          productId: l.productId || undefined,
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost) || 0,
          currencyId: l.currencyId,
          unitCostFx: l.unitCostFx,
          exchangeRateFx: l.exchangeRateFx,
        })),
      };
      const order = editing ? await updatePurchaseOrder(editing.id, payload) : await createPurchaseOrder(payload);
      onCreated(order);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={editing ? `ویرایش سفارش پیش‌نویس ${editing.orderNo}` : "سفارش خرید جدید"} onClose={onClose} width="max-w-[640px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">تأمین‌کننده</label>
          <div className="flex items-center gap-2">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              required
              className="flex-1 text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            >
              <option value="">انتخاب تأمین‌کننده...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company || s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <input
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
              placeholder="یا نام تأمین‌کننده‌ی جدید..."
              className="flex-1 text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2"
            />
            <button
              type="button"
              onClick={handleAddSupplier}
              disabled={addingSupplier || !newSupplierName.trim()}
              className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
            >
              افزودن
            </button>
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">اقلام سفارش</label>
          <div className="flex flex-col gap-2">
            {lines.map((line, i) => (
              <div key={i} className="flex items-center gap-1.5 flex-wrap">
                <select
                  value={line.productId}
                  onChange={(e) => handleProductPick(i, e.target.value)}
                  className="text-[12px] bg-slate-50 border border-border rounded-lg px-2 py-2 outline-none w-[120px]"
                >
                  <option value="">کالا (اختیاری)</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  value={line.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                  placeholder="شرح"
                  className="flex-1 min-w-[100px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                />
                <input
                  value={line.quantity}
                  onChange={(e) => updateLine(i, { quantity: e.target.value.replace(/[^0-9]/g, "") })}
                  placeholder="تعداد"
                  dir="ltr"
                  className="w-16 text-[12.5px] bg-slate-50 border border-border rounded-lg px-2 py-2 outline-none text-center"
                />
                <input
                  value={line.unitCost}
                  onChange={(e) => updateLine(i, { unitCost: e.target.value.replace(/[^0-9]/g, ""), currencyId: undefined })}
                  placeholder="بهای واحد (تومان)"
                  dir="ltr"
                  className="w-28 text-[12.5px] bg-slate-50 border border-border rounded-lg px-2 py-2 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={lines.length === 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-danger hover:bg-danger-soft cursor-pointer disabled:opacity-30"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
                {line.currencyId && line.unitCostFx ? (
                  <span className="text-[10.5px] text-muted w-full" dir="ltr">
                    نرخ لحظه‌ی ثبت قفل شد: {line.unitCostFx} × {line.exchangeRateFx?.toLocaleString("en-US")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            className="mt-2 flex items-center gap-1 text-[12px] font-bold text-primary cursor-pointer"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            افزودن ردیف
          </button>
        </div>

        <div className="text-left">
          <div className="text-[11.5px] text-muted">مبلغ کل سفارش</div>
          <div className="text-[16px] font-extrabold mt-1">{total.toLocaleString("en-US")} تومان</div>
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button
          type="submit"
          disabled={submitting || !supplierId}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "ثبت پیش‌نویس سفارش خرید"}
        </button>
      </form>
    </Modal>
  );
}
