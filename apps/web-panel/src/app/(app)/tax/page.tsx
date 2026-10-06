"use client";

import { Suspense, useEffect, useState } from "react";
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
import { fetchTaxInvoices, fetchTaxStatus, type TaxInvoiceListItem, type TaxInvoiceStatus, type TaxStatus } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { TAX_STATUSES, TAX_STATUS_LABELS, TAX_STATUS_TONES, TAX_SUBJECT_LABELS } from "@/components/tax/constants";
import { TaxInvoiceDetailModal } from "@/components/tax/TaxInvoiceDetailModal";
import { NewTaxInvoiceModal } from "@/components/tax/NewTaxInvoiceModal";
import { TaxSettingsTab } from "@/components/tax/TaxSettingsTab";
import { TaxProductCodesTab } from "@/components/tax/TaxProductCodesTab";

type Tab = "invoices" | "settings" | "codes";
type StatusFilter = "ALL" | TaxInvoiceStatus;

function TaxPageInner() {
  const searchParams = useSearchParams();
  const { me } = useWorkspace();
  const isAdmin = me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";
  const [tab, setTab] = useState<Tab>("invoices");
  const [status, setStatus] = useState<TaxStatus | null>(null);
  const [rows, setRows] = useState<TaxInvoiceListItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [openId, setOpenId] = useState<string | null>(searchParams.get("open"));
  const [newOpen, setNewOpen] = useState(false);

  const debounced = useDebouncedValue(search, 300);
  const begin = useRequestGuard();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const searching = loadedFor === null || loadedFor !== search.trim();

  function loadStatus() {
    fetchTaxStatus().then(setStatus).catch(() => undefined);
  }
  useEffect(loadStatus, []);

  function load() {
    const isCurrent = begin();
    const requested = debounced.trim();
    fetchTaxInvoices({ q: requested || undefined, status: filter === "ALL" ? undefined : filter })
      .then((r) => isCurrent() && setRows(r))
      .catch(() => isCurrent() && setRows((p) => p ?? []))
      .finally(() => isCurrent() && setLoadedFor(requested));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [debounced, filter]);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "invoices", label: "صورتحساب‌ها" },
    { id: "settings", label: "تنظیمات" },
    { id: "codes", label: "کدهای کالا/خدمت" },
  ];

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">مالیات و مودیان</h1>
            <ModuleHelp code="tax" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">صورتحساب الکترونیکی سامانه مودیان — ارسال فقط پس از تأیید صریح مدیر</p>
        </div>
        {tab === "invoices" ? (
          <button onClick={() => setNewOpen(true)} className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer">
            <PlusIcon className="w-4 h-4" />
            صورتحساب جدید
          </button>
        ) : null}
      </div>

      {status?.realSendingDisabled ? (
        <div className="mt-4 text-[12.5px] bg-warning-soft text-warning rounded-xl px-4 py-2.5 font-semibold">
          ارسال واقعی غیرفعال است
          <span className="font-normal">
            {" "}
            — {status.environment === "SANDBOX" ? "محیط آزمایشی" : "محیط واقعی"}
            {status.sendingEnabled ? "" : "، ارسال خاموش است"}؛ صورتحساب‌ها فقط آماده و تأیید می‌شوند.
          </span>
        </div>
      ) : (
        <div className="mt-4 text-[12.5px] bg-danger-soft text-danger rounded-xl px-4 py-2.5 font-semibold">ارسال به محیط واقعی سامانه مودیان فعال است — هر صورتحساب تأییدشده ارسال می‌شود.</div>
      )}

      <div className="flex items-center gap-2 mt-5 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx("text-[13px] font-bold px-4 py-2.5 -mb-px border-b-2 cursor-pointer", tab === t.id ? "border-primary text-primary" : "border-transparent text-ink-soft")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "invoices" ? (
          <>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <SearchInput className="max-w-[320px] flex-1 min-w-[220px]" value={search} onChange={setSearch} placeholder="جستجوی شماره فاکتور، مشتری یا شماره مالیاتی..." loading={searching} />
              <div className="flex items-center gap-2 flex-wrap">
                {(["ALL", ...TAX_STATUSES] as StatusFilter[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    className={clsx("text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border transition-colors cursor-pointer", filter === s ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft")}
                  >
                    {s === "ALL" ? "همه" : TAX_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
            {rows === null ? (
              <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
            ) : rows.length === 0 ? (
              <Card className="p-8 text-center text-muted text-sm">صورتحساب مالیاتی‌ای یافت نشد</Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {rows.map((r) => (
                  <button key={r.id} onClick={() => setOpenId(r.id)} className="text-right cursor-pointer">
                    <Card className="p-4 h-full">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11.5px] text-muted">
                            فاکتور {toPersianDigits(r.salesInvoice.invoiceNo)}
                            {r.subject !== "ORIGINAL" ? ` · ${TAX_SUBJECT_LABELS[r.subject]}` : ""}
                          </div>
                          <div className="text-[13.5px] font-bold truncate">{r.salesInvoice.contact.company || r.salesInvoice.contact.name}</div>
                        </div>
                        <Badge tone={TAX_STATUS_TONES[r.status]}>{TAX_STATUS_LABELS[r.status]}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-[11.5px] text-muted mt-2.5">
                        <span className="font-bold text-ink">{formatToman(r.salesInvoice.total)}</span>
                        <span>{formatJalaliDate(r.createdAt)}</span>
                      </div>
                      {r.errors?.length ? <div className="text-[11.5px] text-danger mt-1.5 truncate">{r.errors[0]!.fa}</div> : null}
                    </Card>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : null}
        {tab === "settings" ? <TaxSettingsTab isAdmin={isAdmin} onChanged={loadStatus} /> : null}
        {tab === "codes" ? <TaxProductCodesTab canEdit /> : null}
      </div>

      {newOpen ? (
        <NewTaxInvoiceModal
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            load();
            setOpenId(id);
          }}
        />
      ) : null}
      {openId ? <TaxInvoiceDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={() => { load(); loadStatus(); }} /> : null}
    </div>
  );
}

export default function TaxPage() {
  return (
    <Suspense fallback={null}>
      <TaxPageInner />
    </Suspense>
  );
}
