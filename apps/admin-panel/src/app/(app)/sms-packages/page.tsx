"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { ListSkeleton } from "@/components/ui/EmptyState";
import { INPUT, LABEL, BTN_PRIMARY, BTN_DANGER } from "@/components/ui/styles";
import { PageHeader } from "@/components/ui/PageHeader";
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
    <div className="p-4 sm:p-5 lg:p-7 max-w-[820px] mx-auto">
      <PageHeader title="بسته‌های پیامک پنل سیستمی" />
      <p className="text-[13px] text-muted mt-2 mb-5 leading-relaxed">
        تننت‌هایی که پنل پیامکی اختصاصی ندارند از پنل مشترک اکسیر استفاده می‌کنند و از همین بسته‌ها می‌خرند. قیمت به تومان است؛ بسته‌ی غیرفعال یا بدون قیمت
        برای تننت‌ها نمایش داده نمی‌شود.
      </p>
      <div className="flex flex-col gap-3">
        {packages === null ? (
          <ListSkeleton />
        ) : (
          packages.map((p) => (
            <Card key={p.code} className="p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>تعداد پیامک</label>
                  <input
                    type="number"
                    min={1}
                    value={creditDrafts[p.code] ?? ""}
                    onChange={(e) => setCreditDrafts((d) => ({ ...d, [p.code]: e.target.value }))}
                    onBlur={() => Number(creditDrafts[p.code]) > 0 && Number(creditDrafts[p.code]) !== p.credits && save(p, { credits: Number(creditDrafts[p.code]) })}
                    className={`${INPUT} font-extrabold`}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className={LABEL}>قیمت (تومان)</label>
                  <input
                    type="number"
                    min={0}
                    value={drafts[p.code] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.code]: e.target.value }))}
                    className={INPUT}
                    dir="ltr"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap mt-3.5 pt-3.5 border-t border-border">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={p.isActive} onChange={(e) => save(p, { isActive: e.target.checked })} className="w-4 h-4 cursor-pointer" />
                  <span className="text-[12.5px] font-semibold">فعال برای فروش</span>
                </label>
                <div className="flex items-center gap-2 max-sm:w-full [&>*]:max-sm:flex-1">
                  <button
                    onClick={() => save(p, { priceToman: Number(drafts[p.code]) || 0 })}
                    disabled={savingCode === p.code || Number(drafts[p.code]) === p.priceToman}
                    className={BTN_PRIMARY}
                  >
                    ذخیره قیمت
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm("این بسته حذف شود؟")) return;
                      await deleteSmsPackage(p.code);
                      setPackages((prev) => prev?.filter((x) => x.code !== p.code) ?? prev);
                    }}
                    className={BTN_DANGER}
                  >
                    حذف
                  </button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
      <Card className="p-4 mt-4 flex items-center gap-2.5 flex-wrap [&>input]:max-sm:w-full [&>button]:max-sm:w-full">
        <span className="text-[13px] font-extrabold max-sm:w-full">بسته‌ی جدید</span>
        <input type="number" min={1} value={newCredits} onChange={(e) => setNewCredits(e.target.value)} placeholder="تعداد پیامک" dir="ltr" className={`${INPUT} sm:w-[160px]`} />
        <input type="number" min={0} value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="قیمت (تومان)" dir="ltr" className={`${INPUT} sm:w-[160px]`} />
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
          className={BTN_PRIMARY}
        >
          افزودن
        </button>
      </Card>
    </div>
  );
}
