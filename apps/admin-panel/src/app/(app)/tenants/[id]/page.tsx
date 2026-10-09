"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BuildingIcon, UsersIcon, ClockIcon, WarningIcon, PackageIcon, TrashIcon, ReceiptIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDate, formatToman, toPersianDigits } from "@/lib/persian";
import {
  fetchTenant,
  fetchTenantStats,
  fetchTenantModules,
  fetchTenantInvoices,
  markInvoicePaid,
  deleteTenantInvoice,
  markInvoiceUnpaid,
  openInvoicePdf,
  setTenantModule,
  reactivateTenant,
  ApiError,
  type AdminTenant,
  type TenantStats,
  type TenantModuleEntry,
  type TenantInvoice,
} from "@/lib/api";
import { RenewTenantModal } from "@/components/tenants/RenewTenantModal";
import { DeleteTenantModal } from "@/components/tenants/DeleteTenantModal";
import { SuspendTenantModal } from "@/components/tenants/SuspendTenantModal";
import { ModuleInvoiceModal } from "@/components/tenants/ModuleInvoiceModal";
import { SubscriptionSmsCard } from "@/components/tenants/SubscriptionSmsCard";
import { TenantTwoFactorCard } from "@/components/tenants/TenantTwoFactorCard";
import { IssueInvoiceModal } from "@/components/tenants/IssueInvoiceModal";
import { SaveAsTemplateModal } from "@/components/tenants/SaveAsTemplateModal";

const INVOICE_STATUS_LABELS: Record<TenantInvoice["status"], string> = {
  PENDING: "در انتظار پرداخت",
  PAID: "پرداخت‌شده",
  FAILED: "ناموفق",
};

const INVOICE_STATUS_TONES: Record<TenantInvoice["status"], "success" | "warning" | "danger"> = {
  PENDING: "warning",
  PAID: "success",
  FAILED: "danger",
};

const STATUS_LABELS: Record<AdminTenant["status"], string> = {
  PENDING_PROVISION: "در حال راه‌اندازی",
  PENDING_PAYMENT: "در انتظار پرداخت فاکتور",
  ACTIVE: "فعال",
  SUSPENDED: "معلق",
  CANCELLED: "لغوشده",
};

