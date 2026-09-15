"use client";

import { use, useEffect, useState } from "react";
import { LogoMark, BriefcaseIcon } from "@/components/icons";
import { formatJalaliDate, formatToman } from "@/lib/persian";
import { fetchPublicJobOffer, respondToPublicJobOffer, ApiError, type PublicJobOfferView } from "@/lib/api";

export default function PublicJobOfferPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);
  const [offer, setOffer] = useState<PublicJobOfferView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    fetchPublicJobOffer(slug, token)
      .then(setOffer)
      .catch((err) => setError(err instanceof ApiError ? err.message : "این لینک یافت نشد"));
  }
  useEffect(reload, [slug, token]);

  async function respond(accepted: boolean) {
    setBusy(true);
    setError(null);
    try {
      await respondToPublicJobOffer(slug, token, accepted);
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
                {offer.workingHours && <Row label="ساعت حضور" value={offer.workingHours} />}
                <Row label="حقوق و دستمزد (ماهانه)" value={formatToman(offer.salary)} />
                {offer.benefits && <Row label="سایر تسهیلات" value={offer.benefits} />}
                <Row label="مدت همکاری" value={offer.durationMonths ? `${offer.durationMonths} ماه` : "نامحدود"} />
                {offer.startDate && <Row label="تاریخ شروع" value={formatJalaliDate(offer.startDate)} />}
              </div>

              {error && <div className="text-[13px] text-danger font-semibold text-center mb-3">{error}</div>}

              {offer.status === "SENT" && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => respond(true)}
                    disabled={busy}
                    className="flex-1 py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold disabled:opacity-50"
                  >
                    تأیید و پذیرش شرایط
                  </button>
                  <button
                    onClick={() => respond(false)}
                    disabled={busy}
                    className="flex-1 py-3 rounded-xl bg-slate-100 text-ink-soft text-[13.5px] font-bold disabled:opacity-50"
                  >
                    عدم پذیرش
                  </button>
                </div>
              )}
              {offer.status === "ACCEPTED" && (
                <div className="text-[13px] text-success font-semibold text-center py-2">همکاری شما نهایی شد 🎉</div>
              )}
            </div>
          )}
        </div>
      </div>
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
