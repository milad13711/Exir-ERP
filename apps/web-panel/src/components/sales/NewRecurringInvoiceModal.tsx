import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { TrashIcon, PlusIcon } from "@/components/icons";
import {
  fetchCrmContacts,
  fetchProducts,
  createRecurringInvoice,
  ApiError,
  type CrmContact,
  type Product,
  type RecurringInvoiceDetail,
  type RecurrenceFrequency,
} from "@/lib/api";

type DraftLine = { productId: string; description: string; quantity: string; unitPrice: string };

function emptyLine(): DraftLine {
  return { productId: "", description: "", quantity: "1", unitPrice: "" };
}

const FREQUENCY_OPTIONS: Array<{ value: RecurrenceFrequency; label: string }> = [
  { value: "WEEKLY", label: "هفتگی" },
  { value: "MONTHLY", label: "ماهانه" },
  { value: "QUARTERLY", label: "فصلی" },
  { value: "YEARLY", label: "سالانه" },
];

export function NewRecurringInvoiceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (template: RecurringInvoiceDetail) => void;
}) {
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [contactId, setContactId] = useState("");
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("MONTHLY");
  const [intervalCount, setIntervalCount] = useState("1");
  const [nextRunAt, setNextRunAt] = useState("");
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCrmContacts().then(setContacts).catch(() => setContacts([]));
    fetchProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function handleProductPick(i: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    updateLine(i, { productId, description: product?.name ?? "", unitPrice: product ? String(product.salePrice) : "" });
  }

  const subtotal = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const discountNum = Number(discount) || 0;
  const total = Math.max(0, subtotal - discountNum);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validLines = lines.filter((l) => l.description.trim() && Number(l.quantity) > 0);
    if (!contactId || !nextRunAt || validLines.length === 0) return;
    setSubmitting(true);
    try {
      const template = await createRecurringInvoice({
        contactId,
        frequency,
        intervalCount: Number(intervalCount) || 1,
        nextRunAt,
        discount: discountNum || undefined,
        notes: notes.trim() || undefined,
        lines: validLines.map((l) => ({
          productId: l.productId || undefined,
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice) || 0,
        })),
      });
      onCreated(template);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="فاکتور تکرارشونده جدید" onClose={onClose} width="max-w-[640px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">مشتری</label>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            required
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          >
            <option value="">انتخاب مشتری...</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company || c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">تناوب</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            >
              {FREQUENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-24">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">هر چند دوره</label>
            <input
              value={intervalCount}
              onChange={(e) => setIntervalCount(e.target.value.replace(/[^0-9]/g, ""))}
              dir="ltr"
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 text-center"
            />
          </div>
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">اولین صدور</label>
            <JalaliDateInput value={nextRunAt} onChange={setNextRunAt} />
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">اقلام فاکتور</label>
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
                  value={line.unitPrice}
                  onChange={(e) => updateLine(i, { unitPrice: e.target.value.replace(/[^0-9]/g, "") })}
                  placeholder="قیمت واحد (تومان)"
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

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">تخفیف (تومان)</label>
            <input
              value={discount}
              onChange={(e) => setDiscount(e.target.value.replace(/[^0-9]/g, ""))}
              dir="ltr"
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
              placeholder="۰"
            />
          </div>
          <div className="flex-1 text-left">
            <div className="text-[11.5px] text-muted">مبلغ هر دوره</div>
            <div className="text-[16px] font-extrabold mt-1">{total.toLocaleString("en-US")} تومان</div>
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">یادداشت (اختیاری)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 resize-none"
          />
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button
          type="submit"
          disabled={submitting || !contactId || !nextRunAt}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "ثبت الگوی تکرارشونده"}
        </button>
      </form>
    </Modal>
  );
}
