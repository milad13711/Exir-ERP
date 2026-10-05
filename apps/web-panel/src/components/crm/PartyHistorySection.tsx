import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import {
  DocsIcon,
  BuildingIcon,
  CalendarIcon,
  CompassIcon,
  TicketIcon,
  ReceiptIcon,
  OrdersIcon,
  BillingIcon,
  TruckIcon,
  StoreIcon,
  ClipboardCheckIcon,
  ShieldIcon,
  ProposalIcon,
} from "@/components/icons";
import { PROPOSAL_STATUS_LABELS, PROPOSAL_STATUS_TONES } from "@/components/proposals/constants";
import { formatJalaliDate, formatJalaliDateTime, formatToman } from "@/lib/persian";
import {
  fetchContracts,
  fetchProjects,
  fetchAppointments,
  fetchMentoringSessions,
  fetchEventTicketsByContact,
  fetchSalesInvoices,
  fetchSalesQuotations,
  fetchChecks,
  fetchShipments,
  fetchStoreOrders,
  fetchFormSubmissionsByContact,
  fetchWarrantyCodes,
  fetchProposals,
  type ProposalListItem,
  type Contract,
  type Project,
  type Appointment,
  type MentoringSession,
  type EventTicket,
  type SalesInvoice,
  type SalesQuotation,
  type Check,
  type Shipment,
  type StoreOrder,
  type FormSubmissionByContact,
  type WarrantyCode,
} from "@/lib/api";

const WARRANTY_STATUS_LABELS: Record<string, string> = { PENDING: "صادرشده", ACTIVE: "فعال", EXPIRED: "منقضی", VOID: "باطل‌شده" };

const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "پیش‌نویس",
  CONFIRMED: "تأییدشده",
  PARTIALLY_PAID: "پرداخت جزئی",
  PAID: "پرداخت‌شده",
  CANCELLED: "لغوشده",
};

/**
 * A cross-module "این طرف‌حساب قبلاً چه کرده" history — every module that
 * links back to a CrmContact by contactId (contracts, projects,
 * appointments, mentoring sessions, event tickets, sales invoices/quotations,
 * checks, fleet shipments, online-store orders, form submissions), each from
 * its own module's existing ?contactId= filter (no new backend surface
 * beyond adding that same filter to modules that lacked it). A module a
 * tenant hasn't installed simply 403s and renders as an empty section
 * rather than an error, since not every tenant has every one of these
 * modules. This is the same phone-number identity every module already
 * resolves/links a CrmContact by (see resolveOrCreateContact in the
 * mentoring/events modules) — this section is just the read-side surface
 * of that shared identity.
 */
