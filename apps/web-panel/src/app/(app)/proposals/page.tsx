"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { SearchInput } from "@/components/ui/SearchInput";
import { PlusIcon } from "@/components/icons";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import { formatJalaliDate, formatToman, toPersianDigits } from "@/lib/persian";
import { fetchProposals, type ProposalListItem, type ProposalStatus } from "@/lib/api";
import { PROPOSAL_STATUSES, PROPOSAL_STATUS_LABELS, PROPOSAL_STATUS_TONES } from "@/components/proposals/constants";
import { ProposalFormModal } from "@/components/proposals/ProposalFormModal";
import { ProposalDetailModal } from "@/components/proposals/ProposalDetailModal";
import { TemplatesModal } from "@/components/proposals/TemplatesModal";

type StatusFilter = "ALL" | ProposalStatus;

function ProposalsPageInner() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<ProposalListItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [formOpen, setFormOpen] = useState<{ id?: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(searchParams.get("id"));
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const debounced = useDebouncedValue(search, 300);
  const begin = useRequestGuard();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const searching = loadedFor === null || loadedFor !== search.trim();

  function load() {
    const isCurrent = begin();
    const requested = debounced.trim();
    fetchProposals({ q: requested || undefined, status: status === "ALL" ? undefined : status })
      .then((r) => {
        if (isCurrent()) setRows(r);
      })
      .catch(() => {
        if (isCurrent()) setRows((prev) => prev ?? []);
      })
      .finally(() => {
        if (isCurrent()) setLoadedFor(requested);
      });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [debounced, status]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    return { count: list.length, accepted: list.filter((r) => r.status === "ACCEPTED").length };
  }, [rows]);

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">پروپوزال</h1>
            <ModuleHelp code="proposals" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">پروپوزال برای مشتری با لینک عمومی، پذیرش با امضای الکترونیک و صدور فاکتور</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setTemplatesOpen(true)} className="bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer">
            قالب‌ها
          </button>
          <button onClick={() => setFormOpen({})} className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer">
            <PlusIcon className="w-4 h-4" />
            پروپوزال جدید
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-6 mb-4 flex-wrap">
        <SearchInput className="max-w-[320px] flex-1 min-w-[220px]" value={search} onChange={setSearch} placeholder="جستجوی نام مشتری، عنوان یا شماره..." loading={searching} />
        <div className="flex items-center gap-2 flex-wrap">
          {(["ALL", ...PROPOSAL_STATUSES] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={clsx(
                "text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border transition-colors cursor-pointer",
                status === s ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft",
              )}
            >
              {s === "ALL" ? "همه" : PROPOSAL_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-muted text-sm">پروپوزالی یافت نشد</Card>
      ) : (
        <>
          <div className="text-[12px] text-muted mb-2">
            {toPersianDigits(totals.count)} پروپوزال · {toPersianDigits(totals.accepted)} پذیرفته‌شده
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {rows.map((r) => (
              <button key={r.id} onClick={() => setOpenId(r.id)} className="text-right cursor-pointer">
                <Card className="p-4 h-full">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11.5px] text-muted">#{toPersianDigits(r.proposalNo)}</div>
                      <div className="text-[13.5px] font-bold truncate">{r.title}</div>
                    </div>
                    <Badge tone={PROPOSAL_STATUS_TONES[r.status]}>{PROPOSAL_STATUS_LABELS[r.status]}</Badge>
                  </div>
                  <div className="text-[12.5px] text-ink-soft mt-1.5 truncate">{r.contact.company || r.contact.name}</div>
                  <div className="flex items-center justify-between text-[11.5px] text-muted mt-2.5">
                    <span className="font-bold text-ink">{formatToman(r.amount)}</span>
                    <span>{formatJalaliDate(r.issuedAt)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted mt-1.5 flex-wrap">
                    {r.assignedTo ? <span>مسئول: {r.assignedTo.name}</span> : null}
                    {r.viewCount > 0 ? <span>{toPersianDigits(r.viewCount)} بازدید</span> : null}
                    {r._count.comments > 0 ? <span>{toPersianDigits(r._count.comments)} پیام</span> : null}
                    {r.invoiceId ? <span className="text-success font-semibold">فاکتور صادر شد</span> : null}
                  </div>
                </Card>
              </button>
            ))}
          </div>
        </>
      )}

      {formOpen ? <ProposalFormModal proposalId={formOpen.id} onClose={() => setFormOpen(null)} onSaved={load} /> : null}
      {openId && !formOpen ? (
        <ProposalDetailModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onEdit={(id) => {
            setOpenId(null);
            setFormOpen({ id });
          }}
        />
      ) : null}
      {templatesOpen ? <TemplatesModal onClose={() => setTemplatesOpen(false)} /> : null}
    </div>
  );
}

export default function ProposalsPage() {
  return (
    <Suspense fallback={null}>
      <ProposalsPageInner />
    </Suspense>
  );
}
