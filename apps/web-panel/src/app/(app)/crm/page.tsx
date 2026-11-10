"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { CrmIcon, PlusIcon, BuildingIcon, PhoneIcon } from "@/components/icons";
import { formatMoney, formatNumber, moneyUnit } from "@/lib/persian";
import {
  ApiError,
  bulkDeleteCrmContacts,
  bulkStageCrmContacts,
  fetchCrmDeals,
  fetchCrmContacts,
  type CrmBulkResult,
  type CrmDeal,
  type CrmContact,
  type CrmContactGroup,
} from "@/lib/api";
import { FUNNEL_STAGE_META, FunnelStageBadge, isConvertedContact } from "@/components/crm/FunnelStageControls";
import { STAGE_ORDER, STAGE_META } from "@/components/crm/crm-shared";
import { ExcelImportExportBar } from "@/components/shared/ExcelImportExportBar";
import { DealModal } from "@/components/crm/DealModal";
import { ContactModal } from "@/components/crm/ContactModal";
import { NewContactModal } from "@/components/crm/NewContactModal";
import { NewDealModal } from "@/components/crm/NewDealModal";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
type Tab = "pipeline" | "contacts";

const GROUP_CHIPS: { key: CrmContactGroup; label: string }[] = [
  { key: "all", label: "همه مخاطبین" },
  { key: "leads", label: "سرنخ‌ها" },
  { key: "customers", label: "مشتریان" },
  { key: "repeat", label: "خرید تکراری" },
  { key: "lost", label: "رد صلاحیت‌شده" },
];

function inGroup(c: CrmContact, g: CrmContactGroup): boolean {
  const stage = c.funnelStage ?? "NEW_LEAD";
  const converted = isConvertedContact(c);
  switch (g) {
    case "leads":
      return !converted && stage !== "DISQUALIFIED";
    case "customers":
      return converted;
    case "repeat":
      return (c.purchaseCount ?? 0) >= 2 || ["REPEAT_CUSTOMER", "BRAND_AMBASSADOR", "CHURN_RISK", "CHURNED"].includes(stage);
    case "lost":
      return stage === "DISQUALIFIED";
    default:
      return true;
  }
}

