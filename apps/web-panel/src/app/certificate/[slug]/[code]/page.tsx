"use client";

import { use, useEffect, useState } from "react";
import { LogoMark, StarIcon } from "@/components/icons";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import {
  fetchPublicCertificate,
  publicCertificateImageUrl,
  publicCertificatePdfUrl,
  ApiError,
  type PublicCertificateLookup,
} from "@/lib/api";

export default function PublicCertificatePage({ params }: { params: Promise<{ slug: string; code: string }> }) {
  const { slug, code } = use(params);

  const [cert, setCert] = useState<PublicCertificateLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"fa" | "en">("fa");

  useEffect(() => {
    fetchPublicCertificate(slug, code)
      .then(setCert)
      .catch((err) => setError(err instanceof ApiError ? err.message : "گواهی با این کد یافت نشد"));
  }, [slug, code]);

  const title = lang === "en" ? cert?.titleEn || cert?.titleFa : cert?.titleFa;
  const recipientName = lang === "en" ? cert?.recipientNameEn || cert?.recipientNameFa : cert?.recipientNameFa;

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[720px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <LogoMark className="w-9 h-9" />
          <span className="font-extrabold">استعلام گواهی</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[720px]">
          {error ? (
            <div className="text-center py-16">
              <div className="text-lg font-extrabold text-danger mb-1.5">گواهی یافت نشد</div>
              <div className="text-sm text-ink-soft">{error}</div>
            </div>
          ) : !cert ? (
            <div className="text-center py-16 text-sm text-ink-soft">در حال بررسی...</div>
          ) : (
            <div>
              <div className="w-14 h-14 rounded-2xl bg-primary-soft flex items-center justify-center mx-auto mb-5">
                <StarIcon className="w-7 h-7 text-primary" />
              </div>
              <div className="text-center mb-4">
                <div className="text-[13px] text-ink-soft">{cert.organizationName}</div>
                <div className="text-xl font-extrabold mt-1">{recipientName}</div>
                <div className="text-sm text-ink-soft mt-1">{title}</div>
              </div>

              <div className="flex justify-center gap-2 mb-5">
                <button
                  onClick={() => setLang("fa")}
                  className={`text-[12px] font-bold px-3 py-1.5 rounded-lg cursor-pointer ${lang === "fa" ? "bg-primary text-white" : "bg-white border border-border text-ink-soft"}`}
                >
                  فارسی
                </button>
                <button
                  onClick={() => setLang("en")}
                  className={`text-[12px] font-bold px-3 py-1.5 rounded-lg cursor-pointer ${lang === "en" ? "bg-primary text-white" : "bg-white border border-border text-ink-soft"}`}
                >
                  English
                </button>
              </div>

              <div className="bg-white border border-border rounded-2xl overflow-hidden mb-5">
                <img src={publicCertificateImageUrl(slug, code, lang)} alt="گواهی‌نامه" className="w-full block" />
              </div>

              <div className="grid grid-cols-2 gap-3 bg-white border border-border rounded-2xl p-4 mb-4 text-[13px]">
                <div>
                  <div className="text-[11px] text-muted">کد گواهی</div>
                  <div className="font-bold mt-0.5" dir="ltr">{cert.code}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">تاریخ صدور</div>
                  <div className="font-bold mt-0.5">{formatJalaliDate(cert.issuedAt)}</div>
                </div>
                {cert.durationHours ? (
                  <div>
                    <div className="text-[11px] text-muted">مدت دوره</div>
                    <div className="font-bold mt-0.5">{toPersianDigits(cert.durationHours)} ساعت</div>
                  </div>
                ) : null}
                {cert.score != null ? (
                  <div>
                    <div className="text-[11px] text-muted">امتیاز</div>
                    <div className="font-bold mt-0.5">{toPersianDigits(cert.score)} از ۱۰۰</div>
                  </div>
                ) : null}
                {cert.items.length > 0 ? (
                  <div className="col-span-2">
                    <div className="text-[11px] text-muted mb-1">آیتم‌های آموزش‌دیده</div>
                    <div className="font-bold mt-0.5">
                      {cert.items.map((it) => (lang === "en" ? it.titleEn || it.titleFa : it.titleFa)).join("، ")}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex gap-2">
                <a
                  href={publicCertificateImageUrl(slug, code, lang)}
                  download={`certificate-${cert.code}.png`}
                  className="flex-1 text-center text-[13px] font-bold text-white bg-primary rounded-xl px-4 py-3"
                >
                  دانلود تصویر
                </a>
                <a
                  href={publicCertificatePdfUrl(slug, code, lang)}
                  download={`certificate-${cert.code}.pdf`}
                  className="flex-1 text-center text-[13px] font-bold text-primary bg-primary-soft rounded-xl px-4 py-3"
                >
                  دانلود PDF
                </a>
              </div>

              <div className="text-center text-[11px] text-muted mt-4">
                این لینک همیشه در دسترس است و اصالت این گواهی را تأیید می‌کند.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
