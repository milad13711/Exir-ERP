"use client";

import { use, useEffect, useState } from "react";
import { LogoMark, TruckIcon, CheckIcon } from "@/components/icons";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { collectSignatureEvidence } from "@/lib/signature-evidence";
import { toPersianDigits, formatJalaliDateTime } from "@/lib/persian";
import { ApiError } from "@/lib/api";
import { signPublicReceipt, viewPublicReceipt, type PublicReceiptView } from "@/lib/dispatch-api";

const kg = (n: number | null) => (n == null ? "—" : `${toPersianDigits(n.toLocaleString("en-US", { maximumFractionDigits: 3 }))} کیلوگرم`);

/** رسید بار راننده — بدون ورود؛ فقط لینک یکتای پیامکی. موبایل‌محور. */
export default function DispatchReceiptPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);
  const [view, setView] = useState<PublicReceiptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    viewPublicReceipt(slug, token)
      .then(setView)
      .catch((e) => setError(e instanceof ApiError ? e.message : "این لینک معتبر نیست"));
  }, [slug, token]);

  async function submit() {
    if (!signature || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const evidence = await collectSignatureEvidence({ askLocation: true });
      await signPublicReceipt(slug, token, { signatureData: signature, confirmed: true, evidence });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ثبت رسید ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const full = view && view.status !== "not_ready" ? view : null;

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[520px] mx-auto flex items-center gap-2.5 px-5 py-4">
          <LogoMark className="w-9 h-9" />
          <span className="font-extrabold">رسید بار</span>
        </div>
      </div>
      <div className="flex-1 flex items-start justify-center px-4 py-6">
        <div className="w-full max-w-[480px] flex flex-col gap-4">
          {error ? <div className="text-[13px] text-danger font-semibold text-center bg-danger-soft rounded-2xl p-4">{error}</div> : null}
          {!error && !view ? <div className="text-center text-muted text-sm py-10">در حال بارگذاری...</div> : null}

          {view?.status === "not_ready" ? (
            <div className="bg-white border border-border rounded-2xl p-6 text-center">
              <div className="text-[15px] font-bold mb-2">بار شماره {toPersianDigits(view.shipmentNo)} هنوز آماده‌ی حرکت نیست</div>
              <div className="text-[13px] text-muted leading-relaxed">پس از صدور مجوز آماده حرکت توسط انبار، همین لینک را دوباره باز کنید.</div>
            </div>
          ) : null}

          {full && (done || full.status === "signed") ? (
            <div className="bg-success-soft rounded-2xl p-6 text-center">
              <CheckIcon className="w-8 h-8 text-success mx-auto mb-2" />
              <div className="text-[15px] font-bold text-success mb-1">رسید شما ثبت شد</div>
              <div className="text-[13px] text-ink-soft">{full.signedAt ? formatJalaliDateTime(full.signedAt) : ""} — سفر بخیر.</div>
            </div>
          ) : null}

          {full && !done && full.status === "pending" ? (
            <>
              <div className="bg-white border border-border rounded-2xl p-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                    <TruckIcon className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <div className="text-[14px] font-bold">{full.cargoType}</div>
                    <div className="text-[11.5px] text-muted">بار شماره {toPersianDigits(full.shipmentNo)} — {full.orgName}</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2.5">
                  {[
                    ["وزن خالی", full.tareKg],
                    ["وزن پر", full.grossKg],
                    ["وزن خالص", full.netKg],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="bg-slate-50 rounded-xl p-2.5 text-center">
                      <div className="text-[10.5px] text-muted mb-0.5">{k}</div>
                      <div className="text-[12px] font-extrabold">{kg(v as number | null)}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-1.5 text-[12.5px]">
                  <div>مشتری: <b>{full.customerName ?? "—"}</b></div>
                  <div>آدرس: <b>{full.postalAddress ?? "—"}</b></div>
                  <div>راننده: <b>{full.driverName ?? "—"}</b>{full.plateNumber ? ` — پلاک ${full.plateNumber}` : ""}</div>
                  <div>مقدار اعلامی: <b>{full.quantityText}</b></div>
                </div>
              </div>

              <label className="flex items-start gap-2.5 bg-white border border-border rounded-2xl p-4 text-[13.5px] font-bold cursor-pointer">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="w-5 h-5 mt-0.5" />
                <span>{full.statement}</span>
              </label>

              {confirmed ? (
                signature ? (
                  <div className="bg-white border border-border rounded-2xl p-4 flex flex-col gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={signature} alt="امضا" className="max-h-28 mx-auto" />
                    <button onClick={() => setSignature(null)} className="text-[12px] font-bold text-ink-soft cursor-pointer">امضای دوباره</button>
                    <button onClick={submit} disabled={busy} className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold disabled:opacity-50">
                      {busy ? "در حال ثبت..." : "ثبت نهایی رسید"}
                    </button>
                  </div>
                ) : (
                  <div className="bg-white border border-border rounded-2xl p-4">
                    <div className="text-[12.5px] font-bold mb-2">امضای خود را بکشید</div>
                    <SignaturePad onDone={setSignature} />
                  </div>
                )
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
