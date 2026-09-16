"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { fetchCrmContacts, createRationSample, ApiError, type CrmContact } from "@/lib/api";

type CurrentLine = { ingredientName: string; quantityPerAnimalKg: string; unitCostSnapshot: string };

function todayIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function NewRationSamplePage() {
  const router = useRouter();
  const [contactQuery, setContactQuery] = useState("");
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<CrmContact | null>(null);

  const [collectedDate, setCollectedDate] = useState(todayIsoDate());
  const [herdSize, setHerdSize] = useState("");
  const [totalHerdMilkYieldLiters, setTotalHerdMilkYieldLiters] = useState("");
  const [avgMilkYieldPerAnimalLiters, setAvgMilkYieldPerAnimalLiters] = useState("");
  const [milkFatPercent, setMilkFatPercent] = useState("");
  const [milkProteinPercent, setMilkProteinPercent] = useState("");
  const [currentRationDescription, setCurrentRationDescription] = useState("");
  const [lines, setLines] = useState<CurrentLine[]>([{ ingredientName: "", quantityPerAnimalKg: "", unitCostSnapshot: "" }]);
  const [analysisFeeAmount, setAnalysisFeeAmount] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [isIdentityVisibleToLab, setIsIdentityVisibleToLab] = useState(true);
  const [signature, setSignature] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (contactQuery.trim().length < 2) {
      setContacts([]);
      return;
    }
    const t = setTimeout(() => {
      fetchCrmContacts(contactQuery.trim()).then(setContacts).catch(() => setContacts([]));
    }, 300);
    return () => clearTimeout(t);
  }, [contactQuery]);

  function updateLine(i: number, patch: Partial<CurrentLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleSubmit() {
    setError(null);
    if (!selectedContact) return setError("دامدار را انتخاب کنید");
    if (!signature) return setError("امضای رضایت دامدار لازم است");

    setSubmitting(true);
    try {
      const validLines = lines.filter((l) => l.ingredientName.trim() && l.quantityPerAnimalKg && l.unitCostSnapshot);
      const sample = await createRationSample({
        contactId: selectedContact.id,
        collectedAt: new Date(`${collectedDate}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
        herdSize: herdSize ? Number(herdSize) : undefined,
        totalHerdMilkYieldLiters: totalHerdMilkYieldLiters ? Number(totalHerdMilkYieldLiters) : undefined,
        avgMilkYieldPerAnimalLiters: avgMilkYieldPerAnimalLiters ? Number(avgMilkYieldPerAnimalLiters) : undefined,
        milkFatPercent: milkFatPercent ? Number(milkFatPercent) : undefined,
        milkProteinPercent: milkProteinPercent ? Number(milkProteinPercent) : undefined,
        currentRationDescription: currentRationDescription || undefined,
        currentLines: validLines.length
          ? validLines.map((l) => ({
              ingredientName: l.ingredientName,
              quantityPerAnimalKg: Number(l.quantityPerAnimalKg),
              unitCostSnapshot: Number(l.unitCostSnapshot),
            }))
          : undefined,
        consentSignatureDataUrl: signature,
        analysisFeeAmount: analysisFeeAmount ? Number(analysisFeeAmount) : undefined,
        discountCode: discountCode || undefined,
        isIdentityVisibleToLab,
      });
      router.push(`/ration-lab/${sample.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت نمونه با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-5 lg:p-7 max-w-[720px] mx-auto">
      <h1 className="text-xl font-extrabold">ثبت نمونه‌ی جدید</h1>
      <p className="text-[13.5px] text-muted mt-1">نمونه‌برداری از جیره‌ی یک دامدار برای ارسال به آزمایشگاه</p>

      <Card className="mt-6 p-5 flex flex-col gap-5">
        <div>
          <label className="block text-[13px] font-semibold mb-2">دامدار (مخاطب)</label>
          {selectedContact ? (
            <div className="flex items-center justify-between bg-primary-soft rounded-xl px-4 py-3">
              <div>
                <div className="text-[13px] font-bold">{selectedContact.name}</div>
                {selectedContact.phone ? <div className="text-[11.5px] text-muted" dir="ltr">{selectedContact.phone}</div> : null}
              </div>
              <button type="button" onClick={() => setSelectedContact(null)} className="text-[12px] font-bold text-primary">
                تغییر
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                value={contactQuery}
                onChange={(e) => setContactQuery(e.target.value)}
                placeholder="نام یا شماره تماس دامدار را جست‌وجو کنید"
                className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
              />
              {contacts.length > 0 ? (
                <div className="absolute z-10 mt-1 w-full bg-surface border border-border rounded-xl shadow-lg overflow-hidden">
                  {contacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedContact(c);
                        setContacts([]);
                        setContactQuery("");
                      }}
                      className="w-full text-right px-4 py-2.5 hover:bg-slate-50 text-[13px] border-b border-border last:border-b-0"
                    >
                      {c.name} {c.phone ? <span className="text-muted text-[11.5px]" dir="ltr">— {c.phone}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div>
          <label className="block text-[13px] font-semibold mb-2">تاریخ نمونه‌برداری</label>
          <JalaliDateInput value={collectedDate} onChange={setCollectedDate} />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="تعداد دام گله" value={herdSize} onChange={setHerdSize} />
          <Field label="میزان کل شیر گله (لیتر)" value={totalHerdMilkYieldLiters} onChange={setTotalHerdMilkYieldLiters} />
          <Field label="میانگین شیر هر راس (لیتر)" value={avgMilkYieldPerAnimalLiters} onChange={setAvgMilkYieldPerAnimalLiters} />
          <Field label="درصد چربی شیر" value={milkFatPercent} onChange={setMilkFatPercent} />
          <Field label="درصد پروتئین شیر" value={milkProteinPercent} onChange={setMilkProteinPercent} />
        </div>

        <div>
          <label className="block text-[13px] font-semibold mb-2">توضیح جیره‌ی فعلی</label>
          <textarea
            value={currentRationDescription}
            onChange={(e) => setCurrentRationDescription(e.target.value)}
            rows={3}
            className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[13px] font-semibold">خطوط جیره‌ی فعلی (اختیاری)</label>
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, { ingredientName: "", quantityPerAnimalKg: "", unitCostSnapshot: "" }])}
              className="text-[12px] font-bold text-primary"
            >
              + افزودن ماده
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_100px_120px_auto] gap-2">
                <input
                  placeholder="نام ماده"
                  value={l.ingredientName}
                  onChange={(e) => updateLine(i, { ingredientName: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-border text-[12.5px]"
                />
                <input
                  placeholder="کیلو/دام"
                  value={l.quantityPerAnimalKg}
                  onChange={(e) => updateLine(i, { quantityPerAnimalKg: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-border text-[12.5px]"
                  dir="ltr"
                />
                <input
                  placeholder="قیمت هر کیلو"
                  value={l.unitCostSnapshot}
                  onChange={(e) => updateLine(i, { unitCostSnapshot: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-border text-[12.5px]"
                  dir="ltr"
                />
                <button type="button" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} className="text-danger text-[12px] font-bold">
                  حذف
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="هزینه‌ی آنالیز (تومان)" value={analysisFeeAmount} onChange={setAnalysisFeeAmount} />
          <div>
            <label className="block text-[13px] font-semibold mb-2">کد تخفیف</label>
            <input
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
              dir="ltr"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer">
          <input type="checkbox" checked={isIdentityVisibleToLab} onChange={(e) => setIsIdentityVisibleToLab(e.target.checked)} />
          نام و شماره‌ی دامدار برای آزمایشگاه نمایش داده شود
        </label>

        <div>
          <label className="block text-[13px] font-semibold mb-2">امضای رضایت دامدار</label>
          <p className="text-[11.5px] text-muted mb-2">
            با امضا، دامدار می‌پذیرد که برای آنالیز جیره، نمونه با آگاهی کامل ارائه شده است.
          </p>
          {signature ? (
            <div className="flex items-center gap-3">
              <img src={signature} alt="امضا" className="h-16 border border-border rounded-xl bg-slate-50" />
              <button type="button" onClick={() => setSignature(null)} className="text-[12px] font-bold text-primary">
                امضای دوباره
              </button>
            </div>
          ) : (
            <SignaturePad onDone={setSignature} />
          )}
        </div>

        {error ? <div className="text-[13px] text-danger font-semibold">{error}</div> : null}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3.5 rounded-2xl bg-primary text-white text-[14px] font-bold disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "ثبت نمونه"}
        </button>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold mb-2">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
      />
    </div>
  );
}
