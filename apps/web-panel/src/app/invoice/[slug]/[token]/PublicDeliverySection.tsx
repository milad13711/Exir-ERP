"use client";

import { useState } from "react";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { SignatureConsentNotice } from "@/components/ui/SignatureConsentNotice";
import { toPersianDigits } from "@/lib/persian";
import { ApiError, confirmPublicDelivery, sendPublicDeliveryCode, type PublicDeliverySection as Section } from "@/lib/api";

/** «تأیید تحویل» روی صفحه‌ی عمومی فاکتور (فقط با ماژول امضای تحویل): کد پیامکی یا امضای الکترونیکی؛ مدرک دستگاه/زمان همان لحظه ثبت می‌شود. */
export function PublicDeliverySection({ tenantSlug, token, section }: { tenantSlug: string; token: string; section: Section }) {
  const [done, setDone] = useState(section.confirmed);
  const [method, setMethod] = useState<"CODE" | "SIGNATURE" | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="mt-5 border-t border-border pt-4">
        <div className="bg-success-soft text-success text-[13px] font-bold rounded-xl px-3.5 py-3">تحویل تأیید شد ✓</div>
      </div>
    );
  }
  if (!section.available) return null;

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () => run(async () => setSentTo((await sendPublicDeliveryCode(tenantSlug, token)).phoneMasked ?? ""));
  const confirmCode = () =>
    run(async () => {
      await confirmPublicDelivery(tenantSlug, token, { method: "CODE", code: code.trim(), confirmerName: name.trim() });
      setDone(true);
    });
  const confirmSignature = (dataUrl: string) =>
    run(async () => {
      await confirmPublicDelivery(tenantSlug, token, { method: "SIGNATURE", signatureDataUrl: dataUrl, confirmerName: name.trim(), consent: true });
      setDone(true);
    });

  const nameOk = name.trim().length >= 2;
  return (
    <div className="mt-5 border-t border-border pt-4 flex flex-col gap-3">
      <div className="text-[13px] font-bold">تأیید تحویل کالا</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام و نام‌خانوادگی تحویل‌گیرنده" maxLength={100} className="border border-border rounded-xl px-3.5 py-2.5 text-[13px] bg-white" />
      {method === null ? (
        <div className="flex gap-2 flex-wrap">
          {section.codeAvailable ? (
            <button disabled={!nameOk} onClick={() => setMethod("CODE")} className="flex-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50">با کد پیامکی</button>
          ) : null}
          <button disabled={!nameOk} onClick={() => setMethod("SIGNATURE")} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer disabled:opacity-50">با امضای الکترونیکی</button>
        </div>
      ) : method === "CODE" ? (
        <div className="flex flex-col gap-2">
          {sentTo === null ? (
            <button disabled={busy} onClick={sendCode} className="py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50">ارسال کد تحویل</button>
          ) : (
            <>
              <div className="text-[12px] text-muted">کد ۶ رقمی به شماره {sentTo ? toPersianDigits(sentTo) : "ثبت‌شده"} پیامک شد (۱۰ دقیقه اعتبار).</div>
              <SignatureConsentNotice className="w-full" />
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" dir="ltr" placeholder="------" className="border border-border rounded-xl px-3.5 py-2.5 text-[15px] text-center tracking-widest bg-white" />
              <button disabled={busy || code.length !== 6 || !nameOk} onClick={confirmCode} className="py-2.5 rounded-xl bg-success text-white text-[13px] font-bold cursor-pointer disabled:opacity-50">تأیید تحویل</button>
              <button disabled={busy} onClick={sendCode} className="text-[12px] text-ink-soft cursor-pointer">ارسال دوباره‌ی کد</button>
            </>
          )}
          <button onClick={() => setMethod(null)} className="text-[12px] text-muted cursor-pointer">بازگشت</button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <SignatureConsentNotice className="w-full" />
          <SignaturePad onDone={confirmSignature} onCancel={() => setMethod(null)} />
        </div>
      )}
      {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}
    </div>
  );
}
