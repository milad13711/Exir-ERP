"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ReceiptIcon, PlusIcon, SearchIcon, SettingsIcon, DocsIcon, CalendarIcon, WarningIcon } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchSalesInvoices,
  fetchDeliverySmsTemplate,
  fetchSalesQuotations,
  fetchRecurringInvoices,
  fetchSalesReturns,
  type SalesInvoice,
  type SalesInvoiceStatus,
  type SalesQuotation,
  type SalesQuotationStatus,
  type RecurringInvoiceTemplate,
  type RecurrenceFrequency,
  type SalesReturn,
} from "@/lib/api";
import { NewInvoiceModal, type InvoicePrefill } from "@/components/sales/NewInvoiceModal";
import { InvoiceDetailModal } from "@/components/sales/InvoiceDetailModal";
import { DeliverySmsTemplateModal } from "@/components/sales/DeliverySmsTemplateModal";
import { NewQuotationModal } from "@/components/sales/NewQuotationModal";
import { QuotationDetailModal } from "@/components/sales/QuotationDetailModal";
import { NewRecurringInvoiceModal } from "@/components/sales/NewRecurringInvoiceModal";
import { RecurringInvoiceDetailModal } from "@/components/sales/RecurringInvoiceDetailModal";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  WEEKLY: "هفتگی",
  MONTHLY: "ماهانه",
  QUARTERLY: "فصلی",
  YEARLY: "سالانه",
};

const STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  DRAFT: "پیش‌نویس",
  CONFIRMED: "تأییدشده",
  PARTIALLY_PAID: "پرداخت جزئی",
  PAID: "پرداخت‌شده",
  CANCELLED: "باطل‌شده",
};

const STATUS_TONES: Record<SalesInvoiceStatus, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  CONFIRMED: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "danger",
};

const QUOTATION_STATUS_LABELS: Record<SalesQuotationStatus, string> = {
  DRAFT: "پیش‌نویس",
  SENT: "ارسال‌شده",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "ردشده",
  EXPIRED: "منقضی‌شده",
  CONVERTED: "تبدیل‌شده",
};

const QUOTATION_STATUS_TONES: Record<SalesQuotationStatus, "neutral" | "warning" | "success" | "danger" | "primary"> = {
  DRAFT: "neutral",
  SENT: "warning",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "danger",
  CONVERTED: "primary",
};

type Tab = "invoices" | "quotations" | "recurring" | "returns";

