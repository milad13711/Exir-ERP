"use client";

import { use, useEffect, useState } from "react";
import { CheckIcon, CloseIcon, LogoMark } from "@/components/icons";
import { toPersianDigits, formatJalaliDate } from "@/lib/persian";
import { verifyLetterPublic, type PublicVerify } from "@/lib/correspondence-api";

/** صحت‌سنجی عمومی نامه با QR — فقط شماره/تاریخ/امضاکننده/سازمان؛ هیچ محتوایی نشان داده نمی‌شود. */
export default function CorrespondenceVerifyPage({ params }: { params: Promise<{ ref: string; token: string }> }) {
  const { ref, token } = use(params);
  const [r, setR] = useState<PublicVerify | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    verifyLetterPublic(ref, token).then(setR).catch((e) => setError(e instanceof Error ? e.message : "بررسی ناموفق بود"));
  }, [ref, token]);

  const ok = r?.valid === true;
  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[520px] mx-auto flex items-center gap-2.5 px-5 py-4">
          <LogoMark className="w-9 h-9" />
          <div className="text-[15px] font-extrabold">صحت‌سنجی نامه</div>
        </div>
      </div>
      <div className="max-w-[520px] w-full mx-auto p-5">
        {error ? <div className="rounded-2xl bg-danger-soft text-danger p-4 text-[13px]" role="alert">{error}</div> : null}
        {!r && !error ? <div className="text-center text-muted py-16 text-[13px]">در حال بررسی…</div> : null}
        {r ? (
          <div className="bg-white border border-border rounded-2xl p-5 text-center space-y-3">
            <div className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center ${ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
              {ok ? <CheckIcon className="w-7 h-7" /> : <CloseIcon className="w-7 h-7" />}
            </div>
            <h1 className="text-[16px] font-extrabold">
              {ok ? "این نامه معتبر است" : r.status === "VOID" ? "این نامه باطل شده است" : "نامه‌ای با این مشخصات یافت نشد"}
            </h1>
            {r.letterNumber ? (
              <dl className="text-[13px] text-start space-y-2 mt-2">
                <div className="flex justify-between gap-3"><dt className="text-muted">شماره‌ی نامه</dt><dd dir="ltr" className="font-bold break-all">{toPersianDigits(r.letterNumber)}</dd></div>
                {r.date ? <div className="flex justify-between gap-3"><dt className="text-muted">تاریخ</dt><dd>{formatJalaliDate(r.date)}</dd></div> : null}
                {r.signerName ? <div className="flex justify-between gap-3"><dt className="text-muted">امضاکننده</dt><dd>{r.signerName}</dd></div> : null}
                {r.issuerOrg ? <div className="flex justify-between gap-3"><dt className="text-muted">سازمان</dt><dd>{r.issuerOrg}</dd></div> : null}
              </dl>
            ) : <p className="text-[12.5px] text-muted">لینک یا کد QR ممکن است ناقص باشد.</p>}
            <p className="text-[11.5px] text-muted">برای حفظ محرمانگی، محتوای نامه در این صفحه نمایش داده نمی‌شود.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
