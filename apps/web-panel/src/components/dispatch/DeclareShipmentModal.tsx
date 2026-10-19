"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { ContactCombobox } from "@/components/shared/ContactCombobox";
import { fetchCrmContact } from "@/lib/api";
import { declareDispatch, fetchDispatchDrivers, fetchDispatchPrefill, type DispatchDriver, type DispatchPrefill, type DispatchSourceType } from "@/lib/dispatch-api";
import { toPersianDigits } from "@/lib/persian";
import { BTN_PRIMARY, INPUT, LABEL, errText } from "./dispatch-ui";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** «اعلام بار» — فرم پیش‌پر از منبع (فاکتور/دستور تولید/حواله) یا دستی؛ یک‌کلیک تا ساخت بار. */
export function DeclareShipmentModal({
  source,
  onClose,
  onCreated,
}: {
  source?: { type: Exclude<DispatchSourceType, "MANUAL">; id: string };
  onClose: () => void;
  onCreated?: (shipmentId: string) => void;
}) {
  const router = useRouter();
  const [pre, setPre] = useState<DispatchPrefill | null>(null);
  const [loading, setLoading] = useState(!!source);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);

  const [contactId, setContactId] = useState("");
  const [cargoType, setCargoType] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("کیلوگرم");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [region, setRegion] = useState("");
  const [pickupAt, setPickupAt] = useState(() => toLocalInput(new Date(Date.now() + 2 * 3600 * 1000).toISOString()));
  const [driverId, setDriverId] = useState("");
  const [needsWeighing, setNeedsWeighing] = useState(false);
  const [weighLineIds, setWeighLineIds] = useState<string[]>([]);
  const [kgPerUnit, setKgPerUnit] = useState("1");
  const [profile, setProfile] = useState({ uniqueId: "", nationalId: "", postalCode: "", postalAddress: "" });
  const [saveToProfile, setSaveToProfile] = useState(false);

  useEffect(() => {
    fetchDispatchDrivers().then(setDrivers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!source) return;
    fetchDispatchPrefill(source.type, source.id)
      .then((p) => {
        setPre(p);
        setContactId(p.contactId ?? "");
        setCargoType(p.cargoType);
        setQuantity(String(p.quantity));
        setUnit(p.unit);
        setDeliveryAddress(p.deliveryAddress);
        setRegion(p.region);
        setPickupAt(toLocalInput(p.pickupAt));
        setProfile({ uniqueId: p.profile.uniqueId ?? "", nationalId: p.profile.nationalId ?? "", postalCode: p.profile.postalCode ?? "", postalAddress: p.profile.postalAddress ?? "" });
        setWeighLineIds(p.invoice?.lines.map((l) => l.id) ?? []);
        setSaveToProfile(p.missingProfile.length > 0 && !!p.contactId);
      })
      .catch((e) => setError(errText(e, "بارگذاری اطلاعات منبع ناموفق بود")))
      .finally(() => setLoading(false));
  }, [source]);

  const isInvoiceDraft = pre?.invoice?.status === "DRAFT";
  const contactKnown = !!contactId;
  const profileDirty =
    !!pre &&
    (profile.uniqueId !== (pre.profile.uniqueId ?? "") || profile.nationalId !== (pre.profile.nationalId ?? "") || profile.postalCode !== (pre.profile.postalCode ?? "") || profile.postalAddress !== (pre.profile.postalAddress ?? ""));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cargoType.trim() || !Number(quantity) || deliveryAddress.trim().length < 2 || !pickupAt) return;
    setSaving(true);
    setError(null);
    try {
      const r = await declareDispatch({
        sourceType: source?.type ?? "MANUAL",
        sourceId: source?.id,
        contactId: contactId || undefined,
        cargoType: cargoType.trim(),
        quantity: Math.round(Number(quantity)),
        unit: unit.trim() || undefined,
        deliveryAddress: deliveryAddress.trim(),
        region: region.trim() || undefined,
        pickupAt: new Date(pickupAt).toISOString(),
        needsWeighing: needsWeighing || undefined,
        weighLineIds: needsWeighing ? weighLineIds : undefined,
        kgPerUnit: needsWeighing ? Number(kgPerUnit) || 1 : undefined,
        driverId: driverId || undefined,
        profile,
        saveToProfile: saveToProfile && contactKnown ? true : undefined,
      });
      onCreated?.(r.shipment.id);
      router.push(`/dispatch/${r.shipment.id}`);
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={source ? `اعلام بار — ${pre?.reference ?? ""}` : "اعلام بار جدید"} onClose={onClose} width="max-w-[560px]">
      {loading ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : pre?.existing ? (
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="bg-warning-soft rounded-xl p-3">برای این منبع قبلاً بار #{toPersianDigits(pre.existing.shipmentNo ?? 0)} ثبت شده است (از تکرار جلوگیری شد).</div>
          <button type="button" onClick={() => router.push(`/dispatch/${pre.existing!.id}`)} className={BTN_PRIMARY}>
            رفتن به همان بار
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          {!source ? (
            <div>
              <label className={LABEL}>مشتری (اختیاری)</label>
              <ContactCombobox
                value={contactId}
                source="customer"
                allowCreate={false}
                placeholder="بدون مشتری — جستجوی مشتری"
                onChange={(id) => {
                  setContactId(id);
                  if (!id) return;
                  fetchCrmContact(id)
                    .then((c) => {
                      setProfile({ uniqueId: c.uniqueId ?? "", nationalId: (c.type === "COMPANY" ? c.legalId : c.nationalId) ?? "", postalCode: c.postalCode ?? "", postalAddress: c.postalAddress ?? c.address ?? "" });
                      const addr = c.postalAddress ?? c.address;
                      if (addr) setDeliveryAddress((cur) => cur || addr);
                    })
                    .catch(() => {});
                }}
              />
            </div>
          ) : pre?.contactName ? (
            <div className="text-[12.5px]">مشتری: <b>{pre.contactName}</b></div>
          ) : null}

          <div className="grid grid-cols-3 gap-2.5">
            <div className="col-span-2">
              <label className={LABEL}>نوع بار</label>
              <input value={cargoType} onChange={(e) => setCargoType(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>واحد</label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} className={INPUT} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={LABEL}>مقدار اعلامی</label>
              <input value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ""))} dir="ltr" inputMode="numeric" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>منطقه</label>
              <input value={region} onChange={(e) => setRegion(e.target.value)} className={INPUT} placeholder="برای تطبیق راننده و قانون اسناد" />
            </div>
          </div>
          <div>
            <label className={LABEL}>آدرس تحویل</label>
            <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>زمان بارگیری</label>
            <JalaliDateTimeInput value={pickupAt} onChange={setPickupAt} />
          </div>
          <div>
            <label className={LABEL}>راننده (اختیاری — بعداً هم می‌شود)</label>
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={INPUT}>
              <option value="">در انتظار راننده</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.plateNumber ? ` — ${d.plateNumber}` : ""}
                </option>
              ))}
            </select>
          </div>

          <details className="text-[12.5px] bg-slate-50 border border-border rounded-xl p-3" open={!!pre && pre.missingProfile.length > 0}>
            <summary className="cursor-pointer text-primary font-bold">اطلاعات بارنامه (شناسه یکتا، کد ملی، کد پستی، آدرس پستی)</summary>
            <div className="grid grid-cols-2 gap-2.5 mt-3">
              <div><label className={LABEL}>شناسه یکتا</label><input value={profile.uniqueId} onChange={(e) => setProfile({ ...profile, uniqueId: e.target.value })} dir="ltr" className={INPUT} /></div>
              <div><label className={LABEL}>کد ملی / شناسه ملی</label><input value={profile.nationalId} onChange={(e) => setProfile({ ...profile, nationalId: e.target.value })} dir="ltr" className={INPUT} /></div>
              <div><label className={LABEL}>کد پستی</label><input value={profile.postalCode} onChange={(e) => setProfile({ ...profile, postalCode: e.target.value })} dir="ltr" className={INPUT} /></div>
              <div className="col-span-2"><label className={LABEL}>آدرس پستی</label><input value={profile.postalAddress} onChange={(e) => setProfile({ ...profile, postalAddress: e.target.value })} className={INPUT} /></div>
            </div>
            {pre && pre.missingProfile.length > 0 ? <div className="text-[11.5px] text-warning mt-2">برخی اطلاعات در پروفایل مشتری ثبت نشده است.</div> : null}
            {contactKnown && (profileDirty || (pre?.missingProfile.length ?? 0) > 0 || !source) ? (
              <label className="flex items-center gap-2 mt-2 cursor-pointer text-[12px] font-bold">
                <input type="checkbox" checked={saveToProfile} onChange={(e) => setSaveToProfile(e.target.checked)} className="w-4 h-4" />
                ذخیره در پروفایل مشتری
              </label>
            ) : null}
          </details>

          {(!source || source.type !== "SALES_INVOICE" || isInvoiceDraft) ? (
            <div className="bg-slate-50 border border-border rounded-xl p-3 flex flex-col gap-2.5">
              <label className="flex items-center gap-2 text-[12.5px] font-bold cursor-pointer">
                <input type="checkbox" checked={needsWeighing} onChange={(e) => setNeedsWeighing(e.target.checked)} className="w-4 h-4" />
                نیاز به وزن‌کشی
              </label>
              {needsWeighing ? (
                <>
                  <div className="text-[11.5px] text-muted leading-relaxed">
                    {source?.type === "SALES_INVOICE"
                      ? "نهایی‌کردن فاکتور تا تأیید وزن نهایی مسدود می‌شود؛ پس از تأیید، اقلام فاکتور بر اساس وزن واقعی تعدیل و (با تأیید مدیر/حسابدار) فاکتور خودکار نهایی و سند حسابداری ثبت می‌شود."
                      : "تأیید وزن نهایی پیش از «آماده حرکت» الزامی می‌شود."}
                  </div>
                  {pre?.invoice ? (
                    <>
                      <div className="text-[12px] font-bold">ردیف‌هایی که مقدارشان وزنی است:</div>
                      {pre.invoice.lines.map((l) => (
                        <label key={l.id} className="flex items-center gap-2 text-[12.5px] cursor-pointer">
                          <input type="checkbox" checked={weighLineIds.includes(l.id)} onChange={(e) => setWeighLineIds(e.target.checked ? [...weighLineIds, l.id] : weighLineIds.filter((x) => x !== l.id))} className="w-4 h-4" />
                          {l.description} ({toPersianDigits(l.quantity)})
                        </label>
                      ))}
                      <div>
                        <label className={LABEL}>هر واحد ردیف فاکتور چند کیلوگرم است؟ (کیلویی = ۱)</label>
                        <input value={kgPerUnit} onChange={(e) => setKgPerUnit(e.target.value.replace(/[^\d.]/g, ""))} dir="ltr" className={INPUT} />
                      </div>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}
          <button type="submit" disabled={saving || !cargoType.trim() || !Number(quantity) || deliveryAddress.trim().length < 2 || !pickupAt} className={`${BTN_PRIMARY} !py-3`}>
            {saving ? "در حال ثبت..." : "ثبت اعلام بار"}
          </button>
        </form>
      )}
    </Modal>
  );
}
