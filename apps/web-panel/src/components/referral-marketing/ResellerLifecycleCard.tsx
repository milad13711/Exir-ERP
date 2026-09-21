"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  createResellerSettlement,
  endResellerCooperation,
  fetchResellerSettlements,
  setResellerMapVisibility,
  settleResellerSettlement,
  ApiError,
  type Reseller,
  type ResellerSettlement,
} from "@/lib/api";

/** چرخه‌ی پایان همکاری نماینده: توقف نمایش نقشه، پایان همکاری و صورتحساب مانده جهت تسویه. */
export function ResellerLifecycleCard({ reseller, onChanged }: { reseller: Reseller; onChanged: () => void }) {
  const [settlements, setSettlements] = useState<ResellerSettlement[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = reseller.cooperationStatus ?? "ACTIVE";

  function load() {
    fetchResellerSettlements(reseller.id).then(setSettlements).catch(() => setSettlements([]));
  }
  useEffect(load, [reseller.id]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "انجام عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-xl p-3.5 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[13px] font-bold">وضعیت همکاری</div>
        <Badge tone={status === "ACTIVE" ? "success" : status === "END_REQUESTED" ? "warning" : "danger"}>
          {status === "ACTIVE" ? "فعال" : status === "END_REQUESTED" ? "درخواست پایان همکاری" : "پایان‌یافته"}
        </Badge>
        {reseller.hiddenFromMap && <Badge tone="neutral">نمایش روی نقشه متوقف است</Badge>}
      </div>
      {reseller.endReason && <div className="text-[12px] text-muted">دلیل پایان: {reseller.endReason}</div>}

      <div className="flex items-center gap-2 flex-wrap">
        <button disabled={busy} onClick={() => run(() => setResellerMapVisibility(reseller.id, !reseller.hiddenFromMap))} className="text-[12px] font-bold text-ink-soft bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
          {reseller.hiddenFromMap ? "نمایش دوباره روی نقشه" : "توقف نمایش روی نقشه"}
        </button>
        {status !== "ENDED" && (
          <button
            disabled={busy}
            onClick={() => {
              const reason = window.prompt("دلیل پایان همکاری:");
              if (reason && reason.trim().length >= 3) run(() => endResellerCooperation(reseller.id, reason.trim()));
            }}
            className="text-[12px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
          >
            پایان همکاری و صدور صورتحساب مانده
          </button>
        )}
        <button disabled={busy} onClick={() => run(() => createResellerSettlement(reseller.id))} className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
          صدور صورتحساب مانده
        </button>
      </div>
      {error && <div className="text-[12px] text-danger font-semibold">{error}</div>}

      {settlements && settlements.length > 0 && (
        <div className="flex flex-col gap-2">
          {settlements.map((s) => (
            <div key={s.id} className="bg-slate-50 rounded-lg p-3 text-[12px]">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-bold">صورتحساب شماره {s.number} — {formatJalaliDate(s.issuedAt)}</div>
                <Badge tone={s.status === "SETTLED" ? "success" : "warning"}>{s.status === "SETTLED" ? "تسویه‌شده" : "در انتظار تسویه"}</Badge>
              </div>
              <div className="mt-1.5 text-muted">
                کل کمیسیون {formatToman(s.totalCommission)} · پرداخت‌شده {formatToman(s.paidCommission)} · <b className="text-ink">مانده {formatToman(s.amountDue)}</b>
              </div>
              {s.lines.length > 0 && (
                <div className="mt-1.5 text-[11.5px] text-muted whitespace-pre-wrap">{s.lines.filter((l) => l.due > 0).map((l) => `${l.customer} (سفارش ${l.orderNo}): ${formatToman(l.due)}`).join("\n")}</div>
              )}
              {s.status === "ISSUED" && (
                <button disabled={busy} onClick={() => run(() => settleResellerSettlement(s.id))} className="mt-2 text-[11.5px] font-bold text-success bg-success-soft px-3 py-1 rounded-lg cursor-pointer disabled:opacity-50">
                  ثبت تسویه‌شده
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
