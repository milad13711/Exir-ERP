import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PlusIcon, TrashIcon } from "@/components/icons";
import { fetchProducts, createBom, ApiError, type Product } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

type LineDraft = { rawMaterialProductId: string; quantityPerBatch: string };

export function NewBomModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [outputProductId, setOutputProductId] = useState("");
  const [batchOutputQty, setBatchOutputQty] = useState("1000");
  const [lines, setLines] = useState<LineDraft[]>([{ rawMaterialProductId: "", quantityPerBatch: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const outputProduct = products.find((p) => p.id === outputProductId);
  const valid =
    outputProductId &&
    Number(batchOutputQty) > 0 &&
    lines.length > 0 &&
    lines.every((l) => l.rawMaterialProductId && Number(l.quantityPerBatch) > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await createBom({
        outputProductId,
        batchOutputQty: Number(batchOutputQty),
        lines: lines.map((l) => ({ rawMaterialProductId: l.rawMaterialProductId, quantityPerBatch: Number(l.quantityPerBatch) })),
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
    <Modal title="فرمول تولید جدید" onClose={onClose} width="max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <p className="text-[11.5px] text-muted -mt-1">
          اگر این محصول قبلاً فرمول فعال داشته باشد، نسخه‌ی قبلی غیرفعال و این فرمول جایگزین آن می‌شود.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>محصول نهایی</label>
            <select value={outputProductId} onChange={(e) => setOutputProductId(e.target.value)} className={inputClass}>
              <option value="">انتخاب کنید...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>مقدار پایه‌ی هر بچ {outputProduct ? `(${outputProduct.unit})` : ""}</label>
            <input
              value={batchOutputQty}
              onChange={(e) => setBatchOutputQty(e.target.value.replace(/[^0-9]/g, ""))}
              className={inputClass}
              dir="ltr"
              inputMode="numeric"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[12px] font-semibold text-ink-soft">مواد اولیه (به‌ازای همان مقدار پایه)</label>
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, { rawMaterialProductId: "", quantityPerBatch: "" }])}
              className="text-[11.5px] font-bold text-primary flex items-center gap-1 cursor-pointer"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              ردیف جدید
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((line, i) => (
              <div key={i} className="flex items-center gap-2 bg-slate-50 border border-border rounded-xl p-2.5">
                <select
                  value={line.rawMaterialProductId}
                  onChange={(e) => updateLine(i, { rawMaterialProductId: e.target.value })}
                  className="flex-[2] text-[12px] bg-surface border border-border rounded-lg px-2 py-2 outline-none min-w-0"
                >
                  <option value="">ماده اولیه...</option>
                  {products
                    .filter((p) => p.id !== outputProductId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <input
                  value={line.quantityPerBatch}
                  onChange={(e) => updateLine(i, { quantityPerBatch: e.target.value.replace(/[^0-9]/g, "") })}
                  placeholder="مقدار مصرف"
                  dir="ltr"
                  inputMode="numeric"
                  className="flex-1 text-[12px] bg-surface border border-border rounded-lg px-2 py-2 outline-none min-w-0"
                />
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={lines.length <= 1}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer disabled:opacity-30 shrink-0"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !valid}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ذخیره..." : "ذخیره فرمول"}
        </button>
      </form>
    </Modal>
  );
}
