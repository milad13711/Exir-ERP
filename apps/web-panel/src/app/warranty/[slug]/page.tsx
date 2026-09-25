"use client";

import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LogoMark, ShieldIcon } from "@/components/icons";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import {
  fetchPublicWarrantyLookup,
  activatePublicWarranty,
  fetchPublicWarrantyTerms,
  ApiError,
  type PublicWarrantyLookup,
  type WarrantyCodeStatus,
} from "@/lib/api";

const STATUS_LABELS: Record<WarrantyCodeStatus, string> = { PENDING: "صادرشده — هنوز فعال نشده", ACTIVE: "فعال", EXPIRED: "منقضی‌شده", VOID: "باطل‌شده" };

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function PublicWarrantyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const searchParams = useSearchParams();

  const [code, setCode] = useState(searchParams.get("code") ?? "");
  const [lookup, setLookup] = useState<PublicWarrantyLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doLookup(c: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetchPublicWarrantyLookup(slug, c);
      setLookup(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "کد گارانتی یافت نشد");
      setLookup(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // استعلام خودکار در لود صفحه وقتی کد از طریق لینک (?code=) آمده باشد —
    // عمداً همین‌جا busy/error را همزمان ست می‌کند، نه در callback
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (searchParams.get("code")) doLookup(searchParams.get("code")!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLookupSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim()) doLookup(code.trim());
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col">
      <div className="border-b border-border bg-white">
        <div className="max-w-[520px] mx-auto flex items-center gap-2.5 px-6 py-4">
          <LogoMark className="w-9 h-9" />
          <span className="font-extrabold">گارانتی</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[440px]">
          {!lookup ? (
            <form onSubmit={handleLookupSubmit} className="w-full">
              <div className="w-14 h-14 rounded-2xl bg-primary-soft flex items-center justify-center mx-auto mb-5">
                <ShieldIcon className="w-7 h-7 text-primary" />
              </div>
              <div className="text-xl font-extrabold mb-1.5 text-center">استعلام گارانتی</div>
              <div className="text-sm text-ink-soft leading-relaxed mb-8 text-center">کد گارانتی چاپ‌شده روی محصول یا برچسب را وارد کنید.</div>
              <input
                dir="ltr"
                placeholder="کد گارانتی"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full text-center tracking-widest px-4 py-4 rounded-2xl border-2 border-border focus:border-primary outline-none text-lg font-bold mb-3"
              />
              {error && <div className="text-[13px] text-danger font-semibold mb-3 text-center">{error}</div>}
              <button type="submit" disabled={busy || !code.trim()} className="w-full py-4 rounded-2xl bg-primary text-white text-base font-bold disabled:opacity-50">
                {busy ? "در حال بررسی..." : "استعلام"}
              </button>
            </form>
          ) : (
            <WarrantyResult tenantSlug={slug} lookup={lookup} onRefresh={() => doLookup(lookup.code)} onBack={() => setLookup(null)} />
          )}
        </div>
      </div>
    </div>
  );
}

function WarrantyResult({
  tenantSlug,
  lookup,
  onRefresh,
  onBack,
}: {
  tenantSlug: string;
  lookup: PublicWarrantyLookup;
  onRefresh: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="bg-white border border-border rounded-2xl p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <span className="font-extrabold tracking-wider" dir="ltr">
            {lookup.code}
          </span>
          <span className="text-[12px] font-bold px-2.5 py-1 rounded-lg bg-primary-soft text-primary">{STATUS_LABELS[lookup.status]}</span>
        </div>
        {lookup.itemDescription && <div className="text-[13.5px] text-ink-soft mb-1">{lookup.itemDescription}</div>}
        {lookup.status === "ACTIVE" && lookup.daysRemaining != null && (
          <div className={`text-[13px] font-bold ${lookup.daysRemaining <= 0 ? "text-danger" : lookup.daysRemaining <= 30 ? "text-warning" : "text-success"}`}>
            {lookup.daysRemaining > 0 ? `${toPersianDigits(lookup.daysRemaining)} روز از گارانتی باقی مانده` : "گارانتی منقضی شده است"}
          </div>
        )}
        {lookup.expiresAt && <div className="text-[12.5px] text-muted mt-1">تا تاریخ {formatJalaliDate(lookup.expiresAt)} معتبر است</div>}
      </div>

      {lookup.status === "PENDING" && <ActivateForm tenantSlug={tenantSlug} code={lookup.code} onActivated={onRefresh} />}

      {lookup.status === "ACTIVE" && lookup.afterSalesInstalled && (
        <a
          href={`/after-sales/${tenantSlug}?code=${encodeURIComponent(lookup.code)}`}
          className="block text-center bg-white border border-border rounded-2xl p-4 text-[13px] font-bold text-primary"
        >
          درخواست خدمات پس از فروش
        </a>
      )}

      <button onClick={onBack} className="w-full text-[12.5px] font-bold text-muted mt-4">
        استعلام کد دیگر
      </button>
    </div>
  );
}

function ActivateForm({ tenantSlug, code, onActivated }: { tenantSlug: string; code: string; onActivated: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [terms, setTerms] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPublicWarrantyTerms(tenantSlug).then((r) => setTerms(r.text || null));
  }, [tenantSlug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await activatePublicWarranty(tenantSlug, { code, name, phone, email: email || undefined, termsAccepted, productPhoto: photo });
      onActivated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "فعال‌سازی ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-border rounded-2xl p-5 flex flex-col gap-3">
      <div className="text-[14px] font-extrabold mb-1">فعال‌سازی گارانتی</div>
      <input
        placeholder="نام و نام خانوادگی"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="w-full text-[13.5px] outline-none border-2 border-border rounded-xl px-4 py-3 focus:border-primary"
      />
      <input
        dir="ltr"
        placeholder="09121234567"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
        className="w-full text-[13.5px] outline-none border-2 border-border rounded-xl px-4 py-3 focus:border-primary"
      />
      <input
        dir="ltr"
        type="email"
        placeholder="ایمیل (اختیاری)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full text-[13.5px] outline-none border-2 border-border rounded-xl px-4 py-3 focus:border-primary"
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted">عکس محصول (اختیاری)</span>
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

      {terms && (
        <label className="flex items-start gap-2 text-[12.5px] text-ink-soft leading-relaxed">
          <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="w-4 h-4 mt-0.5" required />
          <span>{terms}</span>
        </label>
      )}

      {error && <div className="text-[13px] text-danger font-semibold text-center">{error}</div>}

      <button type="submit" disabled={busy} className="w-full py-3.5 rounded-2xl bg-primary text-white text-[14px] font-bold disabled:opacity-50">
        {busy ? "در حال فعال‌سازی..." : "فعال‌سازی گارانتی"}
      </button>
    </form>
  );
}
