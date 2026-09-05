"use client";

import { use, useEffect, useState } from "react";
import { LogoMark, TruckIcon, CheckIcon } from "@/components/icons";
import { toPersianDigits, formatJalaliDateTime } from "@/lib/persian";
import { viewPublicFleetOffer, acceptPublicFleetOffer, ApiError, type PublicOfferView } from "@/lib/api";

export default function PublicFleetOfferPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);
  const [view, setView] = useState<PublicOfferView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    viewPublicFleetOffer(slug, token)
      .then(setView)
      .catch((err) => setError(err instanceof ApiError ? err.message : "این لینک معتبر نیست"));
  }, [slug, token]);

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      const res = await acceptPublicFleetOffer(slug, token);
      if (res.status === "taken_by_other") {
        setView({ status: "taken_by_other" });
      } else {
        setAccepted(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "پذیرش با خطا مواجه شد");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[520px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center">
            <LogoMark className="w-5 h-5 text-primary" />
          </div>
          <span className="font-extrabold">پیشنهاد بار</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[480px]">
          {error && <div className="text-[13px] text-danger font-semibold text-center bg-danger-soft rounded-2xl p-4">{error}</div>}

          {!error && !view && <div className="text-center text-muted text-sm py-10">در حال بارگذاری...</div>}

          {!error && view?.status === "taken_by_other" && (
            <div className="bg-white border border-border rounded-2xl p-6 text-center">
              <div className="text-3xl mb-3">🙏</div>
              <div className="text-[15px] font-bold mb-2">این بار توسط راننده‌ی دیگری پذیرفته شد</div>
              <div className="text-[13px] text-muted leading-relaxed">با تشکر از شما، به امید همکاری در ارسال بار بعدی.</div>
            </div>
          )}

          {!error && view?.status === "cancelled" && (
            <div className="bg-white border border-border rounded-2xl p-6 text-center">
              <div className="text-[15px] font-bold mb-2">این بار لغو شده است</div>
            </div>
          )}

          {!error && (accepted || view?.status === "accepted_by_you") && (
            <div className="bg-success-soft rounded-2xl p-6 text-center">
              <CheckIcon className="w-8 h-8 text-success mx-auto mb-2" />
              <div className="text-[15px] font-bold text-success mb-1">بار توسط شما پذیرفته شد</div>
              <div className="text-[13px] text-ink-soft">لطفاً در زمان بارگیری در محل حاضر باشید.</div>
            </div>
          )}

          {!error && !accepted && view?.status === "pending" && (
            <div className="flex flex-col gap-4">
              <div className="bg-white border border-border rounded-2xl p-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                    <TruckIcon className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <div className="text-[14px] font-bold">{view.shipment.cargoType}</div>
                    <div className="text-[11.5px] text-muted">بار شماره {toPersianDigits(view.shipment.shipmentNo)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-slate-50 rounded-xl p-3">
                    <div className="text-[11px] text-muted mb-1">مقدار</div>
                    <div className="text-[13px] font-extrabold">
                      {toPersianDigits(view.shipment.quantity)} {view.shipment.unit}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <div className="text-[11px] text-muted mb-1">زمان بارگیری</div>
                    <div className="text-[12.5px] font-bold">{formatJalaliDateTime(view.shipment.pickupAt)}</div>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 mt-2.5">
                  <div className="text-[11px] text-muted mb-1">آدرس تحویل</div>
                  <div className="text-[12.5px] font-bold">{view.shipment.deliveryAddress}</div>
                </div>
              </div>

              <button
                onClick={handleAccept}
                disabled={accepting}
                className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold disabled:opacity-50"
              >
                {accepting ? "در حال ثبت..." : "پذیرش این بار"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
