"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { EmptyState, ListSkeleton } from "@/components/ui/EmptyState";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/ui/PageHeader";
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
    <div className="p-4 sm:p-5 lg:p-7 max-w-[960px] mx-auto">
      <PageHeader title="همکاران و نمایندگان" subtitle="مدیریت نمایش روی نقشه، پایان همکاری و تسویه‌ی مانده‌ی کمیسیون" />
      <div className="mt-5 flex flex-col gap-3">
        {items === null ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <EmptyState icon={<UsersIcon className="w-6 h-6" />}>هنوز نماینده‌ای تأیید نشده است</EmptyState>
        ) : (
          items.map((r) => (
            <Card key={r.id} className="p-4 cursor-pointer hover:border-primary/30 transition-colors" onClick={() => setOpen(r)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-extrabold">{r.name}</div>
                  <div className="text-[11.5px] text-muted mt-1">{[r.phone, r.city].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <Badge tone={r.cooperationStatus === "ACTIVE" ? "success" : r.cooperationStatus === "END_REQUESTED" ? "warning" : "danger"}>
                  {r.cooperationStatus === "ACTIVE" ? "فعال" : r.cooperationStatus === "END_REQUESTED" ? "درخواست پایان" : "پایان‌یافته"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap mt-3 pt-3 border-t border-border">
                <div className="text-[12.5px]">
                  <span className="text-muted">مانده: </span>
                  <span className="font-extrabold">{formatToman(r.amountDue)}</span>
                </div>
                {r.hiddenFromMap && <Badge tone="neutral">پنهان از نقشه</Badge>}
              </div>
            </Card>
          ))
        )}
      </div>
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
        <div className="flex items-center gap-2 flex-wrap [&>button]:max-sm:w-full">
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
