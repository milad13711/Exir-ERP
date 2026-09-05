import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { createShipment, fetchCrmContacts, type CrmContact } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewShipmentModal({
  onClose,
  onCreated,
  prefill,
}: {
  onClose: () => void;
  onCreated: () => void;
  prefill?: {
    contactId?: string;
    cargoType?: string;
    quantity?: number;
    deliveryAddress?: string;
    sourceType?: "STOCK_MOVEMENT" | "SALES_INVOICE";
    sourceStockMovementId?: string;
    sourceInvoiceId?: string;
  };
}) {
  const [contactId, setContactId] = useState(prefill?.contactId ?? "");
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [cargoType, setCargoType] = useState(prefill?.cargoType ?? "");
  const [quantity, setQuantity] = useState(prefill?.quantity?.toString() ?? "");
  const [unit, setUnit] = useState("کیلوگرم");
  const [deliveryAddress, setDeliveryAddress] = useState(prefill?.deliveryAddress ?? "");
  const [region, setRegion] = useState("");
  const [pickupAt, setPickupAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCrmContacts().then(setContacts).catch(() => setContacts([]));
  }, []);

  function pickContact(id: string) {
    setContactId(id);
    const c = contacts.find((x) => x.id === id);
    if (c?.address && !deliveryAddress) setDeliveryAddress(c.address);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cargoType.trim() || !quantity || !deliveryAddress.trim() || !pickupAt) return;
    setSaving(true);
    setError(null);
    try {
      await createShipment({
        sourceType: prefill?.sourceType,
        sourceStockMovementId: prefill?.sourceStockMovementId,
        sourceInvoiceId: prefill?.sourceInvoiceId,
        contactId: contactId || undefined,
        cargoType: cargoType.trim(),
        quantity: Number(quantity),
        unit: unit.trim() || undefined,
        deliveryAddress: deliveryAddress.trim(),
        region: region.trim() || undefined,
        pickupAt: new Date(pickupAt).toISOString(),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت بار ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="ثبت بار جدید" onClose={onClose} width="max-w-[520px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>مشتری/گیرنده (اختیاری)</label>
          <select value={contactId} onChange={(e) => pickContact(e.target.value)} className={inputClass}>
            <option value="">بدون مخاطب</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` (${c.company})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>نوع بار</label>
            <input value={cargoType} onChange={(e) => setCargoType(e.target.value)} className={inputClass} />
          </div>
          <div className="w-[110px]">
            <label className={labelClass}>مقدار</label>
            <input value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={inputClass} />
          </div>
          <div className="w-[110px]">
            <label className={labelClass}>واحد</label>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div>
          <label className={labelClass}>آدرس تحویل</label>
          <textarea value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} rows={2} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>محدوده (برای تطبیق با راننده — اختیاری)</label>
          <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="مثلاً تهران" className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>تاریخ و ساعت بارگیری</label>
          <JalaliDateTimeInput value={pickupAt} onChange={setPickupAt} className={inputClass} />
        </div>

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <button
          type="submit"
          disabled={saving || !cargoType.trim() || !quantity || !deliveryAddress.trim() || !pickupAt}
          className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50"
        >
          {saving ? "در حال ثبت..." : "ثبت بار"}
        </button>
      </form>
    </Modal>
  );
}
