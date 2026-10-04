"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatNumber, formatToman, formatJalaliDate, formatJalaliDateTime } from "@/lib/persian";
import { useWorkspace } from "@/lib/workspace-context";
import {
  cancelPlatformInvoice,
  createPlatformModuleInvoice,
  fetchPlatformInvoices,
  fetchPlatformModules,
  fetchPlatformRenewals,
  fetchPlatformTenant,
  fetchPlatformTenants,
  fetchPlatformTicket,
  fetchPlatformTickets,
  markPlatformInvoicePaid,
  replyPlatformTicket,
  setPlatformTicketStatus,
  type PlatformCatalogModule,
  type PlatformInvoice,
  type PlatformRenewal,
  type PlatformTenantRow,
  type PlatformTicket,
  type PlatformTicketStatus,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const btn = "text-[12.5px] font-bold px-3.5 py-2 rounded-xl cursor-pointer disabled:opacity-50";
const MODE_LABEL: Record<string, string> = { MONTHLY: "ماهانه", YEARLY: "سالانه", LICENSE: "لایسنس" };
const INV_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "در انتظار پرداخت", tone: "warning" },
  PAID: { label: "پرداخت‌شده", tone: "success" },
  FAILED: { label: "لغو/ناموفق", tone: "danger" },
};
const TICKET_STATUS: Record<PlatformTicketStatus, { label: string; tone: Tone }> = {
  OPEN: { label: "باز", tone: "warning" },
  IN_PROGRESS: { label: "در حال بررسی", tone: "primary" },
  RESOLVED: { label: "رفع‌شده", tone: "success" },
  CLOSED: { label: "بسته", tone: "neutral" },
};
const TABS = [
  { id: "catalog", label: "کاتالوگ و قیمت ماژول‌ها" },
  { id: "tenants", label: "تننت‌ها" },
  { id: "invoices", label: "فاکتورها" },
  { id: "tickets", label: "تیکت‌های پشتیبانی" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function PlatformPage() {
  const { isPlatformOwner, loading } = useWorkspace();
  const [tab, setTab] = useState<TabId>("catalog");

  if (loading) return null;
  if (!isPlatformOwner) return <div className="p-7 text-muted text-[14px]">شما به این بخش دسترسی ندارید.</div>;

  return (
    <div className="p-5 lg:p-7 max-w-[1200px] mx-auto">
      <h1 className="text-xl font-extrabold">مدیریت پلتفرم</h1>
      <p className="text-[13.5px] text-muted mt-1">مدیریت فاکتورها، ماژول‌ها و تیکت‌های همه‌ی تننت‌ها — همه‌ی تغییرات در پنل ادمین هم ثبت و دیده می‌شود.</p>
      <div className="flex gap-1.5 mt-5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx("text-[13px] font-bold px-4 py-2 rounded-xl cursor-pointer border", tab === t.id ? "bg-primary text-white border-primary" : "bg-surface text-ink-soft border-border")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-5">
        {tab === "catalog" && <CatalogTab />}
        {tab === "tenants" && <TenantsTab />}
        {tab === "invoices" && <InvoicesTab />}
        {tab === "tickets" && <TicketsTab />}
      </div>
    </div>
  );
}

function Empty({ text = "موردی یافت نشد" }: { text?: string }) {
  return <div className="p-8 text-center text-[13px] text-muted">{text}</div>;
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-start font-bold text-[12px] text-muted px-4 py-3 whitespace-nowrap">{children}</th>;
}

// ── Catalog ──────────────────────────────────────────────────────────────
function CatalogTab() {
  const [rows, setRows] = useState<PlatformCatalogModule[] | null>(null);
  useEffect(() => {
    fetchPlatformModules().then(setRows).catch(() => setRows([]));
  }, []);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border"><Th>ماژول</Th><Th>دسته</Th><Th>ماهانه</Th><Th>سالانه</Th><Th>لایسنس</Th><Th>وضعیت</Th></tr>
        </thead>
        <tbody>
          {(rows ?? []).map((m) => (
            <tr key={m.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-bold">{m.name}<div className="text-[11px] text-muted font-normal" dir="ltr">{m.code}</div></td>
              <td className="px-4 py-3">{m.category}</td>
              <td className="px-4 py-3">{m.priceMonthly ? formatToman(m.priceMonthly) : "—"}</td>
              <td className="px-4 py-3">{m.priceMonthly ? formatToman(m.priceYearly) : "—"}</td>
              <td className="px-4 py-3">{m.priceMonthly ? formatToman(m.priceLicense) : "—"}</td>
              <td className="px-4 py-3">
                {m.isCore && <Badge tone="accent" className="me-1">هسته</Badge>}
                <Badge tone={m.isListed ? "success" : "neutral"}>{m.isListed ? "عمومی" : "مخفی"}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows && rows.length === 0 && <Empty />}
      <div className="px-4 py-3 text-[12px] text-muted border-t border-border">ویرایش قیمت‌ها فقط از پنل ادمین انجام می‌شود.</div>
    </Card>
  );
}

// ── Tenants ──────────────────────────────────────────────────────────────
function TenantsTab() {
  const [rows, setRows] = useState<PlatformTenantRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    fetchPlatformTenants().then(setRows).catch(() => setRows([]));
  }, []);
  return (
    <>
      <Card className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border"><Th>نام</Th><Th>شناسه</Th><Th>وضعیت</Th><Th>پلن</Th><Th>ماژول فعال</Th><Th>پایان اشتراک</Th><Th /></tr>
          </thead>
          <tbody>
            {(rows ?? []).map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-bold">{t.name}</td>
                <td className="px-4 py-3" dir="ltr">{t.slug}</td>
                <td className="px-4 py-3"><Badge tone={t.status === "ACTIVE" ? "success" : "warning"}>{t.status}</Badge></td>
                <td className="px-4 py-3">{t.planName ?? "—"}</td>
                <td className="px-4 py-3">{formatNumber(t.activeModulesCount)}</td>
                <td className="px-4 py-3">{t.currentPeriodEnd ? formatJalaliDate(t.currentPeriodEnd) : "—"}</td>
                <td className="px-4 py-3"><button onClick={() => setOpenId(t.id)} className={`${btn} bg-primary-soft text-primary`}>جزئیات</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 && <Empty />}
      </Card>
      {openId && <TenantDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function TenantDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchPlatformTenant>> | null>(null);
  const [catalog, setCatalog] = useState<PlatformCatalogModule[]>([]);
  const [selected, setSelected] = useState<Record<string, "MONTHLY" | "YEARLY" | "LICENSE">>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function load() {
    fetchPlatformTenant(id).then(setData).catch(() => setMsg("خطا در دریافت اطلاعات"));
  }
  useEffect(() => {
    load();
    fetchPlatformModules().then((m) => setCatalog(m.filter((x) => x.priceMonthly > 0))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function issue() {
    const items = Object.entries(selected).map(([code, billingMode]) => ({ code, billingMode }));
    if (!items.length) return;
    setBusy(true);
    try {
      await createPlatformModuleInvoice(id, { items });
      setSelected({});
      setMsg("فاکتور صادر شد و برای تننت اعلان رفت.");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={data?.tenant.name ?? "تننت"} onClose={onClose} width="max-w-[760px]">
      {!data ? <Empty text="در حال بارگذاری…" /> : (
        <div className="space-y-5">
          <section>
            <h3 className="text-[13px] font-extrabold mb-2">ماژول‌های تننت</h3>
            {data.modules.length === 0 ? <Empty /> : (
              <div className="space-y-1.5">
                {data.modules.map((m) => (
                  <div key={m.code} className="flex items-center justify-between gap-2 text-[13px] bg-slate-50 rounded-lg px-3 py-2">
                    <span className="font-bold">{m.name}</span>
                    <span className="flex items-center gap-2">
                      {m.billingMode && <Badge tone="primary">{MODE_LABEL[m.billingMode]}</Badge>}
                      <Badge tone={m.status === "INSTALLED" ? "success" : "neutral"}>{m.status}</Badge>
                      <span className="text-muted text-[12px]">{m.billingMode === "LICENSE" ? "مادام‌العمر" : m.currentPeriodEnd ? formatJalaliDate(m.currentPeriodEnd) : ""}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section>
            <h3 className="text-[13px] font-extrabold mb-2">صدور فاکتور ماژول</h3>
            <div className="max-h-[200px] overflow-y-auto space-y-1">
              {catalog.map((m) => (
                <div key={m.code} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={!!selected[m.code]}
                    onChange={(e) => setSelected((s) => { const n = { ...s }; if (e.target.checked) n[m.code] = "MONTHLY"; else delete n[m.code]; return n; })}
                  />
                  <span className="flex-1">{m.name}</span>
                  {selected[m.code] && (
                    <select value={selected[m.code]} onChange={(e) => setSelected((s) => ({ ...s, [m.code]: e.target.value as "MONTHLY" | "YEARLY" | "LICENSE" }))} className="text-[12px] bg-slate-50 border border-border rounded-lg px-2 py-1">
                      <option value="MONTHLY">ماهانه — {formatToman(m.priceMonthly)}</option>
                      <option value="YEARLY">سالانه — {formatToman(m.priceYearly)}</option>
                      <option value="LICENSE">لایسنس — {formatToman(m.priceLicense)}</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
            <button disabled={busy || !Object.keys(selected).length} onClick={issue} className={`${btn} bg-primary text-white mt-3`}>صدور فاکتور</button>
            {msg && <span className="text-[12.5px] text-ink-soft ms-3">{msg}</span>}
          </section>
          <section>
            <h3 className="text-[13px] font-extrabold mb-2">فاکتورها</h3>
            <InvoiceTable rows={data.invoices} onChanged={load} />
          </section>
        </div>
      )}
    </Modal>
  );
}

// ── Invoices ─────────────────────────────────────────────────────────────
function InvoiceTable({ rows, onChanged, showTenant }: { rows: PlatformInvoice[]; onChanged: () => void; showTenant?: boolean }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  async function act(id: string, kind: "pay" | "cancel") {
    if (!window.confirm(kind === "pay" ? "ثبت پرداخت این فاکتور؟ ماژول‌ها فعال می‌شوند." : "این فاکتور لغو شود؟")) return;
    setBusyId(id);
    try {
      if (kind === "pay") await markPlatformInvoicePaid(id); else await cancelPlatformInvoice(id);
      onChanged();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "خطا");
    } finally {
      setBusyId(null);
    }
  }
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border">{showTenant && <Th>تننت</Th>}<Th>شرح</Th><Th>مبلغ</Th><Th>صدور</Th><Th>سررسید</Th><Th>وضعیت</Th><Th /></tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-b border-border last:border-0">
              {showTenant && <td className="px-4 py-3 font-bold">{i.tenant?.name}</td>}
              <td className="px-4 py-3">
                {i.purpose === "MODULE_RENEWAL" && <Badge tone="accent" className="me-1">تمدید خودکار</Badge>}
                {i.items?.map((x) => `${x.moduleName} (${MODE_LABEL[x.billingMode] ?? x.billingMode})`).join("، ") || i.purpose || "—"}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{formatToman(i.amount)}</td>
              <td className="px-4 py-3">{formatJalaliDate(i.issuedAt)}</td>
              <td className="px-4 py-3">{formatJalaliDate(i.dueAt)}</td>
              <td className="px-4 py-3"><Badge tone={INV_STATUS[i.status].tone}>{INV_STATUS[i.status].label}</Badge></td>
              <td className="px-4 py-3 whitespace-nowrap">
                {i.status === "PENDING" && (
                  <>
                    <button disabled={busyId === i.id} onClick={() => act(i.id, "pay")} className={`${btn} bg-success-soft text-success me-1.5`}>ثبت پرداخت</button>
                    <button disabled={busyId === i.id} onClick={() => act(i.id, "cancel")} className={`${btn} bg-danger-soft text-danger`}>لغو</button>
                  </>
                )}
                {i.status === "FAILED" && <span className="text-[12px] text-muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoicesTab() {
  const [view, setView] = useState<"all" | "recurring" | "renewals">("all");
  const [status, setStatus] = useState("");
  const [invoices, setInvoices] = useState<PlatformInvoice[] | null>(null);
  const [renewals, setRenewals] = useState<PlatformRenewal[] | null>(null);

  function load() {
    if (view === "renewals") fetchPlatformRenewals().then(setRenewals).catch(() => setRenewals([]));
    else fetchPlatformInvoices({ status: status || undefined, recurring: view === "recurring" }).then(setInvoices).catch(() => setInvoices([]));
  }
  useEffect(load, [view, status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {([["all", "همه‌ی فاکتورها"], ["recurring", "فاکتورهای تمدید خودکار"], ["renewals", "تمدیدهای پیش‌رو"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className={clsx(btn, "border", view === id ? "bg-primary-soft text-primary border-primary" : "bg-surface text-ink-soft border-border")}>{label}</button>
        ))}
        {view !== "renewals" && (
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputClass} !w-auto`}>
            <option value="">همه‌ی وضعیت‌ها</option>
            <option value="PENDING">در انتظار پرداخت</option>
            <option value="PAID">پرداخت‌شده</option>
            <option value="FAILED">لغو/ناموفق</option>
          </select>
        )}
      </div>
      <Card>
        {view === "renewals" ? (
          <div className="overflow-x-auto">
            {renewals?.length === 0 ? <Empty /> : (
              <table className="w-full text-[13px]">
                <thead><tr className="border-b border-border"><Th>تننت</Th><Th>ماژول</Th><Th>نوع</Th><Th>تمدید بعدی</Th><Th>مبلغ</Th><Th>فاکتور تمدید</Th></tr></thead>
                <tbody>
                  {(renewals ?? []).map((r) => (
                    <tr key={`${r.tenant.id}-${r.moduleCode}`} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-bold">{r.tenant.name}</td>
                      <td className="px-4 py-3">{r.moduleName}</td>
                      <td className="px-4 py-3">{r.billingMode ? MODE_LABEL[r.billingMode] : "—"}</td>
                      <td className="px-4 py-3">{formatJalaliDate(r.nextRenewalAt)}</td>
                      <td className="px-4 py-3">{formatToman(r.renewalAmount)}</td>
                      <td className="px-4 py-3">{r.pendingInvoice ? <Badge tone={INV_STATUS[r.pendingInvoice.status].tone}>{INV_STATUS[r.pendingInvoice.status].label}</Badge> : <span className="text-muted text-[12px]">هنوز صادر نشده</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <InvoiceTable rows={invoices ?? []} onChanged={load} showTenant />
        )}
      </Card>
    </div>
  );
}

// ── Tickets ──────────────────────────────────────────────────────────────
function TicketsTab() {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<PlatformTicket[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  function load() {
    fetchPlatformTickets({ status: status || undefined }).then(setRows).catch(() => setRows([]));
  }
  useEffect(load, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputClass} !w-auto mb-3`}>
        <option value="">همه‌ی وضعیت‌ها</option>
        {Object.entries(TICKET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <Card className="overflow-x-auto">
        {rows?.length === 0 ? <Empty /> : (
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-border"><Th>موضوع</Th><Th>تننت</Th><Th>ثبت‌کننده</Th><Th>وضعیت</Th><Th>تاریخ</Th></tr></thead>
            <tbody>
              {(rows ?? []).map((t) => (
                <tr key={t.id} onClick={() => setOpenId(t.id)} className="border-b border-border last:border-0 cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-3 font-bold">{t.subject}</td>
                  <td className="px-4 py-3">{t.tenant.name}</td>
                  <td className="px-4 py-3">{t.createdByUser.name ?? t.createdByUser.phone}</td>
                  <td className="px-4 py-3"><Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge></td>
                  <td className="px-4 py-3">{formatJalaliDateTime(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {openId && <TicketModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function TicketModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [ticket, setTicket] = useState<PlatformTicket | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  function load() {
    fetchPlatformTicket(id).then(setTicket).catch(() => {});
  }
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await replyPlatformTicket(id, body.trim());
      setBody("");
      load();
      onChanged();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "خطا");
    } finally {
      setBusy(false);
    }
  }
  async function changeStatus(s: PlatformTicketStatus) {
    const note = s === "RESOLVED" ? (window.prompt("توضیح رفع مشکل (اختیاری)") ?? undefined) : undefined;
    setBusy(true);
    try {
      await setPlatformTicketStatus(id, s, note || undefined);
      load();
      onChanged();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={ticket ? `${ticket.subject} — ${ticket.tenant.name}` : "تیکت"} onClose={onClose} width="max-w-[640px]">
      {!ticket ? <Empty text="در حال بارگذاری…" /> : (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Badge tone={TICKET_STATUS[ticket.status].tone}>{TICKET_STATUS[ticket.status].label}</Badge>
            <select disabled={busy} value="" onChange={(e) => e.target.value && changeStatus(e.target.value as PlatformTicketStatus)} className="text-[12px] bg-slate-50 border border-border rounded-lg px-2 py-1">
              <option value="">تغییر وضعیت…</option>
              {Object.entries(TICKET_STATUS).filter(([k]) => k !== ticket.status).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="space-y-2 max-h-[340px] overflow-y-auto">
            {ticket.messages.map((m) => (
              <div key={m.id} className={clsx("rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed", m.senderType === "ADMIN" ? "bg-primary-soft" : m.senderType === "SYSTEM" ? "bg-slate-100 text-muted text-center" : "bg-slate-50 border border-border")}>
                <div className="text-[11px] text-muted mb-0.5">{m.senderType === "ADMIN" ? "پشتیبانی" : m.senderType === "SYSTEM" ? "سیستم" : (ticket.createdByUser.name ?? "مشتری")} · {formatJalaliDateTime(m.createdAt)}</div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="پاسخ به مشتری…" className={inputClass} />
            <button disabled={busy || !body.trim()} onClick={send} className={`${btn} bg-primary text-white self-end`}>ارسال</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
