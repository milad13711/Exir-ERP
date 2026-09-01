import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createStockTransfer, fetchWarehouses, fetchProducts, ApiError, type Warehouse, type Product } from "@/lib/api";

const inputClass =
  "text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";

export function TransferStockModal({ onClose, onTransferred }: { onClose: () => void; onTransferred: () => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWarehouses().then((list) => {
      setWarehouses(list);
      setFromWarehouseId(list.find((w) => w.isDefault)?.id ?? list[0]?.id ?? "");
      setToWarehouseId(list.find((w) => !w.isDefault)?.id ?? "");
    });
    fetchProducts().then(setProducts);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!productId || !fromWarehouseId || !toWarehouseId || !Number(quantity)) return;
    setSubmitting(true);
    try {
      await createStockTransfer({
        productId,
        fromWarehouseId,
        toWarehouseId,
        quantity: Number(quantity),
        note: note.trim() || undefined,
      });
      onTransferred();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="انتقال موجودی بین انبارها" onClose={onClose} width="max-w-[480px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">کالا</label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} required className={`w-full ${inputClass}`}>
            <option value="">انتخاب کالا...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">از انبار</label>
            <select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)} className={`w-full ${inputClass}`}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">به انبار</label>
            <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} className={`w-full ${inputClass}`}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">مقدار</label>
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ""))}
            dir="ltr"
            className={`w-full ${inputClass}`}
            placeholder="0"
          />
        </div>

        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">توضیحات (اختیاری)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={`w-full ${inputClass}`} />
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button
          type="submit"
          disabled={submitting || !productId || fromWarehouseId === toWarehouseId || !Number(quantity)}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال انتقال..." : "ثبت انتقال"}
        </button>
      </form>
    </Modal>
  );
}
