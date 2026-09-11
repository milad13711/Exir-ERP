"use client";

import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { CompassIcon, ReceiptIcon, StoreIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/persian";
import { copyToClipboard } from "@/lib/clipboard";
import { useWorkspace } from "@/lib/workspace-context";
import {
  fetchAfterSalesServices,
  fetchAfterSalesReports,
  fetchAfterSalesGeneralSettings,
  updateAfterSalesGeneralSettings,
  fetchAfterSalesSmsSettings,
  updateAfterSalesSmsSettings,
  fetchUsers,
  type WarrantyServiceRequest,
  type WarrantyServiceStatus,
  type AfterSalesReportsData,
  type AfterSalesGeneralSettings,
  type AfterSalesSmsSettings,
  type TenantUser,
} from "@/lib/api";
import { ServiceDetailModal } from "@/components/after-sales/ServiceDetailModal";

type Tab = "services" | "reports" | "settings";

const SERVICE_STATUS_LABELS: Record<WarrantyServiceStatus, string> = {
  NEW: "جدید",
  REVIEWING: "در حال بررسی",
  AWAITING_PRODUCT: "در انتظار ارسال کالا",
  IN_PROGRESS: "در حال تعمیر",
  RESOLVED: "برطرف‌شده",
  CLOSED: "بسته‌شده",
};

const TABS: { key: Tab; label: string }[] = [
  { key: "services", label: "درخواست‌ها" },
  { key: "reports", label: "گزارش‌ها" },
  { key: "settings", label: "تنظیمات" },
];

export default function AfterSalesPage() {
  const [tab, setTab] = useState<Tab>("services");

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">خدمات پس از فروش</h1>
            <ModuleHelp code="after-sales-service" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">ثبت و پیگیری درخواست خدمات پس از فروش برای گارانتی‌های فعال</p>
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

      {tab === "services" && <ServicesTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

function ServicesTab() {
  const [services, setServices] = useState<WarrantyServiceRequest[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<"همه" | WarrantyServiceStatus>("همه");
  const [detailId, setDetailId] = useState<string | null>(null);

  function reload() {
    fetchAfterSalesServices(statusFilter === "همه" ? undefined : statusFilter)
      .then(setServices)
      .catch(() => setServices([]));
  }
  useEffect(reload, [statusFilter]);

  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(["همه", ...Object.keys(SERVICE_STATUS_LABELS)] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s as "همه" | WarrantyServiceStatus)}
            className={clsx(
              "text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border transition-colors",
              statusFilter === s ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft",
            )}
          >
            {s === "همه" ? "همه" : SERVICE_STATUS_LABELS[s as WarrantyServiceStatus]}
          </button>
        ))}
      </div>

      <Card className="p-2">
        {services === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : services.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">درخواستی یافت نشد</div>
        ) : (
          services.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setDetailId(s.id)}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                i < services.length - 1 && "border-b border-border",
              )}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <CompassIcon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate">{s.description}</div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {s.warranty.code} · {s.warranty.activatedByName ?? "—"}
                </div>
              </div>
              <Badge tone="neutral">{SERVICE_STATUS_LABELS[s.status]}</Badge>
            </button>
          ))
        )}
      </Card>

      {detailId && <ServiceDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </>
  );
}

