import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { PlusIcon } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchFixedAssets,
  createFixedAsset,
  postFixedAssetDepreciation,
  disposeFixedAsset,
  type FixedAsset,
} from "@/lib/api";

export function FixedAssetsTab() {
  const [assets, setAssets] = useState<FixedAsset[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [posting, setPosting] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [salvageValue, setSalvageValue] = useState("");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reload() {
    fetchFixedAssets().then(setAssets).catch(() => setAssets([]));
  }
  useEffect(reload, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !purchaseDate || !Number(purchaseCost) || !Number(usefulLifeMonths)) return;
    setSubmitting(true);
    try {
      await createFixedAsset({
        name: name.trim(),
        category: category.trim() || undefined,
        purchaseDate,
        purchaseCost: Number(purchaseCost),
        salvageValue: Number(salvageValue) || 0,
        usefulLifeMonths: Number(usefulLifeMonths),
      });
      setName("");
      setCategory("");
      setPurchaseDate("");
      setPurchaseCost("");
      setSalvageValue("");
      setUsefulLifeMonths("");
      setCreating(false);
      reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePostDepreciation(id: string) {
    setPosting(id);
    try {
      await postFixedAssetDepreciation(id);
      reload();
    } finally {
      setPosting(null);
    }
  }

  async function handleDispose(id: string) {
    if (!window.confirm("این دارایی واگذار/اسقاط شود؟")) return;
    setPosting(id);
    try {
      await disposeFixedAsset(id, {});
      reload();
    } finally {
      setPosting(null);
    }
  }

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          دارایی جدید
        </button>
      </div>

      {creating ? (
        <Card className="p-4">
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-[11.5px] text-muted mb-1 block">نام دارایی</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 outline-none"
                placeholder="مثلاً خودروی حمل بار"
              />
            </div>
            <div>
              <label className="text-[11.5px] text-muted mb-1 block">دسته‌بندی (اختیاری)</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 outline-none"
              />
            </div>
            <div>
              <label className="text-[11.5px] text-muted mb-1 block">تاریخ خرید</label>
              <JalaliDateInput value={purchaseDate} onChange={setPurchaseDate} />
            </div>
            <div>
              <label className="text-[11.5px] text-muted mb-1 block">بهای تمام‌شده (تومان)</label>
              <input
                value={purchaseCost}
                onChange={(e) => setPurchaseCost(e.target.value.replace(/[^0-9]/g, ""))}
                dir="ltr"
                className="w-full text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 outline-none"
              />
            </div>
            <div>
              <label className="text-[11.5px] text-muted mb-1 block">ارزش اسقاط (تومان)</label>
              <input
                value={salvageValue}
                onChange={(e) => setSalvageValue(e.target.value.replace(/[^0-9]/g, ""))}
                dir="ltr"
                className="w-full text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 outline-none"
                placeholder="۰"
              />
            </div>
            <div>
              <label className="text-[11.5px] text-muted mb-1 block">عمر مفید (ماه)</label>
              <input
                value={usefulLifeMonths}
                onChange={(e) => setUsefulLifeMonths(e.target.value.replace(/[^0-9]/g, ""))}
                dir="ltr"
                className="w-full text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 outline-none"
                placeholder="۶۰"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !purchaseDate || !Number(purchaseCost) || !Number(usefulLifeMonths)}
              className="sm:col-span-3 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
            >
              {submitting ? "در حال ثبت..." : "ثبت دارایی"}
            </button>
          </form>
        </Card>
      ) : null}

      <Card className="p-2">
        {assets === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : assets.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">هنوز دارایی ثابتی ثبت نشده است</div>
        ) : (
          assets.map((a, i) => {
            const unpostedDepreciation = a.depreciation.accumulatedDepreciation - a.postedDepreciation;
            return (
              <div key={a.id} className={`px-4 py-3.5 ${i < assets.length - 1 ? "border-b border-border" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold">{a.name}</span>
                      {a.category ? <Badge tone="neutral">{a.category}</Badge> : null}
                      <Badge tone={a.status === "ACTIVE" ? "success" : "neutral"}>
                        {a.status === "ACTIVE" ? "فعال" : "واگذارشده"}
                      </Badge>
                    </div>
                    <div className="text-[11.5px] text-muted mt-1">
                      خرید: {formatJalaliDate(a.purchaseDate)} · بهای تمام‌شده: {formatToman(a.purchaseCost)} · عمر مفید:{" "}
                      {a.usefulLifeMonths} ماه
                    </div>
                  </div>
                  {a.status === "ACTIVE" ? (
                    <div className="flex items-center gap-2 shrink-0">
                      {unpostedDepreciation > 0 ? (
                        <button
                          onClick={() => handlePostDepreciation(a.id)}
                          disabled={posting === a.id}
                          className="text-[11px] font-bold text-accent bg-accent-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          ثبت سند استهلاک ({formatToman(unpostedDepreciation)})
                        </button>
                      ) : null}
                      <button
                        onClick={() => handleDispose(a.id)}
                        disabled={posting === a.id}
                        className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        واگذاری/اسقاط
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-3 bg-slate-50 border border-border rounded-lg p-3 mt-2.5">
                  <div>
                    <div className="text-[10.5px] text-muted">استهلاک انباشته</div>
                    <div className="text-[12.5px] font-bold mt-0.5">{formatToman(a.depreciation.accumulatedDepreciation)}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] text-muted">ارزش دفتری فعلی</div>
                    <div className="text-[12.5px] font-bold mt-0.5">{formatToman(a.depreciation.bookValue)}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] text-muted">استهلاک ماهانه</div>
                    <div className="text-[12.5px] font-bold mt-0.5">{formatToman(a.depreciation.monthlyDepreciation)}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