export function PartyHistorySection({ contactId }: { contactId: string }) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [sessions, setSessions] = useState<MentoringSession[]>([]);
  const [tickets, setTickets] = useState<Array<EventTicket & { event: { id: string; title: string; slug: string; startAt: string } }>>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [quotations, setQuotations] = useState<SalesQuotation[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [storeOrders, setStoreOrders] = useState<StoreOrder[]>([]);
  const [formSubmissions, setFormSubmissions] = useState<FormSubmissionByContact[]>([]);
  const [warrantyCodes, setWarrantyCodes] = useState<WarrantyCode[]>([]);
  const [proposals, setProposals] = useState<ProposalListItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // contactId عوض شده — وضعیت «در حال بارگذاری» عمداً همین‌جا صفر می‌شود، نه در callback، وگرنه لحظه‌ی کوتاهی داده‌های مخاطب قبلی نمایش داده می‌شود
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(false);
    Promise.allSettled([
      fetchContracts({ contactId }),
      fetchProjects({ contactId }),
      fetchAppointments({ contactId }),
      fetchMentoringSessions({ contactId }),
      fetchEventTicketsByContact(contactId),
      fetchSalesInvoices(contactId),
      fetchSalesQuotations(contactId),
      fetchChecks({ contactId }),
      fetchShipments(undefined, contactId),
      fetchStoreOrders(undefined, contactId),
      fetchFormSubmissionsByContact(contactId),
      fetchWarrantyCodes({ contactId }),
      fetchProposals({ contactId }),
    ]).then(([c, p, a, s, t, inv, q, chk, sh, so, fs, wc, pr]) => {
      setContracts(c.status === "fulfilled" ? c.value : []);
      setProjects(p.status === "fulfilled" ? p.value : []);
      setAppointments(a.status === "fulfilled" ? a.value : []);
      setSessions(s.status === "fulfilled" ? s.value : []);
      setTickets(t.status === "fulfilled" ? t.value : []);
      setInvoices(inv.status === "fulfilled" ? inv.value : []);
      setQuotations(q.status === "fulfilled" ? q.value : []);
      setChecks(chk.status === "fulfilled" ? chk.value : []);
      setShipments(sh.status === "fulfilled" ? sh.value : []);
      setStoreOrders(so.status === "fulfilled" ? so.value : []);
      setFormSubmissions(fs.status === "fulfilled" ? fs.value : []);
      setWarrantyCodes(wc.status === "fulfilled" ? wc.value : []);
      setProposals(pr.status === "fulfilled" ? pr.value : []);
      setLoaded(true);
    });
  }, [contactId]);

  const hasAny =
    contracts.length > 0 ||
    projects.length > 0 ||
    appointments.length > 0 ||
    sessions.length > 0 ||
    tickets.length > 0 ||
    invoices.length > 0 ||
    quotations.length > 0 ||
    checks.length > 0 ||
    shipments.length > 0 ||
    storeOrders.length > 0 ||
    formSubmissions.length > 0 ||
    warrantyCodes.length > 0 ||
    proposals.length > 0;
  if (loaded && !hasAny) return null;

  return (
    <div>
      <div className="text-[12px] font-semibold text-ink-soft mb-2">تاریخچه</div>
      {!loaded ? (
        <div className="text-[12px] text-muted text-center py-3">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {projects.map((p) => (
            <div key={`project-${p.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <BuildingIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">پروژه: {p.name}</span>
              <Badge tone="neutral">#{p.projectNo}</Badge>
            </div>
          ))}
          {proposals.map((pr) => (
            <div key={`proposal-${pr.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <ProposalIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">پروپوزال: {pr.title}</span>
              <Badge tone={PROPOSAL_STATUS_TONES[pr.status]}>{PROPOSAL_STATUS_LABELS[pr.status]}</Badge>
              <Badge tone="neutral">#{pr.proposalNo}</Badge>
            </div>
          ))}
          {contracts.map((c) => (
            <div key={`contract-${c.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <DocsIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">قرارداد: {c.title}</span>
              <span className="text-[11px] text-muted">تا {formatJalaliDate(c.endDate)}</span>
            </div>
          ))}
          {appointments.map((a) => (
            <div key={`appointment-${a.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <CalendarIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">نوبت: {a.serviceType.name}</span>
              <span className="text-[11px] text-muted">{formatJalaliDateTime(a.startAt)}</span>
            </div>
          ))}
          {sessions.map((s) => (
            <div key={`mentoring-session-${s.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <CompassIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">جلسه‌ی مشاوره: {s.engagement?.title ?? ""}</span>
              <span className="text-[11px] text-muted">{formatJalaliDateTime(s.scheduledAt)}</span>
            </div>
          ))}
          {tickets.map((t) => (
            <div key={`event-ticket-${t.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <TicketIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">بلیط رویداد: {t.event.title}</span>
              <Badge tone={t.status === "CHECKED_IN" ? "success" : t.status === "CANCELLED" ? "danger" : "neutral"}>{t.ticketCode}</Badge>
            </div>
          ))}
          {invoices.map((inv) => (
            <div key={`invoice-${inv.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <ReceiptIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">فاکتور #{inv.invoiceNo}</span>
              <span className="text-[11px] text-muted">{formatToman(inv.total)}</span>
              <Badge tone={inv.status === "PAID" ? "success" : inv.status === "CANCELLED" ? "danger" : "neutral"}>
                {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
              </Badge>
            </div>
          ))}
          {quotations.map((q) => (
            <div key={`quotation-${q.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <OrdersIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">پیش‌فاکتور #{q.quotationNo}</span>
              <span className="text-[11px] text-muted">{formatToman(q.total)}</span>
            </div>
          ))}
          {checks.map((chk) => (
            <div key={`check-${chk.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <BillingIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">
                چک {chk.direction === "RECEIVED" ? "دریافتی" : "صادرشده"}: {formatToman(chk.amount)}
              </span>
              <span className="text-[11px] text-muted">سررسید {formatJalaliDate(chk.dueDate)}</span>
            </div>
          ))}
          {shipments.map((sh) => (
            <div key={`shipment-${sh.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <TruckIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">بار #{sh.shipmentNo}: {sh.cargoType}</span>
              <Badge tone={sh.status === "DELIVERED" ? "success" : sh.status === "CANCELLED" ? "danger" : "neutral"}>{sh.status}</Badge>
            </div>
          ))}
          {storeOrders.map((so) => (
            <div key={`store-order-${so.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <StoreIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">سفارش فروشگاه #{so.orderNo}</span>
              <span className="text-[11px] text-muted">{formatToman(so.subtotal)}</span>
            </div>
          ))}
          {formSubmissions.map((fs) => (
            <div key={`form-submission-${fs.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <ClipboardCheckIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">فرم: {fs.form.title}</span>
              <span className="text-[11px] text-muted">{formatJalaliDateTime(fs.submittedAt)}</span>
            </div>
          ))}
          {warrantyCodes.map((w) => (
            <div key={`warranty-${w.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <ShieldIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">
                گارانتی: {w.itemDescription ?? w.product?.name ?? ""} — <span dir="ltr">{w.code}</span>
              </span>
              <Badge tone={w.status === "ACTIVE" ? "success" : w.status === "VOID" ? "danger" : "neutral"}>{WARRANTY_STATUS_LABELS[w.status] ?? w.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
