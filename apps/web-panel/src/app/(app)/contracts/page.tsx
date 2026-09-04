"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DocsIcon, PlusIcon, SearchIcon, SettingsIcon } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import { fetchContracts, type Contract, type ContractStatus } from "@/lib/api";
import { NewContractModal } from "@/components/contracts/NewContractModal";
import { ContractDetailModal } from "@/components/contracts/ContractDetailModal";
import { ContractTemplatesModal } from "@/components/contracts/ContractTemplatesModal";

const STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: "پیش‌نویس",
  ACTIVE: "فعال",
  EXPIRED: "منقضی‌شده",
  TERMINATED: "فسخ‌شده",
};
const STATUS_TONES: Record<ContractStatus, "primary" | "success" | "neutral" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  EXPIRED: "danger",
  TERMINATED: "danger",
};

type StatusFilter = "همه" | ContractStatus;

function partyDisplayName(c: Contract): string {
  return c.employee?.fullName ?? c.contact?.name ?? c.secondPartyContact?.name ?? c.secondPartyName ?? "—";
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("همه");
  const [newOpen, setNewOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [openContract, setOpenContract] = useState<Contract | null>(null);

  function reload() {
    fetchContracts().then(setContracts).catch(() => setContracts([]));
  }
  useEffect(reload, []);

  const filtered = useMemo(() => {
    if (!contracts) return [];
    return contracts.filter((c) => {
      const matchesStatus = statusFilter === "همه" || c.status === statusFilter;
      const matchesSearch = !search.trim() || c.title.includes(search) || partyDisplayName(c).includes(search) || String(c.contractNo).includes(search);
      return matchesStatus && matchesSearch;
    });
  }, [contracts, search, statusFilter]);

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">مدیریت قرارداد</h1>
          <p className="text-[13.5px] text-muted mt-1">قراردادهای داخلی، خارجی و بین‌طرفین — با امضای دیجیتال دوطرفه</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setTemplatesOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <SettingsIcon className="w-4 h-4" />
            قالب‌های قرارداد
          </button>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
          >
            <PlusIcon className="w-4 h-4" />
            قرارداد جدید
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-6 mb-4 flex-wrap">
        <div className="relative max-w-[300px] flex-1 min-w-[220px]">
          <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی عنوان، طرف قرارداد یا شماره..."
            className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["همه", "DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                "text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border transition-colors",
                statusFilter === s ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft",
              )}
            >
              {s === "همه" ? "همه" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-2">
        {contracts === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">قراردادی یافت نشد</div>
        ) : (
          filtered.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setOpenContract(c)}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                i < filtered.length - 1 && "border-b border-border",
              )}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <DocsIcon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-bold truncate">{c.title}</div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  #{c.contractNo} · {partyDisplayName(c)}
                  {c.type ? ` · ${c.type === "SALES" ? "فروش" : "خرید"}` : ""}
                  {c.isLocked ? " · 🔒" : ""}
                </div>
              </div>
              <div className="text-[12px] text-muted w-[130px] text-left shrink-0 hidden sm:block">
                تا {formatJalaliDate(c.endDate)}
              </div>
              <div className="text-[13px] font-extrabold w-[110px] text-left shrink-0 hidden sm:block">
                {formatToman(c.value)}
              </div>
              <Badge tone={STATUS_TONES[c.status]}>{STATUS_LABELS[c.status]}</Badge>
            </button>
          ))
        )}
      </Card>

      {newOpen ? <NewContractModal onClose={() => setNewOpen(false)} onCreated={reload} /> : null}
      {templatesOpen ? <ContractTemplatesModal onClose={() => setTemplatesOpen(false)} /> : null}
      {openContract ? (
        <ContractDetailModal contract={openContract} onClose={() => setOpenContract(null)} onChanged={reload} />
      ) : null}
    </div>
  );
}
