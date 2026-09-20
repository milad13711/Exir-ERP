"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { fetchSmsPackages, updateSmsPackage, type SmsPackage } from "@/lib/api";

/** قیمت بسته‌های پیامکی پنل سیستمی — تننت‌ها فقط بسته‌ی فعال با قیمت بیش‌از صفر را می‌بینند و می‌خرند. */
export default function SmsPackagesPage() {
  const [packages, setPackages] = useState<SmsPackage[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);

  useEffect(() => {
    fetchSmsPackages()
      .then((rows) => {
        setPackages(rows);
        setDrafts(Object.fromEntries(rows.map((p) => [p.code, String(p.priceToman)])));
      })
      .catch(() => setPackages([]));
  }, []);

  async function save(p: SmsPackage, patch: { priceToman?: number; isActive?: boolean }) {
    setSavingCode(p.code);
    try {
      const updated = await updateSmsPackage(p.code, patch);
      setPackages((prev) => prev?.map((x) => (x.code === p.code ? updated : x)) ?? prev);
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <div className="p-5 lg:p-7 max-w-[820px] mx-auto">
      <h1 className="text-xl font-extrabold mb-1">بسته‌های پیامک پنل سیستمی</h1>
      <p className="text-[13px] text-muted mb-5 leading-relaxed">
        تننت‌هایی که پنل پیامکی اختصاصی ندارند از پنل مشترک اکسیر استفاده می‌کنند و از همین بسته‌ها می‌خرند. قیمت به تومان است؛ بسته‌ی غیرفعال یا بدون قیمت
        برای تننت‌ها نمایش داده نمی‌شود.
      </p>
      <Card className="p-2">
        {packages === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : (
          packages.map((p, i) => (
            <div key={p.code} className={`flex items-center gap-3 px-4 py-3.5 flex-wrap ${i < packages.length - 1 ? "border-b border-border" : ""}`}>
              <div className="w-[130px] text-[14px] font-extrabold">{p.credits.toLocaleString("fa-IR")} پیامک</div>
              <input
                type="number"
                min={0}
                value={drafts[p.code] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [p.code]: e.target.value }))}
                className="w-[160px] text-[13px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary"
                dir="ltr"
              />
              <span className="text-[12px] text-muted">تومان</span>
              <button
                onClick={() => save(p, { priceToman: Number(drafts[p.code]) || 0 })}
                disabled={savingCode === p.code || Number(drafts[p.code]) === p.priceToman}
                className="text-[12px] font-bold px-3.5 py-2 rounded-lg bg-primary text-white disabled:opacity-40 cursor-pointer"
              >
                ذخیره قیمت
              </button>
              <label className="flex items-center gap-2 mr-auto cursor-pointer">
                <input type="checkbox" checked={p.isActive} onChange={(e) => save(p, { isActive: e.target.checked })} className="w-4 h-4 cursor-pointer" />
                <span className="text-[12.5px] font-semibold">فعال برای فروش</span>
              </label>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