export default function SalesPage() {
  const [tab, setTab] = useState<Tab>("invoices");
  const [invoices, setInvoices] = useState<SalesInvoice[] | null>(null);
  const [quotations, setQuotations] = useState<SalesQuotation[] | null>(null);
  const [recurring, setRecurring] = useState<RecurringInvoiceTemplate[] | null>(null);
  const [returns, setReturns] = useState<SalesReturn[] | null>(null);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newQuotationOpen, setNewQuotationOpen] = useState(false);
  const [newRecurringOpen, setNewRecurringOpen] = useState(false);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [openQuotationId, setOpenQuotationId] = useState<string | null>(null);
  const [openRecurringId, setOpenRecurringId] = useState<string | null>(null);
  const [smsTemplate, setSmsTemplate] = useState("");
  const [smsTemplateModalOpen, setSmsTemplateModalOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  const dealPrefill: InvoicePrefill | undefined = searchParams.get("dealId")
    ? {
        contactId: searchParams.get("contactId") ?? undefined,
        dealId: searchParams.get("dealId") ?? undefined,
        description: searchParams.get("title") ?? undefined,
        unitPrice: searchParams.get("value") ? Number(searchParams.get("value")) : undefined,
      }
    : undefined;

  function reload() {
    fetchSalesInvoices().then(setInvoices).catch(() => setInvoices([]));
  }
  function reloadQuotations() {
    fetchSalesQuotations().then(setQuotations).catch(() => setQuotations([]));
  }
  function reloadRecurring() {
    fetchRecurringInvoices().then(setRecurring).catch(() => setRecurring([]));
  }
  function reloadReturns() {
    fetchSalesReturns().then(setReturns).catch(() => setReturns([]));
  }
  useEffect(reload, []);
  useEffect(reloadQuotations, []);
  useEffect(reloadRecurring, []);
  useEffect(reloadReturns, []);
  useEffect(() => {
    fetchDeliverySmsTemplate()
      .then((res) => setSmsTemplate(res.template))
      .catch(() => {});
  }, []);

  const showNewModal = newOpen || Boolean(dealPrefill);

  const filtered = (invoices ?? []).filter((inv) => {
    if (!search.trim()) return true;
    const q = search.trim();
    return (
      inv.contact.name.includes(q) ||
      (inv.contact.company ?? "").includes(q) ||
      String(inv.invoiceNo).includes(q)
    );
  });

  const filteredQuotations = (quotations ?? []).filter((q) => {
    if (!search.trim()) return true;
    const term = search.trim();
    return (
      q.contact.name.includes(term) ||
      (q.contact.company ?? "").includes(term) ||
      String(q.quotationNo).includes(term)
    );
  });

  return (
    <div className="p-5 lg:p-7 max-w-[1000px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">فروش و فاکتور</h1>
            <ModuleHelp code="sales" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">
            از سفارش فروش تا فاکتور و پرداخت — با اتصال خودکار به انبار و حسابداری
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setSmsTemplateModalOpen(true)}
            title="متن پیامک کد تأیید تحویل"
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <SettingsIcon className="w-4 h-4" />
            تنظیمات فاکتور
          </button>
          {tab === "quotations" ? (
            <button
              onClick={() => setNewQuotationOpen(true)}
              className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
            >
              <PlusIcon className="w-4 h-4" />
              پیش‌فاکتور جدید
            </button>
          ) : tab === "recurring" ? (
            <button
              onClick={() => setNewRecurringOpen(true)}
              className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
            >
              <PlusIcon className="w-4 h-4" />
              الگوی تکرارشونده جدید
            </button>
          ) : tab === "returns" ? null : (
            <button
              onClick={() => setNewOpen(true)}
              className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
            >
              <PlusIcon className="w-4 h-4" />
              فاکتور جدید
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-5 overflow-x-auto">
        <button
          onClick={() => setTab("invoices")}
          className={`flex items-center gap-1.5 text-[12.5px] font-bold px-3.5 py-2 rounded-xl cursor-pointer shrink-0 whitespace-nowrap ${
            tab === "invoices" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
          }`}
        >
          <ReceiptIcon className="w-4 h-4" />
          فاکتورها
        </button>
        <button
          onClick={() => setTab("quotations")}
          className={`flex items-center gap-1.5 text-[12.5px] font-bold px-3.5 py-2 rounded-xl cursor-pointer shrink-0 whitespace-nowrap ${
            tab === "quotations" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
          }`}
        >
          <DocsIcon className="w-4 h-4" />
          پیش‌فاکتورها
        </button>
        <button
          onClick={() => setTab("recurring")}
          className={`flex items-center gap-1.5 text-[12.5px] font-bold px-3.5 py-2 rounded-xl cursor-pointer shrink-0 whitespace-nowrap ${
            tab === "recurring" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
          }`}
        >
          <CalendarIcon className="w-4 h-4" />
          فاکتورهای تکرارشونده
        </button>
        <button
          onClick={() => setTab("returns")}
          className={`flex items-center gap-1.5 text-[12.5px] font-bold px-3.5 py-2 rounded-xl cursor-pointer shrink-0 whitespace-nowrap ${
            tab === "returns" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
          }`}
        >
          <WarningIcon className="w-4 h-4" />
          مرجوعی‌ها
        </button>
      </div>

      <div className="relative max-w-[320px] mt-4 mb-4">
        <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === "quotations" ? "جستجوی مشتری یا شماره پیش‌فاکتور..." : "جستجوی مشتری یا شماره فاکتور..."}
          className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
        />
      </div>

      {tab === "returns" ? (
        <Card className="p-2">
          {returns === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : returns.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
              <WarningIcon className="w-6 h-6" />
              هنوز مرجوعی‌ای ثبت نشده است
            </div>
          ) : (
            returns.map((r, i) => (
              <button
                key={r.id}
                onClick={() => setOpenInvoiceId(r.invoice.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                  i < returns.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold">مرجوعی #{r.returnNo}</span>
                    <Badge tone="danger">فاکتور #{r.invoice.invoiceNo}</Badge>
                  </div>
                  <div className="text-[11.5px] text-muted mt-1">
                    {r.invoice.contact.company || r.invoice.contact.name} · {formatJalaliDate(r.createdAt)}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </div>
                </div>
                <div className="text-[13px] font-extrabold shrink-0 text-danger">-{formatToman(r.total)}</div>
              </button>
            ))
          )}
        </Card>
      ) : tab === "recurring" ? (
        <Card className="p-2">
          {recurring === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : recurring.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
              <CalendarIcon className="w-6 h-6" />
              هنوز الگوی تکرارشونده‌ای ثبت نشده است
            </div>
          ) : (
            recurring.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setOpenRecurringId(t.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                  i < recurring.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold">{t.contact.company || t.contact.name}</span>
                    <Badge tone={t.isActive ? "success" : "neutral"}>{t.isActive ? "فعال" : "غیرفعال"}</Badge>
                  </div>
                  <div className="text-[11.5px] text-muted mt-1">
                    {FREQUENCY_LABELS[t.frequency]} · صدور بعدی: {formatJalaliDate(t.nextRunAt)}
                  </div>
                </div>
              </button>
            ))
          )}
        </Card>
      ) : tab === "quotations" ? (
        <Card className="p-2">
          {quotations === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : filteredQuotations.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
              <DocsIcon className="w-6 h-6" />
              پیش‌فاکتوری ثبت نشده است
            </div>
          ) : (
            filteredQuotations.map((q, i) => (
              <button
                key={q.id}
                onClick={() => setOpenQuotationId(q.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                  i < filteredQuotations.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold">پیش‌فاکتور #{q.quotationNo}</span>
                    <Badge tone={QUOTATION_STATUS_TONES[q.status]}>{QUOTATION_STATUS_LABELS[q.status]}</Badge>
                  </div>
                  <div className="text-[11.5px] text-muted mt-1">
                    {q.contact.company || q.contact.name} · {formatJalaliDate(q.issuedAt)}
                  </div>
                </div>
                <div className="text-[13px] font-extrabold shrink-0">{formatToman(q.total)}</div>
              </button>
            ))
          )}
        </Card>
      ) : (
      <Card className="p-2">
        {invoices === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
            <ReceiptIcon className="w-6 h-6" />
            فاکتوری ثبت نشده است
          </div>
        ) : (
          filtered.map((inv, i) => (
            <button
              key={inv.id}
              onClick={() => setOpenInvoiceId(inv.id)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                i < filtered.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold">فاکتور #{inv.invoiceNo}</span>
                  {inv.hasReturn ? (
                    <Badge tone="danger">مرجوع‌شده</Badge>
                  ) : (
                    <Badge tone={STATUS_TONES[inv.status]}>{STATUS_LABELS[inv.status]}</Badge>
                  )}
                </div>
                <div className="text-[11.5px] text-muted mt-1">
                  {inv.contact.company || inv.contact.name} · {formatJalaliDate(inv.issuedAt)}
                  {inv.dueAt ? ` · سررسید: ${formatJalaliDate(inv.dueAt)}` : ""}
                </div>
              </div>
              <div className="text-[13px] font-extrabold shrink-0">{formatToman(inv.total)}</div>
            </button>
          ))
        )}
      </Card>
      )}

      {showNewModal ? (
        <NewInvoiceModal
          prefill={dealPrefill}
          onClose={() => {
            setNewOpen(false);
            if (dealPrefill) router.replace("/sales");
          }}
          onCreated={(inv) => {
            reload();
            setOpenInvoiceId(inv.id);
            if (dealPrefill) router.replace("/sales");
          }}
        />
      ) : null}

      {openInvoiceId ? (
        <InvoiceDetailModal
          invoiceId={openInvoiceId}
          onClose={() => setOpenInvoiceId(null)}
          onChanged={() => {
            reload();
            reloadReturns();
          }}
        />
      ) : null}

      {smsTemplateModalOpen ? (
        <DeliverySmsTemplateModal
          currentTemplate={smsTemplate}
          onClose={() => setSmsTemplateModalOpen(false)}
          onSaved={setSmsTemplate}
        />
      ) : null}

      {newQuotationOpen ? (
        <NewQuotationModal
          onClose={() => setNewQuotationOpen(false)}
          onCreated={(q) => {
            reloadQuotations();
            setOpenQuotationId(q.id);
          }}
        />
      ) : null}

      {newRecurringOpen ? (
        <NewRecurringInvoiceModal
          onClose={() => setNewRecurringOpen(false)}
          onCreated={(t) => {
            reloadRecurring();
            setOpenRecurringId(t.id);
          }}
        />
      ) : null}

      {openRecurringId ? (
        <RecurringInvoiceDetailModal
          templateId={openRecurringId}
          onClose={() => setOpenRecurringId(null)}
          onChanged={reloadRecurring}
        />
      ) : null}

      {openQuotationId ? (
        <QuotationDetailModal
          quotationId={openQuotationId}
          onClose={() => setOpenQuotationId(null)}
          onChanged={reloadQuotations}
          onConverted={(invoiceId) => {
            reload();
            setTab("invoices");
            setOpenInvoiceId(invoiceId);
          }}
        />
      ) : null}
    </div>
  );
}
