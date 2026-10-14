"use client";

export type ShippingProfileValue = { uniqueId: string; nationalId: string; postalCode: string; postalAddress: string };

const inputClass = "w-full text-[12.5px] outline-none bg-white border border-border rounded-lg px-3 py-2";
const labelClass = "text-[11px] text-muted mb-1 block";

/**
 * پروفایل ارسال بار مشتری (برای بارنامه — ماژول اعلام بار): شناسه یکتا، کد ملی (یا شناسه ملی شرکت)، کد پستی، آدرس پستی.
 * همه اختیاری؛ داخل بخش «جزئیات بیشتر» فرم مخاطب نمایش داده می‌شود.
 */
export function ShippingProfileFields({
  value,
  onChange,
  showNational = true,
  company = false,
}: {
  value: ShippingProfileValue;
  onChange: (v: ShippingProfileValue) => void;
  showNational?: boolean;
  company?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[11.5px] font-bold text-ink-soft">اطلاعات ارسال بار (برای بارنامه)</div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={labelClass}>شناسه یکتا</label>
          <input value={value.uniqueId} onChange={(e) => onChange({ ...value, uniqueId: e.target.value })} dir="ltr" className={inputClass} />
        </div>
        {showNational ? (
          <div>
            <label className={labelClass}>{company ? "شناسه ملی" : "کد ملی"}</label>
            <input value={value.nationalId} onChange={(e) => onChange({ ...value, nationalId: e.target.value })} dir="ltr" className={inputClass} />
          </div>
        ) : null}
        <div>
          <label className={labelClass}>کد پستی</label>
          <input value={value.postalCode} onChange={(e) => onChange({ ...value, postalCode: e.target.value })} dir="ltr" className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>آدرس پستی</label>
        <input value={value.postalAddress} onChange={(e) => onChange({ ...value, postalAddress: e.target.value })} className={inputClass} />
      </div>
    </div>
  );
}
