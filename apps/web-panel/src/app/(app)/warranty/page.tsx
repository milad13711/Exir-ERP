"use client";

import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { ShieldIcon, PlusIcon, SearchIcon, StoreIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/persian";
import { copyToClipboard } from "@/lib/clipboard";
import { useWorkspace } from "@/lib/workspace-context";
import {
  fetchWarrantyCodes,
  fetchWarrantyProducts,
  fetchWarrantyReports,
  fetchWarrantyGeneralSettings,
  updateWarrantyGeneralSettings,
  fetchWarrantySmsSettings,
  updateWarrantySmsSettings,
  updateWarrantyProduct,
  deleteWarrantyCodes,
  printWarrantyLabelsObjectUrl,
  fetchUsers,
  type WarrantyCode,
  type WarrantyCodeStatus,
  type WarrantyProduct,
  type WarrantyReportsData,
  type WarrantyGeneralSettings,
  type WarrantySmsSettings,
  type TenantUser,
} from "@/lib/api";
import { ManualIssueModal } from "@/components/warranty/ManualIssueModal";
import { ImportLegacyModal } from "@/components/warranty/ImportLegacyModal";
import { WarrantyDetailModal } from "@/components/warranty/WarrantyDetailModal";

type Tab = "codes" | "products" | "reports" | "settings";

const CODE_STATUS_LABELS: Record<WarrantyCodeStatus, string> = { PENDING: "صادرشده", ACTIVE: "فعال", EXPIRED: "منقضی", VOID: "باطل‌شده" };
const CODE_STATUS_TONES: Record<WarrantyCodeStatus, "neutral" | "success" | "warning" | "danger"> = {
  PENDING: "neutral",
  ACTIVE: "success",
  EXPIRED: "warning",
  VOID: "danger",
};

const TABS: { key: Tab; label: string }[] = [
  { key: "codes", label: "کدهای گارانتی" },
  { key: "products", label: "کالاها" },
  { key: "reports", label: "گزارش‌ها" },
  { key: "settings", label: "تنظیمات" },
];

export default function WarrantyPage() {
  const [tab, setTab] = useState<Tab>("codes");

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">گارانتی</h1>
            <ModuleHelp code="warranty" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">صدور کد گارانتی و فعال‌سازی/استعلام مشتری — خدمات پس از فروش در ماژول جدا پیگیری می‌شود</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-6 mb-5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "text-[12.5px] font-semibold px-3.5 py-2 rounded-[10px] transition-colors cursor-pointer",
              tab === t.key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "codes" && <CodesTab />}
      {tab === "products" && <ProductsTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

function CodesTab() {
  const [codes, setCodes] = useState<WarrantyCode[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"همه" | WarrantyCodeStatus>("همه");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manualIssueOpen, setManualIssueOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  function reload() {
    fetchWarrantyCodes({ status: statusFilter === "همه" ? undefined : statusFilter, search: search || undefined })
      .then(setCodes)
      .catch(() => setCodes([]));
  }
  useEffect(reload, [search, statusFilter]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDeleteSelected() {
    if (selected.size === 0 || !confirm(`${toPersianDigits(selected.size)} گارانتی حذف شود؟`)) return;
    await deleteWarrantyCodes([...selected]);
    setSelected(new Set());
    reload();
  }

  async function handlePrintSelected() {
    if (selected.size === 0) return;
    setPrinting(true);
    try {
      const url = await printWarrantyLabelsObjectUrl([...selected]);
      window.open(url, "_blank");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative max-w-[300px] flex-1 min-w-[220px]">
          <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی کد، نام یا موبایل مشتری..."
            className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["همه", "PENDING", "ACTIVE", "EXPIRED", "VOID"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                "text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border transition-colors",
                statusFilter === s ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft",
              )}
            >
              {s === "همه" ? "همه" : CODE_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={() => setImportOpen(true)} className="text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl bg-slate-100 text-ink-soft cursor-pointer">
          وارد کردن قدیمی
        </button>
        <button
          onClick={() => setManualIssueOpen(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          صدور دستی
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 bg-primary-soft rounded-xl px-4 py-2.5">
          <span className="text-[12.5px] font-semibold text-primary">{toPersianDigits(selected.size)} انتخاب‌شده</span>
          <button onClick={handlePrintSelected} disabled={printing} className="text-[12px] font-bold text-primary cursor-pointer disabled:opacity-50">
            {printing ? "در حال آماده‌سازی..." : "چاپ لیبل"}
          </button>
          <button onClick={handleDeleteSelected} className="text-[12px] font-bold text-danger cursor-pointer mr-auto">
            حذف
          </button>
        </div>
      )}

      <Card className="p-2">
        {codes === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : codes.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">گارانتی‌ای یافت نشد</div>
        ) : (
          codes.map((c, i) => (
            <div
              key={c.id}
              className={clsx("w-full flex items-center gap-3 px-4 py-3.5", i < codes.length - 1 && "border-b border-border")}
            >
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} className="w-4 h-4 cursor-pointer" />
              <button onClick={() => setDetailId(c.id)} className="flex-1 min-w-0 flex items-center gap-3 text-right cursor-pointer">
                <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                  <ShieldIcon className="w-4.5 h-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold tracking-wider" dir="ltr">
                    {c.code}
                  </div>
                  <div className="text-[11.5px] text-muted mt-0.5 truncate">
                    {c.itemDescription ?? c.product?.name ?? "—"}
                    {c.invoice ? ` · فاکتور #${toPersianDigits(c.invoice.invoiceNo)}` : ""}
                    {c.activatedByName ? ` · ${c.activatedByName}` : ""}
                  </div>
                </div>
                <Badge tone={CODE_STATUS_TONES[c.status]}>{CODE_STATUS_LABELS[c.status]}</Badge>
              </button>
            </div>
          ))
        )}
      </Card>

      {manualIssueOpen && <ManualIssueModal onClose={() => setManualIssueOpen(false)} onIssued={reload} />}
      {importOpen && <ImportLegacyModal onClose={() => setImportOpen(false)} onImported={reload} />}
      {detailId && <WarrantyDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </>
  );
}

function ProductsTab() {
  const [products, setProducts] = useState<WarrantyProduct[] | null>(null);

  function reload() {
    fetchWarrantyProducts().then(setProducts).catch(() => setProducts([]));
  }
  useEffect(reload, []);

  async function handleToggle(p: WarrantyProduct) {
    const updated = await updateWarrantyProduct(p.id, { warrantyEnabled: !p.warrantyEnabled, warrantyDurationDays: p.warrantyDurationDays ?? undefined });
    setProducts((prev) => prev?.map((x) => (x.id === p.id ? updated : x)) ?? null);
  }

  async function handleDurationChange(p: WarrantyProduct, days: string) {
    const updated = await updateWarrantyProduct(p.id, { warrantyEnabled: p.warrantyEnabled, warrantyDurationDays: days ? Number(days) : undefined });
    setProducts((prev) => prev?.map((x) => (x.id === p.id ? updated : x)) ?? null);
  }

  return (
    <Card className="p-2">
      {products === null ? (
        <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : products.length === 0 ? (
        <div className="p-8 text-center text-muted text-sm">کالایی یافت نشد</div>
      ) : (
        products.map((p, i) => (
          <div key={p.id} className={clsx("flex items-center gap-3 px-4 py-3.5", i < products.length - 1 && "border-b border-border")}>
            <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
              <StoreIcon className="w-4.5 h-4.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold truncate">{p.name}</div>
              <div className="text-[11.5px] text-muted mt-0.5">{p.sku}</div>
            </div>
            {p.warrantyEnabled && (
              <input
                type="number"
                min={1}
                defaultValue={p.warrantyDurationDays ?? ""}
                onBlur={(e) => handleDurationChange(p, e.target.value)}
                placeholder="روز"
                className="w-20 text-[12.5px] text-center outline-none bg-surface border border-border rounded-lg px-2 py-1.5 focus:border-primary"
              />
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-[12px] text-ink-soft">گارانتی</span>
              <input type="checkbox" checked={p.warrantyEnabled} onChange={() => handleToggle(p)} className="w-4 h-4 cursor-pointer" />
            </label>
          </div>
        ))
      )}
    </Card>
  );
}

function ReportsTab() {
  const [data, setData] = useState<WarrantyReportsData | null>(null);

  useEffect(() => {
    fetchWarrantyReports().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="کل کدهای صادرشده" value={data.totalCodes} tone="primary" icon={<ShieldIcon />} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ReportList title="وضعیت گارانتی‌ها" rows={Object.entries(data.statusBreakdown).map(([k, v]) => [CODE_STATUS_LABELS[k as WarrantyCodeStatus] ?? k, v])} />
        <ReportList title="بیشترین فعال‌سازی گارانتی" rows={data.topItemsByActivation.map((r) => [r.itemDescription, r.total])} />
        <ReportList title="مشتریانی که بیشترین گارانتی خریداری کرده‌اند" rows={data.topContactsByActivation.map((r) => [r.name, r.total])} />
      </div>
    </div>
  );
}

function ReportList({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <Card className="p-4">
      <div className="text-[13px] font-bold mb-3">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[12.5px] text-muted">داده‌ای موجود نیست</div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between text-[12.5px]">
              <span className="text-ink-soft">{label}</span>
              <span className="font-bold">{toPersianDigits(value)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SettingsTab() {
  const { me } = useWorkspace();
  const [subTab, setSubTab] = useState<"general" | "sms">("general");
  const [general, setGeneral] = useState<WarrantyGeneralSettings | null>(null);
  const [sms, setSms] = useState<WarrantySmsSettings | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [saved, setSaved] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    fetchWarrantyGeneralSettings().then(setGeneral);
    fetchWarrantySmsSettings().then(setSms);
    fetchUsers().then(setUsers).catch(() => setUsers([]));
    // window.location فقط بعد از mount در دسترس است — برای پرهیز از mismatch سرور/کلاینت عمداً همین‌جا ست می‌شود
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const publicLink = `${origin}/warranty/${me?.tenant.slug ?? ""}`;

  async function handleCopyLink() {
    const ok = await copyToClipboard(publicLink);
    if (ok) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }

  async function saveGeneral() {
    if (!general) return;
    const updated = await updateWarrantyGeneralSettings(general);
    setGeneral(updated);
    flashSaved();
  }

  async function saveSms() {
    if (!sms) return;
    const updated = await updateWarrantySmsSettings(sms);
    setSms(updated);
    flashSaved();
  }

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-[560px]">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setSubTab("general")}
          className={clsx("text-[12.5px] font-semibold px-3.5 py-2 rounded-[10px]", subTab === "general" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}
        >
          عمومی
        </button>
        <button
          onClick={() => setSubTab("sms")}
          className={clsx("text-[12.5px] font-semibold px-3.5 py-2 rounded-[10px]", subTab === "sms" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}
        >
          پیامک
        </button>
      </div>

      <Card className="p-4 mb-4">
        <div className="text-[12px] font-semibold text-ink-soft mb-2">لینک عمومی صفحه فعال‌سازی/پیگیری گارانتی مشتری</div>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={publicLink}
            dir="ltr"
            className="flex-1 text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2 text-muted"
          />
          <button onClick={handleCopyLink} className="text-[12px] font-bold px-3.5 py-2 rounded-lg bg-primary-soft text-primary cursor-pointer shrink-0">
            {linkCopied ? "کپی شد ✓" : "کپی لینک"}
          </button>
        </div>
      </Card>

      {subTab === "general" && general && (
        <Card className="p-5 flex flex-col gap-3.5">
          <SettingField label="مسئول گارانتی (برای پیگیری اعلان‌های فعال‌سازی)">
            <select
              value={general.warrantyManagerUserId ?? ""}
              onChange={(e) => setGeneral({ ...general, warrantyManagerUserId: e.target.value || null })}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            >
              <option value="">همه‌ی مالک/مدیران تننت</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </SettingField>
          <SettingField label="مدت گارانتی پیش‌فرض (روز)">
            <input
              type="number"
              min={1}
              value={general.defaultDurationDays}
              onChange={(e) => setGeneral({ ...general, defaultDurationDays: Number(e.target.value) })}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            />
          </SettingField>
          <SettingField label="چند روز قبل از انقضا یادآوری پیامکی ارسال شود">
            <input
              type="number"
              min={0}
              value={general.reminderDaysBeforeExpiry}
              onChange={(e) => setGeneral({ ...general, reminderDaysBeforeExpiry: Number(e.target.value) })}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            />
          </SettingField>
          <SettingField label="شرایط و ضوابط گارانتی (نمایش در فرم فعال‌سازی)">
            <textarea
              value={general.termsConditions}
              onChange={(e) => setGeneral({ ...general, termsConditions: e.target.value })}
              rows={3}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary resize-none"
            />
          </SettingField>
          <SaveButton onClick={saveGeneral} saved={saved} />
        </Card>
      )}

      {subTab === "sms" && sms && (
        <Card className="p-5 flex flex-col gap-3.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={sms.enabled} onChange={(e) => setSms({ ...sms, enabled: e.target.checked })} className="w-4 h-4 cursor-pointer" />
            <span className="text-[13px] font-bold">ارسال پیامک برای این ماژول فعال باشد</span>
          </label>

          <SmsTriggerField
            label="فعال‌سازی گارانتی → پیامک به مشتری"
            enabled={sms.activationCustomerEnabled}
            onEnabledChange={(v) => setSms({ ...sms, activationCustomerEnabled: v })}
            template={sms.activationCustomerTemplate}
            onTemplateChange={(v) => setSms({ ...sms, activationCustomerTemplate: v })}
          />
          <SmsTriggerField
            label="فعال‌سازی گارانتی → اطلاع‌رسانی به مسئول گارانتی"
            enabled={sms.activationStaffEnabled}
            onEnabledChange={(v) => setSms({ ...sms, activationStaffEnabled: v })}
            template={sms.activationStaffTemplate}
            onTemplateChange={(v) => setSms({ ...sms, activationStaffTemplate: v })}
          />

          <SaveButton onClick={saveSms} saved={saved} />
        </Card>
      )}
    </div>
  );
}

function SettingField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function SmsTriggerField({
  label,
  enabled,
  onEnabledChange,
  template,
  onTemplateChange,
}: {
  label: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  template?: string;
  onTemplateChange?: (v: string) => void;
}) {
  return (
    <div className="border border-border rounded-xl p-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} className="w-4 h-4 cursor-pointer" />
        <span className="text-[12.5px] font-bold">{label}</span>
      </label>
      {template !== undefined && onTemplateChange && (
        <input
          value={template}
          onChange={(e) => onTemplateChange(e.target.value)}
          className="w-full text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 mt-2 focus:border-primary"
        />
      )}
    </div>
  );
}

function SaveButton({ onClick, saved }: { onClick: () => void; saved: boolean }) {
  return (
    <button onClick={onClick} className="self-start text-[12.5px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white cursor-pointer">
      {saved ? "ذخیره شد ✓" : "ذخیره"}
    </button>
  );
}
