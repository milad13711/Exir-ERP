"use client";

import { use, useEffect, useState } from "react";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { LogoMark, BriefcaseIcon } from "@/components/icons";
import { formatJalaliDate, formatToman } from "@/lib/persian";
import { fetchPublicJobOffer, respondToPublicJobOffer, ApiError, type PublicJobOfferView } from "@/lib/api";

export default function PublicJobOfferPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);
  const [offer, setOffer] = useState<PublicJobOfferView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsSeen, setTermsSeen] = useState(false);

  function reload() {
    fetchPublicJobOffer(slug, token)
      .then(setOffer)
      .catch((err) => setError(err instanceof ApiError ? err.message : "این لینک یافت نشد"));
  }
  useEffect(reload, [slug, token]);

  async function respond(accepted: boolean) {
    if (accepted && (!agreed || !signature)) {
      setError("ابتدا شرایط را تأیید کرده و امضا کنید");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await respondToPublicJobOffer(slug, token, accepted, signature ?? undefined);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت پاسخ ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[520px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center">
            <LogoMark className="w-5 h-5 text-primary" />
          </div>
          <span className="font-extrabold">شرایط همکاری</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[460px]">
          {!offer ? (
            <div className="text-center text-muted py-10">{error ?? "در حال بارگذاری..."}</div>
          ) : (
            <div className="bg-white border border-border rounded-2xl p-5">
              <div className="w-12 h-12 rounded-2xl bg-primary-soft flex items-center justify-center mb-4">
                <BriefcaseIcon className="w-6 h-6 text-primary" />
              </div>
              <div className="text-lg font-extrabold mb-1">{offer.applicantName} عزیز</div>
              <div className="text-[13px] text-ink-soft mb-5">شرایط همکاری زیر برای شما تعیین شده است.</div>

              <div className="border border-border rounded-xl overflow-hidden mb-5">
                <Row label="شرح وظایف" value={offer.jobDescription} />
                <Row label="نحوه‌ی همکاری" value={offer.collaborationType} />
                {offer.workingHours && <Row label="ساعت حضور روزانه در محل شرکت" value={offer.workingHours} />}
                <Row label="حقوق و دستمزد (ماهانه)" value={formatToman(offer.salary)} />
                {offer.benefits && <Row label="سایر تسهیلات" value={offer.benefits} />}
                <Row label="مدت همکاری" value={offer.durationMonths ? `${offer.durationMonths} ماه` : "نامحدود"} />
                {offer.startDate && <Row label="تاریخ شروع" value={formatJalaliDate(offer.startDate)} />}
              </div>

              {error && <div className="text-[13px] text-danger font-semibold text-center mb-3">{error}</div>}

              {offer.status === "SENT" && !signing && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSigning(true)}
                    className="flex-1 py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer"
                  >
                    مشاهده‌ی شرایط و تأیید
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm("آیا از عدم پذیرش شرایط همکاری مطمئن هستید؟")) respond(false);
                    }}
                    disabled={busy}
                    className="flex-1 py-3 rounded-xl bg-slate-100 text-ink-soft text-[13.5px] font-bold disabled:opacity-50 cursor-pointer"
                  >
                    عدم پذیرش
                  </button>
                </div>
              )}
              {offer.status === "SENT" && signing && (
                <div className="flex flex-col gap-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agreed}
                      disabled={!!offer.contractTerms && !termsSeen}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="w-4 h-4 mt-0.5 cursor-pointer disabled:opacity-40"
                    />
                    <span className="text-[12.5px] leading-6">
                      {offer.contractTerms ? (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              setTermsOpen(true);
                              setTermsSeen(true);
                            }}
                            className="text-primary font-bold underline cursor-pointer"
                          >
                            شرایط و قوانین همکاری{offer.contractTitle ? ` (${offer.contractTitle})` : ""}
                          </button>{" "}
                          را مطالعه کردم و می‌پذیرم.
                          {!termsSeen && <span className="block text-[11px] text-muted">برای فعال‌شدن تیک، ابتدا روی لینک بزنید و متن را ببینید.</span>}
                        </>
                      ) : (
                        "شرایط و قوانین همکاری را مطالعه کردم و می‌پذیرم."
                      )}
                    </span>
                  </label>
                  <div className="text-[12px] font-bold text-ink-soft">امضای الکترونیک شما</div>
                  {signature ? (
                    <div className="flex flex-col gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={signature} alt="امضای شما" className="w-full h-[100px] object-contain bg-slate-50 border border-border rounded-xl" />
                      <button onClick={() => setSignature(null)} className="text-[12px] font-bold text-ink-soft self-start cursor-pointer">
                        امضای مجدد
                      </button>
                    </div>
                  ) : (
                    <SignaturePad onDone={setSignature} onCancel={() => setSigning(false)} />
                  )}
                  <button
                    onClick={() => respond(true)}
                    disabled={busy || !agreed || !signature}
                    className="w-full py-3 rounded-xl bg-success text-white text-[13.5px] font-bold disabled:opacity-50 cursor-pointer"
                  >
                    تأیید
                  </button>
                </div>
              )}
              {offer.status === "ACCEPTED" && (
                <div className="text-[13px] text-success font-semibold text-center py-2 leading-7">
                  با تشکر از اعلام آمادگی شما، جهت تأیید نهایی شروع همکاری، مدارک و شرایط شما به مدیریت مجموعه ارجاع شد. با توجه به ظرفیت پذیرش مجموعه، نتیجه‌ی نهایی به‌صورت پیامکی به شما اطلاع‌رسانی خواهد شد.
                </div>
              )}
              {offer.status === "REJECTED" && (
                <div className="text-[13px] text-muted font-semibold text-center py-2">پاسخ شما ثبت شد. از وقتی که گذاشتید سپاسگزاریم.</div>
              )}
            </div>
          )}
        </div>
      </div>
      {termsOpen && offer?.contractTerms && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={() => setTermsOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-[520px] max-h-[85dvh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <span className="font-extrabold text-[14px]">{offer.contractTitle ?? "شرایط و قوانین همکاری"}</span>
              <button onClick={() => setTermsOpen(false)} className="text-[12.5px] font-bold text-ink-soft cursor-pointer">
                بستن
              </button>
            </div>
            <div className="px-5 py-4 overflow-y-auto text-[13px] leading-7 whitespace-pre-wrap">{offer.contractTerms}</div>
            <div className="px-5 py-3 border-t border-border">
              <button onClick={() => setTermsOpen(false)} className="w-full py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer">
                مطالعه کردم
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex border-b border-border last:border-b-0">
      <div className="w-[130px] shrink-0 bg-slate-50 text-[11.5px] font-bold text-muted px-3 py-2.5">{label}</div>
      <div className="flex-1 text-[12.5px] px-3 py-2.5 whitespace-pre-wrap">{value}</div>
    </div>
  );
}
