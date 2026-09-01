"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  fetchCurrencies,
  createCurrency,
  updateCurrency,
  deleteCurrency,
  ApiError,
  type Currency,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export default function CurrenciesSettingsPage() {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [rate, setRate] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  function reload() {
    fetchCurrencies()
      .then(setCurrencies)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim() || !Number(rate)) return;
    setCreating(true);
    setError(null);
    try {
      await createCurrency({ code: code.trim().toUpperCase(), name: name.trim(), symbol: symbol.trim() || undefined, rate: Number(rate) });
      setCode("");
      setName("");
      setSymbol("");
      setRate("");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(c: Currency) {
    setEditingId(c.id);
    setEditRate(c.rate);
  }

  async function handleSaveRate(id: string) {
    if (!Number(editRate)) return;
    setSavingId(id);
    try {
      await updateCurrency(id, { rate: Number(editRate) });
      setEditingId(null);
      reload();
    } finally {
      setSavingId(null);
    }
  }

  async function handleToggleActive(c: Currency) {
    setSavingId(c.id);
    try {
      await updateCurrency(c.id, { isActive: !c.isActive });
      reload();
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    setSavingId(id);
    try {
      await deleteCurrency(id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-extrabold text-ink">ارزها و نرخ تبدیل</h1>
        <p className="text-[12.5px] text-muted mt-1">
          تومان ارز پایه‌ی سیستم است. هر ارز دیگری که اینجا اضافه کنید قابل استفاده برای قیمت‌گذاری کالا خواهد بود —
          نرخ تبدیل فعلاً دستی است و باید به‌روز نگه داشته شود. با تغییر نرخ، قیمت نمایشی کالاهای ارزی در کاتالوگ
          فوراً به‌روز می‌شود؛ اما فاکتور‌های قبلاً صادرشده نرخ لحظه‌ی صدورشان را نگه می‌دارند.
        </p>
      </div>

      <Card className="p-4">
        <div className="text-[13px] font-bold text-ink mb-3">افزودن ارز جدید</div>
        <form onSubmit={handleCreate} className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className={labelClass}>کد ارز (مثلاً USD)</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" className={inputClass} placeholder="USD" />
          </div>
          <div>
            <label className={labelClass}>نام</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="دلار آمریکا" />
          </div>
          <div>
            <label className={labelClass}>نماد (اختیاری)</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} dir="ltr" className={inputClass} placeholder="$" />
          </div>
          <div>
            <label className={labelClass}>نرخ (تومان به ازای ۱ واحد)</label>
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
              dir="ltr"
              className={inputClass}
              placeholder="60000"
            />
          </div>
          <div className="col-span-2 sm:col-span-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={creating || !code.trim() || !name.trim() || !Number(rate)}
              className="px-4 py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              {creating ? "در حال افزودن..." : "افزودن ارز"}
            </button>
            {error ? <span className="text-[12px] text-danger">{error}</span> : null}
          </div>
        </form>
      </Card>

      <Card className="p-4">
        <div className="text-[13px] font-bold text-ink mb-3">فهرست ارزها</div>
        {loading ? (
          <div className="text-[12.5px] text-muted">در حال بارگذاری...</div>
        ) : currencies.length === 0 ? (
          <div className="text-[12.5px] text-muted">هنوز ارزی اضافه نشده — تومان به‌صورت پیش‌فرض همه‌جا استفاده می‌شود.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {currencies.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 bg-slate-50 border border-border rounded-xl px-3.5 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-extrabold text-ink" dir="ltr">
                    {c.code}
                  </span>
                  <span className="text-[12.5px] text-ink-soft">{c.name}</span>
                  {c.symbol ? <span className="text-[12px] text-muted">({c.symbol})</span> : null}
                  {!c.isActive ? <Badge tone="neutral">غیرفعال</Badge> : null}
                </div>
                <div className="flex items-center gap-2">
                  {editingId === c.id ? (
                    <>
                      <input
                        value={editRate}
                        onChange={(e) => setEditRate(e.target.value.replace(/[^0-9.]/g, ""))}
                        dir="ltr"
                        autoFocus
                        className="w-28 text-[12.5px] outline-none bg-surface border border-border rounded-lg px-2.5 py-1.5"
                      />
                      <button
                        onClick={() => handleSaveRate(c.id)}
                        disabled={savingId === c.id}
                        className="text-[11.5px] font-bold text-white bg-primary px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        ذخیره
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-[11.5px] text-muted px-2 cursor-pointer">
                        انصراف
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-[12.5px] font-bold text-ink" dir="ltr">
                        {Number(c.rate).toLocaleString("en-US")} تومان
                      </span>
                      <button
                        onClick={() => startEdit(c)}
                        className="text-[11.5px] font-bold text-accent bg-accent-soft px-2.5 py-1.5 rounded-lg cursor-pointer"
                      >
                        ویرایش نرخ
                      </button>
                      <button
                        onClick={() => handleToggleActive(c)}
                        disabled={savingId === c.id}
                        className="text-[11.5px] font-bold text-ink-soft bg-surface border border-border px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        {c.isActive ? "غیرفعال کردن" : "فعال کردن"}
                      </button>
                      <button
                        onClick={() => handleDelete(c.id)}
                        disabled={savingId === c.id}
                        className="text-[11.5px] font-bold text-danger bg-danger-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        حذف
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
