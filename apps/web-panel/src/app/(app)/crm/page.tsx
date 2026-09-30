"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { CrmIcon, PlusIcon, SearchIcon, BuildingIcon, PhoneIcon } from "@/components/icons";
import { formatToman, formatNumber } from "@/lib/persian";
import { fetchCrmDeals, fetchCrmContacts, type CrmDeal, type CrmContact } from "@/lib/api";
import { STAGE_ORDER, STAGE_META } from "@/components/crm/crm-shared";
import { ExcelImportExportBar } from "@/components/shared/ExcelImportExportBar";
import { DealModal } from "@/components/crm/DealModal";
import { ContactModal } from "@/components/crm/ContactModal";
import { NewContactModal } from "@/components/crm/NewContactModal";
import { NewDealModal } from "@/components/crm/NewDealModal";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
type Tab = "pipeline" | "contacts";

export default function CrmPage() {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [deals, setDeals] = useState<CrmDeal[] | null>(null);
  const [contacts, setContacts] = useState<CrmContact[] | null>(null);
  const [search, setSearch] = useState("");

  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [newDealFor, setNewDealFor] = useState<{ contactId?: string } | null>(null);
  const searchParams = useSearchParams();

  function reloadContacts() {
    fetchCrmContacts().then(setContacts).catch(() => setContacts([]));
  }

  useEffect(() => {
    fetchCrmDeals().then(setDeals).catch(() => setDeals([]));
    reloadContacts();
  }, []);

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

  const filteredContacts = useMemo(() => {
    if (!contacts) return [];
    const q = search.trim();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.includes(q) ||
        (c.company ?? "").includes(q) ||
        (c.phone ?? "").includes(q) ||
        (c.email ?? "").includes(q),
    );
  }, [contacts, search]);

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
          unitSuffix="تومان"
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
        <KpiCard label="فروش بسته‌شده (برد)" value={wonValue} unitSuffix="تومان" tone="success" icon={<CrmIcon />} />
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
                    <div className="text-[11px] text-muted px-1 mb-2">{formatToman(stageValue)}</div>
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
                            {formatToman(deal.value)}
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
            <div className="relative max-w-[320px] flex-1 min-w-[220px]">
              <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="جستجوی نام، شرکت، تلفن یا ایمیل..."
                className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
              />
            </div>
            <ExcelImportExportBar
              exportPath="/crm/contacts/export"
              exportFilename="contacts.xlsx"
              importPath="/crm/contacts/import"
              templatePath="/crm/contacts/template"
              templateFilename="contacts-template.xlsx"
              onImported={reloadContacts}
            />
          </div>
          <Card className="p-2">
            {contacts === null ? (
              <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
            ) : filteredContacts.length === 0 ? (
              <div className="p-8 text-center text-muted text-sm">مخاطبی یافت نشد</div>
            ) : (
              filteredContacts.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => setOpenContactId(c.id)}
                  className={clsx(
                    "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                    i < filteredContacts.length - 1 && "border-b border-border",
                  )}
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
                  <Badge tone="neutral">{formatNumber(c._count?.deals ?? 0)} فرصت</Badge>
                </button>
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
          onDeleted={() => setContacts((prev) => prev?.filter((c) => c.id !== openContactId) ?? prev)}
          onNewDeal={(contactId) => {
            setOpenContactId(null);
            setNewDealFor({ contactId });
          }}
        />
      ) : null}

      {newContactOpen ? (
        <NewContactModal
          onClose={() => setNewContactOpen(false)}
          onCreated={(contact) => setContacts((prev) => [contact, ...(prev ?? [])])}
        />
      ) : null}

      {newDealFor ? (
        <NewDealModal
          contacts={contacts ?? []}
          defaultContactId={newDealFor.contactId}
          onClose={() => setNewDealFor(null)}
          onCreated={upsertDeal}
        />
      ) : null}
    </div>
  );
}