const STATUS_TONES: Record<AdminTenant["status"], "success" | "warning" | "danger" | "neutral"> = {
  PENDING_PROVISION: "warning",
  PENDING_PAYMENT: "warning",
  ACTIVE: "success",
  SUSPENDED: "danger",
  CANCELLED: "neutral",
};

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-border rounded-xl p-3.5">
      <div className="flex items-center gap-2 text-muted mb-2">
        {icon}
        <span className="text-[11.5px]">{label}</span>
      </div>
      <div className="text-[16px] font-extrabold">{value}</div>
    </div>
  );
}

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tenant, setTenant] = useState<AdminTenant | null>(null);
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [modules, setModules] = useState<TenantModuleEntry[] | null>(null);
  const [invoices, setInvoices] = useState<TenantInvoice[] | null>(null);
  const [renewOpen, setRenewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [moduleInvoiceOpen, setModuleInvoiceOpen] = useState(false);
  const [editInvoice, setEditInvoice] = useState<TenantInvoice | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [copiedInvoiceId, setCopiedInvoiceId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleCopyPaymentLink(invoiceId: string) {
    const url = `${process.env.NEXT_PUBLIC_WEB_PANEL_URL ?? window.location.origin}/pay/${invoiceId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInvoiceId(invoiceId);
      setTimeout(() => setCopiedInvoiceId(null), 2000);
    } catch {
      window.prompt("لینک پرداخت برای مشتری:", url);
    }
  }

  function reload() {
    fetchTenant(id).then((t) => {
      setTenant(t);
      const periodEnd = t.subscriptions[0]?.currentPeriodEnd;
      setDaysLeft(periodEnd ? Math.max(0, Math.ceil((new Date(periodEnd).getTime() - Date.now()) / 86400000)) : null);
    }).catch(() => {});
    fetchTenantStats(id).then(setStats).catch(() => {});
    fetchTenantModules(id).then(setModules).catch(() => setModules([]));
    fetchTenantInvoices(id).then(setInvoices).catch(() => setInvoices([]));
  }
  useEffect(reload, [id]);

  async function handleMarkPaid(invoiceId: string) {
    setActionError(null);
    try {
      await markInvoicePaid(id, invoiceId);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "ثبت پرداخت ناموفق بود");
    }
  }

  async function handleToggleModule(mod: TenantModuleEntry) {
    setActionError(null);
    try {
      const current = mod.tenantModules[0]?.status;
      const next = current === "INSTALLED" ? "DISABLED" : "INSTALLED";
      await setTenantModule(id, mod.code, next);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "تغییر وضعیت ماژول ناموفق بود");
    }
  }

  async function handleReactivate() {
    setActionError(null);
    try {
      await reactivateTenant(id);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "فعال‌سازی مجدد ناموفق بود");
    }
  }

  if (deleted) {
    return (
      <div className="p-8 text-center text-muted">
        این تننت حذف شد. <Link href="/tenants" className="text-primary font-bold">بازگشت به لیست</Link>
      </div>
    );
  }

  if (!tenant) {
    return <div className="p-8 text-center text-muted">در حال بارگذاری...</div>;
  }

  const subscription = tenant.subscriptions[0];

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[900px] mx-auto">
      <Link href="/tenants" className="text-[12.5px] text-muted font-semibold">
        → بازگشت به لیست تننت‌ها
      </Link>

      {actionError && (
        <div className="mt-3 text-[12.5px] text-danger font-semibold bg-danger-soft rounded-xl px-3.5 py-2.5">{actionError}</div>
      )}

      <div className="flex items-start justify-between gap-4 flex-wrap mt-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
            <BuildingIcon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[20px] font-extrabold tracking-tight">{tenant.name}</h1>
              <Badge tone={STATUS_TONES[tenant.status]}>{STATUS_LABELS[tenant.status]}</Badge>
            </div>
            <div className="text-[12px] text-muted mt-1 font-mono" dir="ltr">
              {tenant.slug} · {tenant.dbName}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap max-sm:w-full">
          <button
            onClick={() => setRenewOpen(true)}
            className="text-[12.5px] font-bold text-primary bg-primary-soft px-3.5 py-2 rounded-xl cursor-pointer"
          >
            تمدید اشتراک
          </button>
          <button
            onClick={() => setSaveTemplateOpen(true)}
            className="text-[12.5px] font-bold text-ink-soft bg-slate-100 px-3.5 py-2 rounded-xl cursor-pointer"
            title="ساخت قالب صنف جدید از تنظیمات این تننت"
          >
            ذخیره به‌عنوان قالب صنف
          </button>
          {tenant.status === "ACTIVE" ? (
            <button
              onClick={() => setSuspendOpen(true)}
              className="text-[12.5px] font-bold text-danger bg-danger-soft px-3.5 py-2 rounded-xl cursor-pointer"
            >
              تعلیق
            </button>
          ) : tenant.status === "SUSPENDED" ? (
            <button
              onClick={handleReactivate}
              className="text-[12.5px] font-bold text-success bg-success-soft px-3.5 py-2 rounded-xl cursor-pointer"
            >
              فعال‌سازی مجدد
            </button>
          ) : null}
          <button
            onClick={() => setDeleteOpen(true)}
            className="w-9 h-9 rounded-xl bg-danger-soft text-danger flex items-center justify-center cursor-pointer"
            title="حذف دائمی"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {subscription ? (
        <Card className="mt-5 p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <Badge tone="primary">{subscription.plan.name}</Badge>
            <span className="text-[12px] text-muted">
              انقضا: {formatJalaliDate(subscription.currentPeriodEnd)}
            </span>
          </div>
          <span className="text-[12px] text-muted">
            {daysLeft !== null ? `${toPersianDigits(daysLeft)} روز باقی‌مانده` : ""}
          </span>
        </Card>
      ) : null}
      {subscription ? (
        <SubscriptionSmsCard
          tenantId={id}
          currentPeriodEnd={subscription.currentPeriodEnd}
          status={subscription.status}
          lifetime={(subscription as { lifetime?: boolean }).lifetime}
          onChanged={reload}
        />
      ) : null}
      <TenantTwoFactorCard tenantId={id} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        <StatTile icon={<UsersIcon className="w-4 h-4" />} label="کاربران فعال" value={stats ? toPersianDigits(stats.userCount) : "..."} />
        <StatTile icon={<ClockIcon className="w-4 h-4" />} label="وظایف باز" value={stats ? toPersianDigits(stats.openTaskCount) : "..."} />
        <StatTile
          icon={<WarningIcon className="w-4 h-4" />}
          label="خطای ۷ روز اخیر"
          value={stats ? toPersianDigits(stats.recentErrorCount) : "..."}
        />
        <StatTile
          icon={<ClockIcon className="w-4 h-4" />}
          label="آخرین فعالیت"
          value={stats?.lastActivityAt ? formatJalaliDate(stats.lastActivityAt) : "—"}
        />
      </div>

      <Card className="mt-5 p-5">
        <div className="flex items-center gap-2 text-[13.5px] font-bold mb-3">
          <PackageIcon className="w-4 h-4" />
          دسترسی به ماژول‌ها
        </div>
        {modules === null ? (
          <div className="py-6 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : (
          modules.map((m, i) => {
            const status = m.tenantModules[0]?.status;
            const installed = status === "INSTALLED";
            return (
              <div
                key={m.id}
                className={`flex items-center justify-between flex-wrap gap-2 py-3 ${i < modules.length - 1 ? "border-b border-border" : ""}`}
              >
                <div>
                  <div className="text-[13px] font-semibold">
                    {m.name}
                    {m.isCore ? <span className="text-[10.5px] text-muted mr-1.5">(پایه)</span> : null}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">{m.category}</div>
                </div>
                <button
                  onClick={() => handleToggleModule(m)}
                  disabled={m.isCore}
                  className={`text-[11.5px] font-bold px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-default ${
                    installed ? "bg-success-soft text-success" : "bg-slate-100 text-ink-soft"
                  }`}
                >
                  {installed ? "نصب‌شده — قطع دسترسی" : "اعطای دسترسی"}
                </button>
              </div>
            );
          })
        )}
      </Card>

      <Card className="mt-5 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-[13.5px] font-bold">
            <ReceiptIcon className="w-4 h-4" />
            فاکتورها
          </div>
          <button
            onClick={() => setModuleInvoiceOpen(true)}
            className="flex items-center gap-1 text-[12px] font-bold text-white bg-primary px-3 py-1.5 rounded-lg cursor-pointer"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            فاکتور ماژول (اشتراک/لایسنس)
          </button>
          <button
            onClick={() => setInvoiceOpen(true)}
            className="flex items-center gap-1 text-[12px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            صدور فاکتور دستی
          </button>
        </div>
        {invoices === null ? (
          <div className="py-6 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : invoices.length === 0 ? (
          <div className="py-6 text-center text-muted text-sm">فاکتوری ثبت نشده است</div>
        ) : (
          invoices.map((inv, i) => (
            <div
              key={inv.id}
              className={`flex items-center justify-between flex-wrap gap-2 py-3 ${i < invoices.length - 1 ? "border-b border-border" : ""}`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold">{formatToman(inv.amount)}</span>
                  <Badge tone={INVOICE_STATUS_TONES[inv.status]}>{INVOICE_STATUS_LABELS[inv.status]}</Badge>
                </div>
                <div className="text-[11px] text-muted mt-1">
                  صدور: {formatJalaliDate(inv.issuedAt)} · مهلت: {formatJalaliDate(inv.dueAt)}
                  {inv.paidAt ? ` · پرداخت: ${formatJalaliDate(inv.paidAt)}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openInvoicePdf(id, inv.id)}
                  className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3.5 py-1.5 rounded-lg cursor-pointer"
                >
                  PDF
                </button>
                <button onClick={() => setEditInvoice(inv)} className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3.5 py-1.5 rounded-lg cursor-pointer">
                  ویرایش
                </button>
                {inv.status === "PAID" ? (
                  <button
                    onClick={async () => {
                      if (!window.confirm("این فاکتور به «در انتظار پرداخت» برگردد؟ (فعال‌سازی ماژول/اشتراک ناشی از آن خودکار برگردانده نمی‌شود.)")) return;
                      await markInvoiceUnpaid(id, inv.id);
                      reload();
                    }}
                    className="text-[11.5px] font-bold text-warning bg-warning-soft px-3.5 py-1.5 rounded-lg cursor-pointer"
                  >
                    بازگشت به پرداخت‌نشده
                  </button>
                ) : null}
                <button
                  onClick={async () => {
                    if (!window.confirm("این فاکتور برای همیشه حذف شود؟")) return;
                    await deleteTenantInvoice(id, inv.id);
                    reload();
                  }}
                  className="text-[11.5px] font-bold text-danger bg-danger-soft px-3.5 py-1.5 rounded-lg cursor-pointer"
                >
                  حذف
                </button>
                {inv.status === "PENDING" ? (
                  <>
                    <button
                      onClick={() => handleCopyPaymentLink(inv.id)}
                      className="text-[11.5px] font-bold text-primary bg-primary-soft px-3.5 py-1.5 rounded-lg cursor-pointer"
                    >
                      {copiedInvoiceId === inv.id ? "کپی شد ✓" : "لینک پرداخت"}
                    </button>
                    <button
                      onClick={() => handleMarkPaid(inv.id)}
                      className="text-[11.5px] font-bold text-success bg-success-soft px-3.5 py-1.5 rounded-lg cursor-pointer"
                    >
                      ثبت پرداخت دستی
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))
        )}
      </Card>

      {moduleInvoiceOpen ? <ModuleInvoiceModal tenantId={id} tenantName={tenant.name} onClose={() => setModuleInvoiceOpen(false)} onIssued={reload} /> : null}
      {editInvoice ? (
        <IssueInvoiceModal tenantId={id} tenantName={tenant.name} invoice={editInvoice} onClose={() => setEditInvoice(null)} onIssued={reload} />
      ) : null}
      {invoiceOpen ? (
        <IssueInvoiceModal
          tenantId={id}
          tenantName={tenant.name}
          suggestedAmount={subscription?.plan.priceMonthly}
          onClose={() => setInvoiceOpen(false)}
          onIssued={reload}
        />
      ) : null}

      {saveTemplateOpen ? (
        <SaveAsTemplateModal
          tenantId={id}
          tenantName={tenant.name}
          onClose={() => setSaveTemplateOpen(false)}
          onSaved={() => {}}
        />
      ) : null}

      {renewOpen ? (
        <RenewTenantModal
          tenantId={id}
          tenantName={tenant.name}
          onClose={() => setRenewOpen(false)}
          onRenewed={reload}
        />
      ) : null}

      {suspendOpen ? (
        <SuspendTenantModal tenant={tenant} onClose={() => setSuspendOpen(false)} onSuspended={reload} />
      ) : null}

      {deleteOpen ? (
        <DeleteTenantModal
          tenant={tenant}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => setDeleted(true)}
        />
      ) : null}
    </div>
  );
}
