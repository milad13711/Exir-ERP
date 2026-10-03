"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DocsIcon, PlusIcon, SettingsIcon } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import { fetchContracts, fetchContractCategories, type Contract, type ContractStatus } from "@/lib/api";
import { NewContractModal } from "@/components/contracts/NewContractModal";
import { ContractDetailModal } from "@/components/contracts/ContractDetailModal";
import { ContractTemplatesModal } from "@/components/contracts/ContractTemplatesModal";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
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
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("همه");

  const debouncedSearch = useDebouncedValue(search, 300);
  const beginRequest = useRequestGuard();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const searching = loadedFor === null || loadedFor !== search.trim();
  function loadList() {
    const isCurrent = beginRequest();
    const requested = debouncedSearch.trim();
    fetchContracts({ q: debouncedSearch.trim() || undefined })
      .then((r) => {
        if (isCurrent()) setContracts(r);
      })
      .catch(() => {
        if (isCurrent()) setContracts((prev) => prev ?? []);
      })
      .finally(() => {
        if (isCurrent()) setLoadedFor(requested);
      });
  }
  function reload() {
    loadList();
    fetchContractCategories().then(setCategories).catch(() => setCategories([]));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadList, [debouncedSearch]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchContractCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const filtered = useMemo(() => {
    if (!contracts) return [];
    return contracts.filter((c) => {
      const matchesStatus = statusFilter === "همه" || c.status === statusFilter;
      const matchesCategory = categoryFilter === "همه" || c.category === categoryFilter;
      return matchesStatus && matchesCategory;
    });
  }, [contracts, statusFilter, categoryFilter]);

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">مدیریت قرارداد</h1>
            <ModuleHelp code="contracts" />
          </div>
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
        <SearchInput className="max-w-[300px] flex-1 min-w-[220px]" value={search} onChange={setSearch} placeholder="جستجوی عنوان، طرف قرارداد یا شماره..." loading={searching} />
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
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-[12.5px] outline-none bg-surface border border-border rounded-xl px-3 py-2.5"
          >
            <option value="همه">همه دسته‌بندی‌ها</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      <Card className="p-2">
        {contracts === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">قراردادی یافت نشد</div>
        ) : (
          filtered.map((c, i) => {
            const signatureCount = (c.partyASignedAt ? 1 : 0) + (c.partyBSignedAt ? 1 : 0);
            const expiryDays = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86_400_000);
            return (
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
                    {c.category ? ` · ${c.category}` : ""}
                  </div>
                </div>
                {c.status === "ACTIVE" && expiryDays <= 30 && (
                  <Badge tone={expiryDays < 0 ? "danger" : "warning"}>
                    {expiryDays < 0 ? `${Math.abs(expiryDays)} روز عقب‌افتاده` : `${expiryDays} روز تا انقضا`}
                  </Badge>
                )}
                <Badge tone={c.isLocked ? "success" : signatureCount === 1 ? "warning" : "neutral"}>
                  {c.isLocked ? "🔒 امضا شده" : signatureCount === 1 ? "یک طرف امضا کرده" : "در انتظار امضا"}
                </Badge>
                <div className="text-[12px] text-muted w-[130px] text-left shrink-0 hidden sm:block">
                  تا {formatJalaliDate(c.endDate)}
                </div>
                <div className="text-[13px] font-extrabold w-[110px] text-left shrink-0 hidden sm:block">
                  {formatToman(c.value)}
                </div>
                <Badge tone={STATUS_TONES[c.status]}>{STATUS_LABELS[c.status]}</Badge>
              </button>
            );
          })
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
