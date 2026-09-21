"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { fetchSmsPackages, updateSmsPackage, createSmsPackage, deleteSmsPackage, type SmsPackage } from "@/lib/api";

/** قیمت بسته‌های پیامکی پنل سیستمی — تننت‌ها فقط بسته‌ی فعال با قیمت بیش‌از صفر را می‌بینند و می‌خرند. */
export default function SmsPackagesPage() {
  const [packages, setPackages] = useState<SmsPackage[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [creditDrafts, setCreditDrafts] = useState<Record<string, string>>({});
  const [newCredits, setNewCredits] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [savingCode, setSavingCode] = useState<string | null>(null);

  useEffect(() => {
    fetchSmsPackages()
      .then((rows) => {
        setPackages(rows);
        setDrafts(Object.fromEntries(rows.map((p) => [p.code, String(p.priceToman)])));
        setCreditDrafts(Object.fromEntries(rows.map((p) => [p.code, String(p.credits)])));
      })
      .catch(() => setPackages([]));
  }, []);

  async function save(p: SmsPackage, patch: { priceToman?: number; isActive?: boolean; credits?: number }) {
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
              <input
                type="number"
                min={1}
                value={creditDrafts[p.code] ?? ""}
                onChange={(e) => setCreditDrafts((d) => ({ ...d, [p.code]: e.target.value }))}
                onBlur={() => Number(creditDrafts[p.code]) > 0 && Number(creditDrafts[p.code]) !== p.credits && save(p, { credits: Number(creditDrafts[p.code]) })}
                className="w-[100px] text-[13px] font-extrabold outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary"
                dir="ltr"
                title="تعداد پیامک بسته"
              />
              <span className="text-[12px] font-bold">پیامک</span>
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
              <button
                onClick={async () => {
                  if (!window.confirm("این بسته حذف شود؟")) return;
                  await deleteSmsPackage(p.code);
                  setPackages((prev) => prev?.filter((x) => x.code !== p.code) ?? prev);
                }}
                className="text-[11.5px] font-bold text-danger px-2 cursor-pointer"
              >
                حذف
              </button>
            </div>
          ))
        )}
      </Card>
      <Card className="p-4 mt-4 flex items-center gap-2.5 flex-wrap">
        <span className="text-[12.5px] font-bold">بسته‌ی جدید:</span>
        <input type="number" min={1} value={newCredits} onChange={(e) => setNewCredits(e.target.value)} placeholder="تعداد پیامک" dir="ltr" className="w-[130px] text-[13px] outline-none bg-surface border border-border rounded-lg px-3 py-2" />
        <input type="number" min={0} value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="قیمت (تومان)" dir="ltr" className="w-[160px] text-[13px] outline-none bg-surface border border-border rounded-lg px-3 py-2" />
        <button
          disabled={!Number(newCredits)}
          onClick={async () => {
            const created = await createSmsPackage({ credits: Number(newCredits), priceToman: Number(newPrice) || 0 });
            setPackages((prev) => [...(prev ?? []), created]);
            setDrafts((d) => ({ ...d, [created.code]: String(created.priceToman) }));
            setCreditDrafts((d) => ({ ...d, [created.code]: String(created.credits) }));
            setNewCredits("");
            setNewPrice("");
          }}
          className="text-[12px] font-bold text-white bg-primary px-4 py-2 rounded-lg disabled:opacity-40 cursor-pointer"
        >
          افزودن
        </button>
      </Card>
    </div>
  );
}