function ReportsTab() {
  const [data, setData] = useState<AfterSalesReportsData | null>(null);

  useEffect(() => {
    fetchAfterSalesReports().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard label="کل درخواست‌های خدمات" value={data.totalServices} tone="accent" icon={<CompassIcon />} />
        <KpiCard
          label="میانگین زمان رفع (ساعت)"
          value={data.avgResolutionHours ?? 0}
          unitSuffix={data.resolvedCount > 0 ? `از ${toPersianDigits(data.resolvedCount)} مورد` : undefined}
          tone="success"
          icon={<ReceiptIcon />}
        />
        <KpiCard
          label="میانگین امتیاز مشتری"
          value={data.avgRating ?? 0}
          unitSuffix={data.ratingCount > 0 ? `از ${toPersianDigits(data.ratingCount)} نظر` : "بدون نظر"}
          tone="warning"
          icon={<StoreIcon />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ReportList title="وضعیت درخواست‌های خدمات" rows={Object.entries(data.serviceStatusBreakdown).map(([k, v]) => [SERVICE_STATUS_LABELS[k as WarrantyServiceStatus] ?? k, v])} />
        <ReportList title="پرتکرارترین کالا در درخواست خدمات" rows={data.topItemsByService.map((r) => [r.itemDescription, r.total])} />
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
  const [general, setGeneral] = useState<AfterSalesGeneralSettings | null>(null);
  const [sms, setSms] = useState<AfterSalesSmsSettings | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [saved, setSaved] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    fetchAfterSalesGeneralSettings().then(setGeneral);
    fetchAfterSalesSmsSettings().then(setSms);
    fetchUsers().then(setUsers).catch(() => setUsers([]));
    // window.location فقط بعد از mount در دسترس است — برای پرهیز از mismatch سرور/کلاینت عمداً همین‌جا ست می‌شود
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const publicLink = `${origin}/after-sales/${me?.tenant.slug ?? ""}`;

  async function handleCopyLink() {
    const ok = await copyToClipboard(publicLink);
    if (ok) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }

  async function saveGeneral() {
    if (!general) return;
    const updated = await updateAfterSalesGeneralSettings(general);
    setGeneral(updated);
    flashSaved();
  }

  async function saveSms() {
    if (!sms) return;
    const updated = await updateAfterSalesSmsSettings(sms);
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
        <div className="text-[12px] font-semibold text-ink-soft mb-2">لینک عمومی صفحه‌ی درخواست خدمات پس از فروش</div>
        <div className="text-[11.5px] text-muted mb-2 leading-relaxed">
          این لینک از استعلام گارانتی هم قابل دسترسی است؛ برای ارسال مستقیم به مشتری، کد گارانتی را به‌صورت{" "}
          <span dir="ltr" className="font-mono">
            ?code=CODE
          </span>{" "}
          به انتهای آن اضافه کنید.
        </div>
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
          <SettingField label="مسئول خدمات پس از فروش (برای پیگیری درخواست‌ها)">
            <select
              value={general.serviceManagerUserId ?? ""}
              onChange={(e) => setGeneral({ ...general, serviceManagerUserId: e.target.value || null })}
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
          <SettingField label="شرایط خدمات پس از فروش (نمایش در فرم درخواست خدمات)">
            <textarea
              value={general.serviceTermsConditions}
              onChange={(e) => setGeneral({ ...general, serviceTermsConditions: e.target.value })}
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
            label="ثبت درخواست خدمات جدید → اطلاع‌رسانی به مسئول خدمات"
            enabled={sms.serviceNewStaffEnabled}
            onEnabledChange={(v) => setSms({ ...sms, serviceNewStaffEnabled: v })}
            template={sms.serviceNewStaffTemplate}
            onTemplateChange={(v) => setSms({ ...sms, serviceNewStaffTemplate: v })}
          />
          <SmsTriggerField
            label="تغییر وضعیت خدمات → پیامک به مشتری"
            enabled={sms.serviceStatusCustomerEnabled}
            onEnabledChange={(v) => setSms({ ...sms, serviceStatusCustomerEnabled: v })}
            template={sms.serviceStatusCustomerTemplate}
            onTemplateChange={(v) => setSms({ ...sms, serviceStatusCustomerTemplate: v })}
          />
          <SmsTriggerField
            label="تغییر وضعیت خدمات → اطلاع‌رسانی به مسئول خدمات"
            enabled={sms.serviceStatusStaffEnabled}
            onEnabledChange={(v) => setSms({ ...sms, serviceStatusStaffEnabled: v })}
            template={sms.serviceStatusStaffTemplate}
            onTemplateChange={(v) => setSms({ ...sms, serviceStatusStaffTemplate: v })}
          />

          <div className="border-t border-border pt-3.5">
            <div className="text-[12.5px] font-bold mb-2">الگوهای آماده‌ی پیامک به مشتری</div>
            <div className="flex flex-col gap-2">
              {sms.quickTemplates.map((t, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <input
                      value={t.title}
                      onChange={(e) => {
                        const next = [...sms.quickTemplates];
                        next[i] = { ...next[i], title: e.target.value };
                        setSms({ ...sms, quickTemplates: next });
                      }}
                      placeholder="عنوان کوتاه"
                      className="w-full text-[12px] font-bold outline-none bg-surface border border-border rounded-lg px-3 py-1.5 focus:border-primary"
                    />
                    <input
                      value={t.text}
                      onChange={(e) => {
                        const next = [...sms.quickTemplates];
                        next[i] = { ...next[i], text: e.target.value };
                        setSms({ ...sms, quickTemplates: next });
                      }}
                      placeholder="متن پیامک..."
                      className="w-full text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-1.5 focus:border-primary"
                    />
                  </div>
                  <button
                    onClick={() => setSms({ ...sms, quickTemplates: sms.quickTemplates.filter((_, idx) => idx !== i) })}
                    className="text-[11.5px] font-bold text-danger px-2 py-1.5 cursor-pointer"
                  >
                    حذف
                  </button>
                </div>
              ))}
              <button
                onClick={() => setSms({ ...sms, quickTemplates: [...sms.quickTemplates, { title: "", text: "" }] })}
                className="self-start text-[12px] font-bold text-primary cursor-pointer"
              >
                + افزودن الگو
              </button>
            </div>
          </div>

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