export default function CrmPage() {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [deals, setDeals] = useState<CrmDeal[] | null>(null);
  const [contacts, setContacts] = useState<CrmContact[] | null>(null);
  // contacts = what the list shows (server-filtered by `q`); allContacts = the unfiltered set,
  // kept for pickers (e.g. new-deal modal) that need every contact regardless of the search box.
  const [allContacts, setAllContacts] = useState<CrmContact[] | null>(null);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<CrmContactGroup>("all");
  const debouncedSearch = useDebouncedValue(search, 300);
  const beginRequest = useRequestGuard();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const searching = loadedFor === null || loadedFor !== search.trim();

  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [newDealFor, setNewDealFor] = useState<{ contactId?: string } | null>(null);
  const searchParams = useSearchParams();

  // انتخاب و عملیات دسته‌جمعی روی مخاطبین
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<{ tone: "ok" | "error"; text: string; failures?: string[] } | null>(null);

  function toggleSelected(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function summarizeBulk(results: CrmBulkResult[], verb: string) {
    const nameOf = (id: string) => (contacts ?? []).find((c) => c.id === id)?.name ?? id;
    const failures = results.filter((r) => !r.ok).map((r) => `${nameOf(r.id)}: ${r.error ?? "ناموفق"}`);
    const okCount = results.length - failures.length;
    setBulkNotice({
      tone: failures.length ? "error" : "ok",
      text: failures.length
        ? `${formatNumber(okCount)} مخاطب ${verb} شد و ${formatNumber(failures.length)} مورد انجام نشد.`
        : `${formatNumber(okCount)} مخاطب ${verb} شد.`,
      failures,
    });
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    if (
      !window.confirm(
        `${formatNumber(ids.length)} مخاطب برای همیشه حذف شود؟ مخاطبینی که فاکتور یا نوبتی به آن‌ها وصل است حذف نمی‌شوند.`,
      )
    )
      return;
    setBulkBusy(true);
    setBulkNotice(null);
    try {
      const r = await bulkDeleteCrmContacts(ids);
      const deletedIds = new Set(r.results.filter((x) => x.ok).map((x) => x.id));
      summarizeBulk(r.results, "حذف");
      setContacts((prev) => prev?.filter((c) => !deletedIds.has(c.id)) ?? prev);
      setAllContacts((prev) => prev?.filter((c) => !deletedIds.has(c.id)) ?? prev);
      setSelected(new Set(r.results.filter((x) => !x.ok).map((x) => x.id)));
      reloadContacts();
    } catch (err) {
      setBulkNotice({ tone: "error", text: err instanceof ApiError ? err.message : "حذف دسته‌جمعی ناموفق بود" });
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkSetStage(stage: "NEW_LEAD" | "CONTACTED" | "QUALIFIED") {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    setBulkNotice(null);
    try {
      const r = await bulkStageCrmContacts(ids, stage);
      summarizeBulk(r.results, "به «" + FUNNEL_STAGE_META[stage].label + "» منتقل");
      setSelected(new Set(r.results.filter((x) => !x.ok).map((x) => x.id)));
      reloadContacts();
    } catch (err) {
      setBulkNotice({ tone: "error", text: err instanceof ApiError ? err.message : "تغییر مرحله ناموفق بود" });
    } finally {
      setBulkBusy(false);
    }
  }

  function reloadContacts() {
    const q = debouncedSearch.trim();
    const isCurrent = beginRequest();
    const requested = debouncedSearch.trim();
    fetchCrmContacts(q || undefined, group)
      .then((r) => {
        if (!isCurrent()) return;
        setContacts(r);
        // انتخاب‌هایی که دیگر در لیست نیستند (جستجو/فیلتر عوض شده یا حذف شده‌اند) کنار گذاشته می‌شوند.
        setSelected((prev) => {
          const visible = new Set(r.map((c) => c.id));
          const next = new Set([...prev].filter((id) => visible.has(id)));
          return next.size === prev.size ? prev : next;
        });
        if (!q && group === "all") setAllContacts(r);
      })
      .catch(() => {
        if (isCurrent()) setContacts((prev) => prev ?? []);
      })
      .finally(() => {
        if (isCurrent()) setLoadedFor(requested);
      });
    // Keep the unfiltered set fresh when the list itself is filtered.
    if (q || group !== "all") fetchCrmContacts().then(setAllContacts).catch(() => {});
  }

  useEffect(() => {
    fetchCrmDeals().then(setDeals).catch(() => setDeals([]));
  }, []);

  useEffect(() => {
    reloadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, group]);

  useEffect(() => {
    const contactId = searchParams.get("contact");
    if (contactId) {
      setTab("contacts");
      setOpenContactId(contactId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openDeals = useMemo(
    () => (deals ?? []).filter((d) => d.stage !== "WON" && d.stage !== "LOST"),
    [deals],
  );
  const wonValue = useMemo(
    () => (deals ?? []).filter((d) => d.stage === "WON").reduce((sum, d) => sum + d.value, 0),
    [deals],
  );
  const pipelineValue = useMemo(() => openDeals.reduce((sum, d) => sum + d.value, 0), [openDeals]);

  const filteredContacts = contacts ?? [];
  const allVisibleSelected = filteredContacts.length > 0 && filteredContacts.every((c) => selected.has(c.id));

  function upsertDeal(deal: CrmDeal) {
    setDeals((prev) => {
      if (!prev) return [deal];
      const exists = prev.some((d) => d.id === deal.id);
      return exists ? prev.map((d) => (d.id === deal.id ? deal : d)) : [deal, ...prev];
    });
  }

  function removeDeal(id: string) {
    setDeals((prev) => prev?.filter((d) => d.id !== id) ?? prev);
    setOpenDealId(null);
  }

  return (
    <div className="p-5 lg:p-7 max-w-[1240px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">مدیریت ارتباط با مشتری</h1>
            <ModuleHelp code="crm" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">پیگیری سرنخ‌ها، مخاطبین و فرصت‌های فروش در یک قیف یکپارچه</p>
        </div>
        <button
          onClick={() => (tab === "pipeline" ? setNewDealFor({}) : setNewContactOpen(true))}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer shrink-0"
        >
          <PlusIcon className="w-4 h-4" />
          {tab === "pipeline" ? "فرصت جدید" : "مخاطب جدید"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <KpiCard
          label="ارزش قیف فروش باز"
          value={pipelineValue}
          unitSuffix={moneyUnit()}
          tone="primary"
          icon={<CrmIcon />}
        />
        <KpiCard
          label="فرصت‌های در جریان"
          value={openDeals.length}
          unitSuffix="فرصت"
          tone="accent"
          icon={<CrmIcon />}
        />
        <KpiCard label="فروش بسته‌شده (برد)" value={wonValue} unitSuffix={moneyUnit()} tone="success" icon={<CrmIcon />} />
      </div>

      <div className="flex items-center gap-2 mt-7 border-b border-border">
        {(
          [
            ["pipeline", "فرصت‌های فروش"],
            ["contacts", "مخاطبین"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "px-4 py-2.5 text-[13px] font-bold border-b-2 -mb-px cursor-pointer transition-colors",
              tab === key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink-soft",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "pipeline" ? (
        <div className="mt-5 -mx-5 lg:-mx-7 px-5 lg:px-7 overflow-x-auto pb-2">
          {deals === null ? (
            <div className="py-16 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : (
            <div className="flex gap-4 min-w-max">
              {STAGE_ORDER.map((stage) => {
                const stageDeals = deals.filter((d) => d.stage === stage);
                const stageValue = stageDeals.reduce((sum, d) => sum + d.value, 0);
                return (
                  <div key={stage} className="w-[260px] shrink-0">
                    <div className="flex items-center justify-between px-1 mb-2.5">
                      <div className="flex items-center gap-2">
                        <Badge tone={STAGE_META[stage].tone}>{STAGE_META[stage].label}</Badge>
                        <span className="text-[11.5px] text-muted">{formatNumber(stageDeals.length)}</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted px-1 mb-2">{formatMoney(stageValue)}</div>
                    <div className="flex flex-col gap-2.5">
                      {stageDeals.map((deal) => (
                        <button
                          key={deal.id}
                          onClick={() => setOpenDealId(deal.id)}
                          className="text-right bg-surface border border-border rounded-2xl p-3.5 cursor-pointer hover:border-primary transition-colors shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                        >
                          <div className="text-[13px] font-bold leading-6">{deal.title}</div>
                          <div className="text-[11.5px] text-muted mt-1">
                            {deal.contact?.name}
                            {deal.contact?.company ? ` · ${deal.contact.company}` : ""}
                          </div>
                          <div className="text-[13px] font-extrabold text-primary mt-2">
                            {formatMoney(deal.value)}
                          </div>
                        </button>
                      ))}
                      {stageDeals.length === 0 ? (
                        <div className="text-[11.5px] text-muted text-center py-6 border border-dashed border-border rounded-2xl">
                          خالی
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5">
          <div className="flex items-start gap-3 flex-wrap mb-4">
            <SearchInput
              className="max-w-[320px] flex-1 min-w-[220px]"
              value={search}
              onChange={setSearch}
              placeholder="جستجوی نام، شرکت، تلفن یا ایمیل..."
              loading={searching}
            />
            <ExcelImportExportBar
              exportPath="/crm/contacts/export"
              exportFilename="contacts.xlsx"
              importPath="/crm/contacts/import"
              templatePath="/crm/contacts/template"
              templateFilename="contacts-template.xlsx"
              onImported={reloadContacts}
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {GROUP_CHIPS.map((chip) => {
              const count = allContacts ? allContacts.filter((c) => inGroup(c, chip.key)).length : null;
              return (
                <button
                  key={chip.key}
                  onClick={() => setGroup(chip.key)}
                  className={clsx(
                    "text-[12px] font-bold px-3 py-1.5 rounded-full cursor-pointer transition-colors",
                    group === chip.key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft hover:bg-slate-200",
                  )}
                >
                  {chip.label}
                  {count !== null ? ` (${formatNumber(count)})` : ""}
                </button>
              );
            })}
          </div>
          <p className="text-[11.5px] text-muted mb-3">
            سرنخ (جدید، در تماس، واجد شرایط) تا اولین خرید یا برد فرصت در «سرنخ‌ها» می‌ماند و بعد خودکار به «مشتریان» می‌رود؛ دو خرید پرداخت‌شده = «خرید تکراری».
            «همه مخاطبین» و جستجو همیشه همه‌ی مراحل را نشان می‌دهند.
          </p>
          {filteredContacts.length > 0 ? (
            <div className="flex items-center gap-3 flex-wrap mb-2 px-1">
              <label className="flex items-center gap-2 text-[12.5px] font-bold cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4.5 h-4.5 cursor-pointer"
                  checked={allVisibleSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(filteredContacts.map((c) => c.id)) : new Set())}
                />
                انتخاب همه ({formatNumber(filteredContacts.length)})
              </label>
              {selected.size > 0 ? (
                <>
                  <span className="text-[12.5px] text-muted">{formatNumber(selected.size)} مخاطب انتخاب شده</span>
                  <select
                    disabled={bulkBusy}
                    value=""
                    onChange={(e) => {
                      const v = e.target.value as "NEW_LEAD" | "CONTACTED" | "QUALIFIED" | "";
                      if (v) void bulkSetStage(v);
                    }}
                    className="text-[12px] font-bold border border-border rounded-lg px-2.5 py-2 bg-surface cursor-pointer disabled:opacity-50"
                    aria-label="تغییر مرحله‌ی انتخاب‌شده‌ها"
                  >
                    <option value="">تغییر مرحله...</option>
                    {(["NEW_LEAD", "CONTACTED", "QUALIFIED"] as const).map((s) => (
                      <option key={s} value={s}>
                        {FUNNEL_STAGE_META[s].label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => void bulkDelete()}
                    className="text-[12px] font-bold text-danger bg-danger-soft px-3.5 py-2 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {bulkBusy ? "در حال انجام..." : `حذف ${formatNumber(selected.size)} مخاطب`}
                  </button>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => setSelected(new Set())}
                    className="text-[12px] font-bold text-muted px-2 py-2 cursor-pointer disabled:opacity-50"
                  >
                    لغو انتخاب
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          {bulkNotice ? (
            <div
              className={clsx(
                "mb-3 rounded-xl px-4 py-3 text-[12.5px] font-semibold",
                bulkNotice.tone === "ok" ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span>{bulkNotice.text}</span>
                <button type="button" onClick={() => setBulkNotice(null)} className="cursor-pointer text-[12px]" aria-label="بستن پیام">
                  ✕
                </button>
              </div>
              {bulkNotice.failures?.length ? (
                <ul className="mt-1.5 font-normal list-disc pr-5 space-y-0.5">
                  {bulkNotice.failures.slice(0, 10).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                  {bulkNotice.failures.length > 10 ? <li>و {formatNumber(bulkNotice.failures.length - 10)} مورد دیگر</li> : null}
                </ul>
              ) : null}
            </div>
          ) : null}
          <Card className="p-2">
            {contacts === null ? (
              <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
            ) : filteredContacts.length === 0 ? (
              <div className="p-8 text-center text-muted text-sm">مخاطبی یافت نشد</div>
            ) : (
              filteredContacts.map((c, i) => (
                <div
                  key={c.id}
                  className={clsx(
                    "flex items-center hover:bg-slate-50 transition-colors",
                    selected.has(c.id) && "bg-primary-soft/40",
                    i < filteredContacts.length - 1 && "border-b border-border",
                  )}
                >
                  <label className="pr-4 pl-1 py-3.5 flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4.5 h-4.5 cursor-pointer"
                      checked={selected.has(c.id)}
                      onChange={(e) => toggleSelected(c.id, e.target.checked)}
                      aria-label={`انتخاب ${c.name}`}
                    />
                  </label>
                  <button
                    onClick={() => setOpenContactId(c.id)}
                    className="flex-1 min-w-0 flex items-center gap-3 px-3 py-3.5 text-right cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                      <BuildingIcon className="w-4.5 h-4.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-bold">{c.name}</div>
                      <div className="text-[11.5px] text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                        {c.company ? <span>{c.company}</span> : null}
                        {c.phone ? (
                          <span className="flex items-center gap-1">
                            <PhoneIcon className="w-3 h-3" />
                            {c.phone}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <FunnelStageBadge stage={c.funnelStage} />
                    <Badge tone="neutral">{formatNumber(c._count?.deals ?? 0)} فرصت</Badge>
                  </button>
                </div>
              ))
            )}
          </Card>
        </div>
      )}

      {openDealId ? (
        <DealModal
          dealId={openDealId}
          onClose={() => setOpenDealId(null)}
          onChanged={upsertDeal}
          onDeleted={removeDeal}
        />
      ) : null}

      {openContactId ? (
        <ContactModal
          contactId={openContactId}
          onClose={() => setOpenContactId(null)}
          onStageChanged={reloadContacts}
          onDeleted={() => {
            setContacts((prev) => prev?.filter((c) => c.id !== openContactId) ?? prev);
            setAllContacts((prev) => prev?.filter((c) => c.id !== openContactId) ?? prev);
          }}
          onNewDeal={(contactId) => {
            setOpenContactId(null);
            setNewDealFor({ contactId });
          }}
        />
      ) : null}

      {newContactOpen ? (
        <NewContactModal
          onClose={() => setNewContactOpen(false)}
          onCreated={() => reloadContacts()}
        />
      ) : null}

      {newDealFor ? (
        <NewDealModal
          defaultContactId={newDealFor.contactId}
          onClose={() => setNewDealFor(null)}
          onCreated={upsertDeal}
        />
      ) : null}
    </div>
  );
}
