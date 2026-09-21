"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatToman } from "@/lib/persian";
import {
  fetchAdminResellers,
  setAdminResellerMapVisibility,
  endAdminReseller,
  fetchAdminResellerSettlements,
  createAdminResellerSettlement,
  settleAdminResellerSettlement,
  type AdminReseller,
  type AdminResellerSettlement,
} from "@/lib/api";

/** همکاران فعال: توقف نمایش روی نقشه، پایان همکاری و صورتحساب مانده جهت تسویه. */
export default function ResellersPage() {
  const [items, setItems] = useState<AdminReseller[] | null>(null);
  const [open, setOpen] = useState<AdminReseller | null>(null);

  function reload() {
    fetchAdminResellers().then(setItems).catch(() => setItems([]));
  }
  useEffect(reload, []);

  return (
    <div className="p-5 lg:p-7 max-w-[960px] mx-auto">
      <h1 className="text-xl font-extrabold">همکاران و نمایندگان</h1>
      <p className="text-[13.5px] text-muted mt-1">مدیریت نمایش روی نقشه، پایان همکاری و تسویه‌ی مانده‌ی کمیسیون</p>
      <Card className="mt-5 p-2">
        {items === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">هنوز نماینده‌ای تأیید نشده است</div>
        ) : (
          items.map((r, i) => (
            <div key={r.id} onClick={() => setOpen(r)} className={`flex items-center gap-3 px-4 py-3.5 flex-wrap cursor-pointer hover:bg-slate-50 ${i < items.length - 1 ? "border-b border-border" : ""}`}>
              <div className="flex-1 min-w-[180px]">
                <div className="text-[13px] font-bold">{r.name}</div>
                <div className="text-[11.5px] text-muted mt-0.5">{[r.phone, r.city].filter(Boolean).join(" · ") || "—"}</div>
              </div>
              <Badge tone={r.cooperationStatus === "ACTIVE" ? "success" : r.cooperationStatus === "END_REQUESTED" ? "warning" : "danger"}>
                {r.cooperationStatus === "ACTIVE" ? "فعال" : r.cooperationStatus === "END_REQUESTED" ? "درخواست پایان" : "پایان‌یافته"}
              </Badge>
              {r.hiddenFromMap && <Badge tone="neutral">پنهان از نقشه</Badge>}
              <div className="text-[12px] font-bold shrink-0">مانده: {formatToman(r.amountDue)}</div>
            </div>
          ))
        )}
      </Card>
      {open && <ResellerModal reseller={open} onClose={() => setOpen(null)} onChanged={() => { reload(); setOpen(null); }} />}
    </div>
  );
}

function ResellerModal({ reseller, onClose, onChanged }: { reseller: AdminReseller; onClose: () => void; onChanged: () => void }) {
  const [settlements, setSettlements] = useState<AdminResellerSettlement[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetchAdminResellerSettlements(reseller.id).then(setSettlements).catch(() => setSettlements([]));
  }
  useEffect(load, [reseller.id]);

  async function run(fn: () => Promise<unknown>, closeAfter = false) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (closeAfter) onChanged();
      else load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "انجام عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={reseller.name} onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-3.5 text-[12.5px]">
        <div className="border border-border rounded-xl overflow-hidden">
          {[
            ["موبایل", reseller.phone],
            ["شهر", reseller.city],
            ["احراز هویت", reseller.isVerified ? "تأیید شده" : "تأیید نشده"],
            ["دسترسی ورود", reseller.hasAccess ? "دارد" : "ندارد"],
            ["کل کمیسیون", formatToman(reseller.totalCommission)],
            ["مانده‌ی تسویه", formatToman(reseller.amountDue)],
            ["دلیل پایان", reseller.endReason],
          ].map(([l, v]) => (
            <div key={l as string} className="flex border-b border-border last:border-b-0">
              <div className="w-[110px] shrink-0 bg-slate-50 text-[11.5px] font-bold text-muted px-3 py-2.5">{l}</div>
              <div className="flex-1 px-3 py-2.5">{(v as string) || "—"}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button disabled={busy} onClick={() => run(() => setAdminResellerMapVisibility(reseller.id, !reseller.hiddenFromMap), true)} className="font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50">
            {reseller.hiddenFromMap ? "نمایش دوباره روی نقشه" : "توقف نمایش روی نقشه"}
          </button>
          {reseller.cooperationStatus !== "ENDED" && (
            <button
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("دلیل پایان همکاری:");
                if (reason && reason.trim().length >= 3) run(() => endAdminReseller(reseller.id, reason.trim()), true);
              }}
              className="font-bold text-danger bg-danger-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
            >
              پایان همکاری و صدور صورتحساب مانده
            </button>
          )}
          <button disabled={busy} onClick={() => run(() => createAdminResellerSettlement(reseller.id))} className="font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50">
            صدور صورتحساب مانده
          </button>
        </div>
        {error && <div className="text-danger font-semibold">{error}</div>}
        {settlements.map((s) => (
          <div key={s.id} className="bg-slate-50 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <b>صورتحساب {s.number}</b>
              <Badge tone={s.status === "SETTLED" ? "success" : "warning"}>{s.status === "SETTLED" ? "تسویه‌شده" : "در انتظار تسویه"}</Badge>
            </div>
            <div className="text-muted mt-1">کل {formatToman(s.totalCommission)} · پرداخت‌شده {formatToman(s.paidCommission)} · مانده <b className="text-ink">{formatToman(s.amountDue)}</b></div>
            {s.status === "ISSUED" && (
              <button disabled={busy} onClick={() => run(() => settleAdminResellerSettlement(s.id))} className="mt-2 text-[11.5px] font-bold text-success bg-success-soft px-3 py-1 rounded-lg cursor-pointer disabled:opacity-50">
                ثبت تسویه‌شده
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
