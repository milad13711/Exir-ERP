"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { adjustTenantSmsWallet, fetchTenantSmsWallet, updateTenantSubscription, ApiError } from "@/lib/api";

const FIELD = "text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5";

/** مدیریت دستی اشتراک (تاریخ پایان/روز باقی‌مانده، وضعیت، مادام‌العمر) و موجودی پیامک پنل سیستمی تننت. */
export function SubscriptionSmsCard({
  tenantId,
  currentPeriodEnd,
  status,
  lifetime,
  onChanged,
}: {
  tenantId: string;
  currentPeriodEnd?: string;
  status?: string;
  lifetime?: boolean;
  onChanged: () => void;
}) {
  const [end, setEnd] = useState(currentPeriodEnd ? currentPeriodEnd.slice(0, 10) : "");
  const [subStatus, setSubStatus] = useState(status ?? "ACTIVE");
  const [isLifetime, setIsLifetime] = useState(!!lifetime);
  const [credits, setCredits] = useState<number | null>(null);
  const [delta, setDelta] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchTenantSmsWallet(tenantId).then((w) => setCredits(w.credits)).catch(() => setCredits(0));
  }, [tenantId]);

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      onChanged();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "انجام عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 p-4 flex flex-col gap-4">
      <div>
        <div className="text-[13.5px] font-extrabold mb-2">تنظیم دستی اشتراک</div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <label className="flex items-center gap-2 text-[12px] font-semibold">
            تاریخ پایان
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={isLifetime} className={FIELD} />
          </label>
          <select value={subStatus} onChange={(e) => setSubStatus(e.target.value)} className={FIELD}>
            <option value="TRIAL">آزمایشی</option>
            <option value="ACTIVE">فعال</option>
            <option value="PAST_DUE">معوق</option>
            <option value="CANCELLED">لغو شده</option>
          </select>
          <label className="flex items-center gap-2 text-[12px] font-semibold cursor-pointer">
            <input type="checkbox" checked={isLifetime} onChange={(e) => setIsLifetime(e.target.checked)} className="w-4 h-4" />
            لایسنس مادام‌العمر
          </label>
          <button
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  updateTenantSubscription(tenantId, {
                    currentPeriodEnd: !isLifetime && end ? new Date(end).toISOString() : undefined,
                    status: subStatus as "ACTIVE",
                    lifetime: isLifetime,
                  }).then(() => undefined),
                "اشتراک به‌روز شد ✓",
              )
            }
            className="text-[12px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            ذخیره
          </button>
        </div>
        <div className="text-[11px] text-muted mt-1.5">روز باقی‌مانده در هدر تننت از همین تاریخ پایان محاسبه می‌شود؛ مادام‌العمر به‌جای شمارنده «لایسنس مادام‌العمر» نشان می‌دهد.</div>
      </div>

      <div className="border-t border-border pt-3">
        <div className="text-[13.5px] font-extrabold mb-2">موجودی پیامک پنل سیستمی: {credits === null ? "..." : credits.toLocaleString("fa-IR")}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={delta} onChange={(e) => setDelta(e.target.value.replace(/[^0-9-]/g, ""))} placeholder="افزایش/کاهش (مثلاً 500 یا -100)" dir="ltr" className={`${FIELD} w-[220px]`} />
          <button
            disabled={busy || !Number(delta)}
            onClick={() =>
              run(async () => {
                const w = await adjustTenantSmsWallet(tenantId, { delta: Number(delta) });
                setCredits(w.credits);
                setDelta("");
              }, "موجودی به‌روز شد ✓")
            }
            className="text-[12px] font-bold text-primary bg-primary-soft px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            اعمال
          </button>
        </div>
      </div>
      {msg && <div className="text-[12.5px] font-semibold text-ink-soft">{msg}</div>}
    </Card>
  );
}
