"use client";

import { useEffect, useState } from "react";
import { fetchSmsPackages, purchaseSmsPackageAndPay, ApiError, type SmsPackageOption } from "@/lib/api";
import { formatToman, toPersianDigits } from "@/lib/persian";

/** بسته‌های پیامک پنل سیستمی — انتخاب → فاکتور → درگاه پرداخت → شارژ آنی. */
export function SmsPackagePicker() {
  const [packages, setPackages] = useState<SmsPackageOption[] | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSmsPackages().then(setPackages).catch(() => setPackages([]));
  }, []);

  async function buy(code: string) {
    setBusyCode(code);
    setError(null);
    try {
      window.location.assign(await purchaseSmsPackageAndPay(code));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "شروع پرداخت ناموفق بود");
      setBusyCode(null);
    }
  }

  if (packages === null) return <div className="text-[12.5px] text-muted">در حال بارگذاری بسته‌ها...</div>;
  if (packages.length === 0) {
    return <div className="text-[12.5px] text-muted">هنوز بسته‌ای برای فروش فعال نشده است؛ با پشتیبانی تماس بگیرید.</div>;
  }
  return (
    <div className="flex flex-col gap-2">
      {packages.map((p) => (
        <button
          key={p.code}
          onClick={() => buy(p.code)}
          disabled={busyCode !== null}
          className="flex items-center justify-between gap-3 border border-border rounded-xl px-4 py-3 bg-surface hover:border-primary disabled:opacity-50 cursor-pointer text-right"
        >
          <span className="text-[13.5px] font-extrabold">{toPersianDigits(p.credits.toLocaleString("en-US"))} پیامک</span>
          <span className="text-[12.5px] font-bold text-primary">{busyCode === p.code ? "در حال انتقال به درگاه..." : formatToman(p.priceToman)}</span>
        </button>
      ))}
      {error && <div className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}
