import { useEffect, useState } from "react";
import { SearchInput } from "@/components/ui/SearchInput";
import { PlusIcon, TrashIcon } from "@/components/icons";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import { useWorkspace } from "@/lib/workspace-context";
import { formatToman } from "@/lib/persian";
import { VisibilityToggle } from "@/components/projects/VisibilityToggle";
import { PROPOSAL_STATUS_LABELS } from "@/components/proposals/constants";
import {
  fetchProjectDocuments,
  fetchProposals,
  fetchSalesInvoices,
  linkProjectInvoice,
  linkProjectProposal,
  setProjectInvoiceShow,
  setProjectProposalShow,
  unlinkProjectInvoice,
  unlinkProjectProposal,
  type ProjectDocuments,
  type ProposalListItem,
  type SalesInvoice,
} from "@/lib/api";

const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "پیش‌نویس",
  CONFIRMED: "تأییدشده",
  PARTIALLY_PAID: "پرداخت جزئی",
  PAID: "تسویه‌شده",
  CANCELLED: "لغوشده",
};

type Kind = "proposal" | "invoice";

/** اسناد پروژه: پروپوزال‌ها (ماژول proposals) و فاکتورها (ماژول sales) + اتصال با جستجوی ajax و کلید «نمایش در لینک مشتری». */
export function ProjectDocumentsSection({ projectId, version, onCreateInvoice }: { projectId: string; version: number; onCreateInvoice: () => void }) {
  const { installedModules } = useWorkspace();
  const [docs, setDocs] = useState<ProjectDocuments | null>(null);
  const [picker, setPicker] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchProjectDocuments(projectId).then(setDocs).catch(() => setDocs(null));
  }
  useEffect(reload, [projectId, version]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const proposalsOn = installedModules.has("proposals") && docs?.proposals.enabled !== false;
  const salesOn = installedModules.has("sales") && docs?.invoices.enabled !== false;
  if (!proposalsOn && !salesOn) return null;

  return (
    <div>
      <div className="text-[12.5px] font-semibold text-ink-soft mb-2">اسناد پروژه</div>
      {error ? <div className="text-[12px] text-danger font-semibold mb-2">{error}</div> : null}

      {proposalsOn ? (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11.5px] font-bold text-muted">پروپوزال‌ها</span>
            <button type="button" onClick={() => setPicker(picker === "proposal" ? null : "proposal")} className="flex items-center gap-1 text-[11px] font-bold text-primary cursor-pointer">
              <PlusIcon className="w-3 h-3" />
              اتصال پروپوزال
            </button>
          </div>
          {picker === "proposal" ? <ProposalPicker busy={busy} onPick={(p) => run(async () => { await linkProjectProposal(projectId, p.id, false); setPicker(null); })} /> : null}
          {docs && !docs.proposals.canView ? (
            <div className="text-[11.5px] text-muted bg-slate-50 rounded-xl p-2.5 text-center">دسترسی مشاهده‌ی پروپوزال‌ها را ندارید</div>
          ) : !docs || docs.proposals.items.length === 0 ? (
            <div className="text-[11.5px] text-muted bg-slate-50 rounded-xl p-2.5 text-center">پروپوزالی متصل نشده</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {docs.proposals.items.map((p) => (
                <div key={p.id} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2 flex-wrap">
                  <span className="text-[12px] font-semibold min-w-0 flex-1 truncate">
                    #{p.proposalNo} — {p.title}
                  </span>
                  <span className="text-[11px] text-muted">{PROPOSAL_STATUS_LABELS[p.status as keyof typeof PROPOSAL_STATUS_LABELS] ?? p.status}</span>
                  {p.amount > 0 ? <span className="text-[11.5px] font-bold">{formatToman(p.amount)}</span> : null}
                  <VisibilityToggle compact visible={p.projectShowOnPublicLink} disabled={busy || p.status === "DRAFT"} onChange={(v) => run(() => setProjectProposalShow(projectId, p.id, v))} />
                  <button type="button" aria-label="جداکردن پروپوزال" disabled={busy} onClick={() => run(() => unlinkProjectProposal(projectId, p.id))} className="text-danger cursor-pointer disabled:opacity-50">
                    <TrashIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {salesOn ? (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11.5px] font-bold text-muted">فاکتورها</span>
            <span className="flex items-center gap-3">
              <button type="button" onClick={() => setPicker(picker === "invoice" ? null : "invoice")} className="text-[11px] font-bold text-ink-soft cursor-pointer">
                اتصال فاکتور
              </button>
              <button type="button" onClick={onCreateInvoice} className="flex items-center gap-1 text-[11px] font-bold text-primary cursor-pointer">
                <PlusIcon className="w-3 h-3" />
                صدور فاکتور
              </button>
            </span>
          </div>
          {picker === "invoice" ? <InvoicePicker busy={busy} onPick={(i) => run(async () => { await linkProjectInvoice(projectId, i.id, false); setPicker(null); })} /> : null}
          {docs && !docs.invoices.canView ? (
            <div className="text-[11.5px] text-muted bg-slate-50 rounded-xl p-2.5 text-center">دسترسی مشاهده‌ی فاکتورها را ندارید</div>
          ) : !docs || docs.invoices.items.length === 0 ? (
            <div className="text-[11.5px] text-muted bg-slate-50 rounded-xl p-2.5 text-center">فاکتوری متصل نشده</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {docs.invoices.items.map((i) => (
                <div key={i.id} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2 flex-wrap">
                  <span className="text-[12px] font-semibold flex-1">فاکتور #{i.invoiceNo}</span>
                  <span className="text-[11px] text-muted">{INVOICE_STATUS_LABELS[i.status] ?? i.status}</span>
                  <span className="text-[11.5px] font-bold">{formatToman(i.total)}</span>
                  <VisibilityToggle compact visible={i.projectShowOnPublicLink} disabled={busy || i.status === "DRAFT" || i.status === "CANCELLED"} onChange={(v) => run(() => setProjectInvoiceShow(projectId, i.id, v))} />
                  <button type="button" aria-label="جداکردن فاکتور" disabled={busy} onClick={() => run(() => unlinkProjectInvoice(projectId, i.id))} className="text-danger cursor-pointer disabled:opacity-50">
                    <TrashIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ProposalPicker({ onPick, busy }: { onPick: (p: ProposalListItem) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const begin = useRequestGuard();
  const [rows, setRows] = useState<ProposalListItem[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    const isCurrent = begin();
    const requested = dq.trim();
    fetchProposals({ q: requested || undefined })
      .then((r) => isCurrent() && setRows(r))
      .catch(() => isCurrent() && setRows([]))
      .finally(() => isCurrent() && setLoadedFor(requested));
  }, [dq, begin]);
  const free = (rows ?? []).filter((p) => !p.projectId).slice(0, 8);
  return (
    <div className="bg-white border border-border rounded-xl p-2.5 mb-2">
      <SearchInput value={q} onChange={setQ} placeholder="جستجوی عنوان یا مشتری..." loading={loadedFor === null || loadedFor !== q.trim()} />
      <div className="flex flex-col gap-1 mt-2 max-h-[180px] overflow-y-auto">
        {rows !== null && free.length === 0 ? <div className="text-[11.5px] text-muted text-center py-2">پروپوزال آزادی یافت نشد</div> : null}
        {free.map((p) => (
          <button key={p.id} type="button" disabled={busy} onClick={() => onPick(p)} className="text-right flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-50">
            <span className="text-[12px] font-semibold truncate">
              #{p.proposalNo} — {p.title}
            </span>
            <span className="text-[11px] text-muted shrink-0">{p.contact.company || p.contact.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function InvoicePicker({ onPick, busy }: { onPick: (i: SalesInvoice) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const begin = useRequestGuard();
  const [rows, setRows] = useState<SalesInvoice[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    const isCurrent = begin();
    const requested = dq.trim();
    fetchSalesInvoices(undefined, requested || undefined)
      .then((r) => isCurrent() && setRows(r))
      .catch(() => isCurrent() && setRows([]))
      .finally(() => isCurrent() && setLoadedFor(requested));
  }, [dq, begin]);
  const free = (rows ?? []).filter((i) => !i.projectId).slice(0, 8);
  return (
    <div className="bg-white border border-border rounded-xl p-2.5 mb-2">
      <SearchInput value={q} onChange={setQ} placeholder="جستجوی شماره فاکتور یا مشتری..." loading={loadedFor === null || loadedFor !== q.trim()} />
      <div className="flex flex-col gap-1 mt-2 max-h-[180px] overflow-y-auto">
        {rows !== null && free.length === 0 ? <div className="text-[11.5px] text-muted text-center py-2">فاکتور آزادی یافت نشد</div> : null}
        {free.map((i) => (
          <button key={i.id} type="button" disabled={busy} onClick={() => onPick(i)} className="text-right flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-50">
            <span className="text-[12px] font-semibold truncate">
              فاکتور #{i.invoiceNo} — {i.contact.company || i.contact.name}
            </span>
            <span className="text-[11px] font-bold shrink-0">{formatToman(i.total)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
