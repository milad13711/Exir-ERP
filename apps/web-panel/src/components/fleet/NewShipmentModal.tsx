import { useState } from "react";
import { ContactCombobox } from "@/components/shared/ContactCombobox";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { createShipment, updateShipment, fetchCrmContact, type Shipment } from "@/lib/api";

/** ISO → مقدار محلی «YYYY-MM-DDTHH:mm» که JalaliDateTimeInput انتظار دارد. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewShipmentModal({
  onClose,
  onCreated,
  prefill,
  edit,
}: {
  /** حالت ویرایش بار پیش‌نویس */
  edit?: Shipment;
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
  const [contactId, setContactId] = useState(edit?.contactId ?? prefill?.contactId ?? "");
  const [cargoType, setCargoType] = useState(edit?.cargoType ?? prefill?.cargoType ?? "");
  const [quantity, setQuantity] = useState(edit?.quantity?.toString() ?? prefill?.quantity?.toString() ?? "");
  const [unit, setUnit] = useState(edit ? (edit.unit ?? "") : "کیلوگرم");
  const [deliveryAddress, setDeliveryAddress] = useState(edit?.deliveryAddress ?? prefill?.deliveryAddress ?? "");
  const [region, setRegion] = useState(edit?.region ?? "");
  const [pickupAt, setPickupAt] = useState(edit ? toLocalInput(edit.pickupAt) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickContact(id: string) {
    setContactId(id);
    if (!id) return;
    fetchCrmContact(id)
      .then((c) => {
        if (c.address) setDeliveryAddress((cur) => cur || c.address || "");
      })
      .catch(() => {});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cargoType.trim() || !quantity || !deliveryAddress.trim() || !pickupAt) return;
    setSaving(true);
    setError(null);
    try {
      if (edit) {
        await updateShipment(edit.id, {
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
        return;
      }
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
    <Modal title={edit ? `ویرایش بار شماره ${edit.shipmentNo}` : "ثبت بار جدید"} onClose={onClose} width="max-w-[520px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>مشتری/گیرنده (اختیاری)</label>
          <ContactCombobox
            value={contactId}
            onChange={(id) => pickContact(id)}
            source="customer"
            allowCreate={false}
            placeholder="بدون مخاطب — جستجوی مشتری/گیرنده"
          />
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
          {saving ? "در حال ثبت..." : edit ? "ذخیره‌ی تغییرات" : "ثبت بار"}
        </button>
      </form>
    </Modal>
  );
}
