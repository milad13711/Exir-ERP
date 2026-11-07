"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import Link from "next/link";
import { ApiError, fetchSubscriptionSummary, fetchInvoices, requestRenewalInvoice, type SubscriptionSummary, type Invoice, type SubscriptionEntitlement } from "@/lib/api";
import { STATE_LABEL, STATE_TONE, invoiceHint, moduleDetail, tenantDetail } from "@/lib/subscription-copy";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { useWorkspace } from "@/lib/workspace-context";

const invoiceStatusLabel: Record<Invoice["status"], string> = {
  PAID: "پرداخت‌شده",
  PENDING: "در انتظار پرداخت",
  FAILED: "ناموفق",
};
const invoiceStatusTone: Record<Invoice["status"], "success" | "warning" | "danger"> = {
  PAID: "success",
  PENDING: "warning",
  FAILED: "danger",
};
const invoicePurposeLabel: Record<NonNullable<Invoice["purpose"]>, string> = {
  TENANT_SETUP: "راه‌اندازی محیط کاری",
  PLAN_RENEWAL: "تمدید پلن",
  MODULE_PURCHASE: "خرید ماژول",
  MODULE_RENEWAL: "تمدید ماژول",
  SMS_PACKAGE: "بسته‌ی پیامک",
};
const BILLING_MODE_LABEL: Record<string, string> = { MONTHLY: "اشتراک ماهانه", YEARLY: "اشتراک سالانه", LICENSE: "لایسنس مادام‌العمر" };

function ActionButton({ e, moduleCode, onDone, light = false }: { e: SubscriptionEntitlement; moduleCode?: string; onDone: () => void; light?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cls = light ? "bg-white text-indigo-800" : "bg-primary text-white";
  if (e.nextAction === "PAY_INVOICE" && e.openInvoice) {
    return (
      <a href={`/pay/${e.openInvoice.id}`} className={`${cls} font-bold text-[13px] px-5 py-2.5 rounded-[11px] inline-block`}>
        پرداخت فاکتور تمدید
      </a>
    );
  }
  if (e.nextAction === "REQUEST_INVOICE") {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          disabled={busy}
          className={`${cls} font-bold text-[13px] px-5 py-2.5 rounded-[11px] disabled:opacity-60`}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await requestRenewalInvoice(moduleCode);
              onDone();
              if (r.status === "PENDING") window.location.href = `/pay/${r.invoiceId}`;
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "درخواست ثبت نشد");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "در حال ثبت..." : "درخواست صدور فاکتور تمدید"}
        </button>
        {error ? <span className="text-[11.5px] text-danger">{error}</span> : null}
      </div>
    );
  }
  if (e.nextAction === "CONTACT_SUPPORT") return <span className={`${light ? "text-white/90" : "text-ink-soft"} text-[12.5px] font-semibold`}>برای تمدید با پشتیبانی تماس بگیرید</span>;
  return null;
}

