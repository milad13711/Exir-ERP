"use client";

import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LogoMark, StarIcon } from "@/components/icons";
import {
  fetchPublicAfterSalesStatus,
  fetchPublicAfterSalesTerms,
  requestPublicAfterSalesService,
  submitPublicAfterSalesFeedback,
  ApiError,
  type PublicAfterSalesStatus,
} from "@/lib/api";

const SERVICE_STATUS_LABELS: Record<string, string> = {
  NEW: "ثبت‌شده",
  REVIEWING: "در حال بررسی",
  AWAITING_PRODUCT: "در انتظار ارسال کالا",
  IN_PROGRESS: "در حال تعمیر",
  RESOLVED: "برطرف‌شده",
  CLOSED: "بسته‌شده",
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function PublicAfterSalesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const searchParams = useSearchParams();

  const [code, setCode] = useState(searchParams.get("code") ?? "");
  const [status, setStatus] = useState<PublicAfterSalesStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doLookup(c: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetchPublicAfterSalesStatus(slug, c);
      setStatus(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "کد گارانتی یافت نشد");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (searchParams.get("code")) doLookup(searchParams.get("code")!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim()) doLookup(code.trim());
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[520px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <LogoMark className="w-9 h-9" />
          <span className="font-extrabold">خدمات پس از فروش</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[440px]">
          {!status ? (
            <form onSubmit={handleSubmit} className="w-full">
              <div className="text-xl font-extrabold mb-1.5 text-center">درخواست خدمات پس از فروش</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-8 text-center">کد گارانتی محصول خود را وارد کنید.</div>
              <input
                dir="ltr"
                placeholder="کد گارانتی"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full text-center tracking-widest px-4 py-4 rounded-2xl border-2 border-border focus:border-primary outline-none text-lg font-bold mb-3"
              />
              {error && <div className="text-[13px] text-danger font-semibold mb-3 text-center">{error}</div>}
              <button type="submit" disabled={busy || !code.trim()} className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold disabled:opacity-50">
                {busy ? "در حال بررسی..." : "ادامه"}
              </button>
            </form>
          ) : (
            <AfterSalesResult tenantSlug={slug} status={status} onRefresh={() => doLookup(status.code)} onBack={() => setStatus(null)} />
          )}
        </div>
      </div>
    </div>
  );
}

function AfterSalesResult({
  tenantSlug,
  status,
  onRefresh,
  onBack,
}: {
  tenantSlug: string;
  status: PublicAfterSalesStatus;
  onRefresh: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="bg-white border border-border rounded-2xl p-5 mb-5">
        <div className="font-extrabold tracking-wider mb-1" dir="ltr">
          {status.code}
        </div>
        {status.itemDescription && <div className="text-[13.5px] text-ink-soft">{status.itemDescription}</div>}
      </div>

      {!status.canRequestService && !status.latestService && (
        <div className="bg-white border border-border rounded-2xl p-5 text-[13.5px] text-ink-soft text-center leading-relaxed">
          این گارانتی فعال نیست — برای ثبت درخواست خدمات پس از فروش، ابتدا باید گارانتی خود را فعال کنید.
          <a href={`/warranty/${tenantSlug}?code=${encodeURIComponent(status.code)}`} className="block mt-3 font-bold text-primary">
            رفتن به صفحه‌ی فعال‌سازی گارانتی
          </a>
        </div>
      )}

      {status.latestService ? (
        <ServiceStatusCard tenantSlug={tenantSlug} status={status.latestService.status} serviceId={status.latestService.id} />
      ) : (
        status.canRequestService && <RequestServiceForm tenantSlug={tenantSlug} code={status.code} onSubmitted={onRefresh} />
      )}

      <button onClick={onBack} className="w-full text-[12.5px] font-bold text-muted mt-4">
        کد دیگری وارد کنید
      </button>
    </div>
  );
}

function RequestServiceForm({ tenantSlug, code, onSubmitted }: { tenantSlug: string; code: string; onSubmitted: () => void }) {
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [terms, setTerms] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPublicAfterSalesTerms(tenantSlug).then((r) => setTerms(r.text || null));
  }, [tenantSlug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPublicAfterSalesService(tenantSlug, { code, description, photo });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت درخواست ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-border rounded-2xl p-5 flex flex-col gap-3">
      <div className="text-[14px] font-extrabold mb-1">شرح درخواست</div>
      <textarea
        placeholder="شرح مشکل محصول را بنویسید..."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        required
        className="w-full text-[13.5px] outline-none border-2 border-border rounded-xl px-4 py-3 focus:border-primary resize-none"
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted">عکس مشکل (اختیاری)</span>
        <input
          type="file"
          accept="image/*"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setPhoto(await fileToDataUrl(file));
          }}
          className="text-[12.5px]"
        />
      </label>

      {terms && <div className="text-[12px] text-muted leading-relaxed">{terms}</div>}
      {error && <div className="text-[13px] text-danger font-semibold text-center">{error}</div>}

      <button type="submit" disabled={busy || !description.trim()} className="w-full py-3.5 rounded-2xl bg-primary text-white text-[14px] font-bold disabled:opacity-50">
        {busy ? "در حال ثبت..." : "ثبت درخواست"}
      </button>
    </form>
  );
}

function ServiceStatusCard({ tenantSlug, status, serviceId }: { tenantSlug: string; status: string; serviceId: string }) {
  const isClosed = status === "RESOLVED" || status === "CLOSED";
  return (
    <div className="bg-white border border-border rounded-2xl p-5">
      <div className="text-[14px] font-extrabold mb-2">وضعیت درخواست خدمات پس از فروش</div>
      <div className="text-[13.5px] text-primary font-bold mb-3">{SERVICE_STATUS_LABELS[status] ?? status}</div>
      {isClosed && <FeedbackForm tenantSlug={tenantSlug} serviceId={serviceId} />}
    </div>
  );
}

function FeedbackForm({ tenantSlug, serviceId }: { tenantSlug: string; serviceId: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (rating === 0) return;
    setBusy(true);
    try {
      await submitPublicAfterSalesFeedback(tenantSlug, serviceId, { rating, comment: comment || undefined });
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <div className="text-[13px] text-success font-semibold text-center py-2">از نظر شما سپاسگزاریم 🙏</div>;

  return (
    <div className="border-t border-border pt-4 mt-2">
      <div className="text-[13px] text-ink-soft mb-2">به کیفیت خدمات پس از فروش چه امتیازی می‌دهید؟</div>
      <div className="flex items-center gap-1 justify-center mb-3" dir="ltr">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} className="p-1">
            <StarIcon className={`w-7 h-7 ${n <= rating ? "text-warning fill-current" : "fill-none text-border"}`} />
          </button>
        ))}
      </div>
      <textarea
        placeholder="نظر شما (اختیاری)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        className="w-full text-[13px] outline-none border-2 border-border rounded-xl px-4 py-3 focus:border-primary resize-none mb-3"
      />
      <button
        onClick={handleSubmit}
        disabled={rating === 0 || busy}
        className="w-full py-3 rounded-2xl bg-primary text-white text-[13.5px] font-bold disabled:opacity-50"
      >
        ثبت نظر
      </button>
    </div>
  );
}
