"use client";

import { use, useEffect, useState } from "react";
import { LogoMark } from "@/components/icons";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import { fetchPublicQuotation, acceptPublicQuotation, ApiError, type PublicQuotation } from "@/lib/api";

const STATUS_LABELS: Record<PublicQuotation["status"], string> = {
  DRAFT: "پیش‌نویس",
  SENT: "در انتظار پاسخ شما",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "ردشده",
  EXPIRED: "منقضی‌شده",
  CONVERTED: "تبدیل به فاکتور شده",
};

export default function PublicQuotationPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);
  const [quotation, setQuotation] = useState<PublicQuotation | null | "not_found">(null);
  const [accepting, setAccepting] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchPublicQuotation(slug, token)
      .then(setQuotation)
      .catch(() => setQuotation("not_found"));
  }, [slug, token]);

  async function handleAccept(signatureDataUrl: string) {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await acceptPublicQuotation(slug, token, { name: name.trim(), signatureDataUrl });
      setDone(true);
      setQuotation((prev) => (prev && prev !== "not_found" ? { ...prev, status: "ACCEPTED", acceptedByName: name.trim() } : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت پذیرش با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  if (quotation === null) {
    return (
      <div className="min-h-full flex items-center justify-center p-5">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (quotation === "not_found") {
    return (
      <div className="min-h-full flex items-center justify-center p-5">
        <div className="text-center text-muted text-sm">این لینک معتبر نیست یا منقضی شده است.</div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background py-8 px-4">
      <div className="max-w-[560px] mx-auto">
        <div className="flex items-center gap-2.5 mb-6">
          <LogoMark className="w-9 h-9" />
          <div className="text-[15px] font-extrabold">{quotation.orgName}</div>
        </div>

        <div className="bg-surface rounded-2xl border border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-extrabold">پیش‌فاکتور #{quotation.quotationNo}</div>
              <div className="text-[12.5px] text-ink-soft mt-1">{quotation.contact.company || quotation.contact.name}</div>
              <div className="text-[11.5px] text-muted mt-0.5">
                صادر شده: {formatJalaliDate(quotation.issuedAt)}
                {quotation.validUntil ? ` · اعتبار تا ${formatJalaliDate(quotation.validUntil)}` : ""}
              </div>
            </div>
            <span className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-primary-soft text-primary">
              {STATUS_LABELS[quotation.status]}
            </span>
          </div>

          <div className="flex flex-col gap-2 mt-5">
            {quotation.lines.map((l, i) => (
              <div key={i} className="flex items-center justify-between bg-slate-50 border border-border rounded-xl px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold truncate">{l.description}</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {l.quantity} × {formatToman(l.unitPrice)}
                  </div>
                </div>
                <div className="text-[12.5px] font-extrabold shrink-0">{formatToman(l.lineTotal)}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between bg-slate-50 border border-border rounded-xl p-3.5 mt-4">
            <div className="text-[12px] text-muted">
              جمع اقلام: {formatToman(quotation.subtotal)}
              {quotation.discount > 0 ? ` · تخفیف: ${formatToman(quotation.discount)}` : ""}
            </div>
            <div className="text-[15px] font-extrabold">{formatToman(quotation.total)}</div>
          </div>

          {quotation.notes ? (
            <div className="text-[12.5px] text-ink-soft bg-slate-50 border border-border rounded-xl p-3.5 mt-4">
              {quotation.notes}
            </div>
          ) : null}

          {quotation.status === "ACCEPTED" ? (
            <div className="mt-5 p-3.5 rounded-xl bg-success-soft border border-border text-[12.5px] text-success font-bold text-center">
              {done ? "پذیرش شما با موفقیت ثبت شد." : `این پیش‌فاکتور توسط ${quotation.acceptedByName ?? "شما"} پذیرفته شده است.`}
            </div>
          ) : quotation.status !== "SENT" ? (
            <div className="mt-5 p-3.5 rounded-xl bg-slate-50 border border-border text-[12.5px] text-muted text-center">
              این پیش‌فاکتور دیگر قابل پذیرش نیست.
            </div>
          ) : accepting ? (
            <div className="mt-5 flex flex-col gap-2.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="نام و نام خانوادگی شما"
                className="text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
              />
              {name.trim() ? (
                <SignaturePad onDone={handleAccept} onCancel={() => setAccepting(false)} />
              ) : (
                <div className="text-[11.5px] text-muted text-center py-2">برای امضا، ابتدا نام خود را وارد کنید</div>
              )}
              {error ? <div className="text-[12px] text-danger text-center">{error}</div> : null}
              {submitting ? <div className="text-[12px] text-muted text-center">در حال ثبت...</div> : null}
            </div>
          ) : (
            <button
              onClick={() => setAccepting(true)}
              className="mt-5 w-full py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer"
            >
              پذیرش با امضای الکترونیکی
            </button>
          )}
        </div>

        <div className="text-center text-[11px] text-muted mt-5">این صفحه توسط {quotation.orgName} ارسال شده است.</div>
      </div>
    </div>
  );
}