export default function BillingSettingsPage() {
  const { refreshSubscription } = useWorkspace();
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);

  function load() {
    fetchSubscriptionSummary().then(setSummary).catch(() => setFailed(true));
    fetchInvoices().then(setInvoices).catch(() => setInvoices([]));
    refreshSubscription(); // هدر هم با همین وضعیت تازه هماهنگ بماند
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const t = summary?.tenant;
  const admin = summary?.viewer === "ADMIN";
  const tracked = (summary?.modules ?? []).filter((m) => !(m.isCore && m.state === "NO_EXPIRY") && m.state !== "NOT_SUBSCRIBED");
  const coreCount = (summary?.modules ?? []).filter((m) => m.isCore && m.state === "NO_EXPIRY").length;

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <h1 className="text-xl font-extrabold">اشتراک و صورتحساب</h1>
        <ModuleHelp code="subscription" />
      </div>
      <p className="text-[13.5px] text-muted mt-1">وضعیت پلن و ماژول‌ها، تمدید و تاریخچه‌ی پرداخت‌ها</p>

      {failed ? <Card className="mt-6 p-6 text-[13px] text-danger">دریافت وضعیت اشتراک ناموفق بود؛ صفحه را دوباره باز کنید.</Card> : null}

      <Card className="mt-6 p-6 bg-gradient-to-br from-indigo-800 to-teal-600 border-0 text-white">
        {!t ? (
          <div className="text-[13px] text-white/80">در حال بارگذاری...</div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[13px] text-white/75">{t.source === "ON_PREMISE_LICENSE" ? "لایسنس استقرار اختصاصی" : "پلن فعلی"}</div>
              <div className="text-2xl font-extrabold mt-1 flex items-center gap-2.5 flex-wrap">
                {t.source === "ON_PREMISE_LICENSE" ? "استقرار اختصاصی" : (t.planName ?? "بدون اشتراک فعال")}
                <span className="text-[11px] font-bold bg-white/20 rounded-lg px-2.5 py-1">{STATE_LABEL[t.state]}</span>
              </div>
              <div className="text-[13px] text-white/90 mt-2">{tenantDetail(t)}</div>
              {admin && t.expiresAt && t.state !== "NO_EXPIRY" ? <div className="text-[12px] text-white/75 mt-1">تاریخ پایان: {formatJalaliDate(t.expiresAt)}</div> : null}
              {admin && invoiceHint(t) ? <div className="text-[12px] text-white/75 mt-1">{invoiceHint(t)}</div> : null}
              {admin && t.staleRecord ? <div className="text-[12px] text-white/75 mt-1">تاریخ پایانِ اشتراک شما به‌روز نیست؛ در صورت مشکل با پشتیبانی تماس بگیرید.</div> : null}
            </div>
            {admin ? <ActionButton e={t} onDone={load} light /> : null}
          </div>
        )}
      </Card>

      {admin && summary ? (
        <div className="mt-7">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[14.5px] font-bold">ماژول‌ها</div>
            <Link href="/settings/modules" className="text-[12.5px] font-bold text-primary">فروشگاه ماژول‌ها</Link>
          </div>
          <Card className="overflow-hidden">
            {tracked.length === 0 ? (
              <div className="p-6 text-center text-muted text-sm">ماژول اشتراکی فعالی ندارید</div>
            ) : (
              tracked.map((m, i) => (
                <div key={m.code} className={`p-4 flex flex-wrap items-center justify-between gap-3 ${i < tracked.length - 1 ? "border-b border-border" : ""}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-bold">{m.name}</span>
                      <Badge tone={STATE_TONE[m.state]}>{STATE_LABEL[m.state]}</Badge>
                      {m.billingMode ? <span className="text-[11.5px] text-muted">{BILLING_MODE_LABEL[m.billingMode]}</span> : null}
                    </div>
                    <div className="text-[12.5px] text-ink-soft mt-1">{moduleDetail(m)}</div>
                    {invoiceHint(m) ? <div className="text-[11.5px] text-muted mt-0.5">{invoiceHint(m)}</div> : null}
                  </div>
                  <ActionButton e={m} moduleCode={m.code} onDone={load} />
                </div>
              ))
            )}
          </Card>
          {coreCount > 0 ? <p className="text-[12px] text-muted mt-2">{toPersianDigits(coreCount)} ماژول پایه همراه پلن شماست و تاریخ انقضا ندارد.</p> : null}
        </div>
      ) : null}

      <div className="mt-7">
        <div className="text-[14.5px] font-bold mb-3">تاریخچه‌ی صورتحساب</div>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-4 pb-3">شماره فاکتور</th>
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-4 pb-3">بابت</th>
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-4 pb-3">تاریخ</th>
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-4 pb-3">مبلغ</th>
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-4 pb-3">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {invoices === null ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted text-sm">
                    در حال بارگذاری...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted text-sm">
                    هنوز صورتحسابی صادر نشده است
                  </td>
                </tr>
              ) : (
                invoices.map((inv, i) => (
                  <tr key={inv.id} className={i < invoices.length - 1 ? "border-b border-border" : ""}>
                    <td className="p-4 text-[13px] font-semibold" dir="ltr">
                      {inv.id.slice(0, 8)}
                    </td>
                    <td className="p-4 text-[12.5px] text-ink-soft">
                      {inv.items && inv.items.length > 0
                        ? inv.items.map((it) => `${it.moduleName}${BILLING_MODE_LABEL[it.billingMode] ? ` (${BILLING_MODE_LABEL[it.billingMode]})` : ""}`).join("، ")
                        : inv.purpose
                          ? invoicePurposeLabel[inv.purpose]
                          : "—"}
                    </td>
                    <td className="p-4 text-[13px] text-muted">{formatJalaliDate(inv.issuedAt)}</td>
                    <td className="p-4 text-[13px] font-semibold">{formatToman(inv.amount)}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Badge tone={invoiceStatusTone[inv.status]}>
                          {invoiceStatusLabel[inv.status]}
                        </Badge>
                        {inv.status === "PENDING" ? (
                          <a href={`/pay/${inv.id}`} target="_blank" rel="noopener" className="text-[11.5px] font-bold text-primary">
                            پرداخت
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
