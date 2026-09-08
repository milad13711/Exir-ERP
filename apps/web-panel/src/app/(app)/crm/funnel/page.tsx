"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { CurrencyIcon, ClockIcon, WarningIcon, StarIcon, CloseIcon } from "@/components/icons";
import { toPersianDigits, formatJalaliDate } from "@/lib/persian";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import {
  fetchFunnelSummary,
  fetchFunnelKpis,
  fetchFunnelContacts,
  updateFunnelStage,
  type FunnelSummary,
  type FunnelSalesKpis,
  type FunnelContact,
} from "@/lib/api";

const STAGE_COLORS: Record<string, string> = {
  NEW_LEAD: "#94a3b8",
  CONTACTED: "#818cf8",
  QUALIFIED: "#6366f1",
  CUSTOMER: "#4f46e5",
  REPEAT_CUSTOMER: "#4338ca",
};

const MANUAL_STAGES: { stage: "NEW_LEAD" | "CONTACTED" | "QUALIFIED"; label: string }[] = [
  { stage: "NEW_LEAD", label: "سرنخ جدید" },
  { stage: "CONTACTED", label: "در تماس" },
  { stage: "QUALIFIED", label: "واجد شرایط" },
];

export default function FunnelPage() {
  const [summary, setSummary] = useState<FunnelSummary | null>(null);
  const [kpis, setKpis] = useState<FunnelSalesKpis | null>(null);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [stageContacts, setStageContacts] = useState<FunnelContact[] | null>(null);

  function reload() {
    fetchFunnelSummary().then(setSummary).catch(() => setSummary(null));
    fetchFunnelKpis().then(setKpis).catch(() => setKpis(null));
  }

  useEffect(reload, []);

  function openStage(stage: string) {
    setActiveStage(stage);
    setStageContacts(null);
    fetchFunnelContacts(stage)
      .then(setStageContacts)
      .catch(() => setStageContacts([]));
  }

  async function moveStage(contactId: string, stage: "NEW_LEAD" | "CONTACTED" | "QUALIFIED") {
    await updateFunnelStage(contactId, stage);
    if (activeStage) openStage(activeStage);
    reload();
  }

  const maxCount = summary ? Math.max(...summary.stages.map((s) => s.count), 1) : 1;

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-extrabold">قیف سرنخ و فروش</h1>
          <ModuleHelp code="crm-funnel" />
        </div>
        <p className="text-[13.5px] text-muted mt-1">
          مسیر تبدیل سرنخ به مشتری، سلامت برند (تکرار خرید، سفیر برند، ریسک ریزش)، و شاخص‌های استاندارد فروش
        </p>
      </div>

      {kpis ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mt-6">
          <KpiCard
            label="میانگین هزینه‌ی جذب سرنخ"
            value={kpis.avgAcquisitionCost ?? 0}
            unitSuffix="تومان"
            tone="accent"
            icon={<CurrencyIcon />}
          />
          <KpiCard
            label="میانگین زمان پیگیری سرنخ"
            value={kpis.avgFollowUpHours ?? 0}
            unitSuffix="ساعت"
            tone="primary"
            icon={<ClockIcon />}
          />
          <div className="bg-surface border border-border rounded-2xl p-4.5">
            <span className="text-[13px] text-muted">بهترین منبع سرنخ</span>
            <div className="text-lg font-extrabold mt-3">{kpis.bestSource?.source ?? "—"}</div>
            {kpis.bestSource ? (
              <div className="text-xs text-success font-semibold mt-1.5">
                {toPersianDigits(kpis.bestSource.conversionRate)}٪ نرخ تبدیل ({toPersianDigits(kpis.bestSource.totalLeads)} سرنخ)
              </div>
            ) : null}
          </div>
          {summary?.bottleneck ? (
            <div className="bg-danger-soft border border-danger/20 rounded-2xl p-4.5">
              <span className="text-[13px] text-danger font-semibold flex items-center gap-1.5">
                <WarningIcon className="w-3.5 h-3.5" /> گلوگاه قیف
              </span>
              <div className="text-sm font-extrabold mt-3 text-danger">
                {summary.bottleneck.fromStage} ← {summary.bottleneck.toStage}
              </div>
              <div className="text-xs text-danger/80 font-semibold mt-1.5">
                فقط {toPersianDigits(summary.bottleneck.rate ?? 0)}٪ تبدیل می‌شوند
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <Card className="p-6 mt-6">
          <h2 className="text-[14px] font-extrabold mb-5">قیف تبدیل — روی هر مرحله کلیک کنید</h2>
          <div className="flex flex-col gap-1.5">
            {summary.stages.map((s, i) => {
              const widthPercent = Math.max(18, (s.count / maxCount) * 100);
              const inset = (100 - widthPercent) / 2;
              const rate = summary.conversionRates[i - 1];
              const isBottleneck = summary.bottleneck && rate && summary.bottleneck.toStage === s.stage;
              return (
                <div key={s.stage} className="flex flex-col items-center">
                  {rate ? (
                    <div
                      className={clsx(
                        "text-[11px] font-bold py-1 px-2.5 rounded-full -mb-1 z-10",
                        isBottleneck ? "bg-danger text-white" : "bg-slate-100 text-ink-soft",
                      )}
                    >
                      {rate.rate !== null ? `${toPersianDigits(rate.rate)}٪ تبدیل` : "—"}
                    </div>
                  ) : null}
                  <button
                    onClick={() => openStage(s.stage)}
                    style={{
                      clipPath: `polygon(${inset}% 0, ${100 - inset}% 0, ${100 - inset * 0.6}% 100%, ${inset * 0.6}% 100%)`,
                      background: STAGE_COLORS[s.stage] ?? "#64748b",
                    }}
                    className="w-full h-16 flex items-center justify-center gap-2 cursor-pointer transition-transform hover:scale-[1.01]"
                  >
                    <span className="text-white font-bold text-[13px]">{s.label}</span>
                    <span className="text-white/90 font-extrabold text-[15px]">{toPersianDigits(s.count)}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-5">
          <button
            onClick={() => openStage("REPEAT_CUSTOMER")}
            className="text-right bg-surface border border-border rounded-2xl p-4.5 cursor-pointer"
          >
            <div className="text-[13px] text-muted">خرید تکراری</div>
            <div className="text-2xl font-extrabold mt-2">{toPersianDigits(summary.currentDistribution.REPEAT_CUSTOMER ?? 0)}</div>
          </button>
          <button
            onClick={() => openStage("BRAND_AMBASSADOR")}
            className="text-right bg-warning-soft border border-warning/20 rounded-2xl p-4.5 cursor-pointer"
          >
            <div className="text-[13px] text-warning font-semibold flex items-center gap-1.5">
              <StarIcon className="w-3.5 h-3.5" /> سفیر برند
            </div>
            <div className="text-2xl font-extrabold mt-2 text-warning">{toPersianDigits(summary.ambassador.totalAmbassadors)}</div>
            <div className="text-[11.5px] text-warning/80 font-semibold mt-1.5">
              {toPersianDigits(summary.ambassador.ratioPercent)}٪ از مشتریان
              {summary.ambassador.hasStrongBrandingPotential ? " — پتانسیل برندسازی قوی" : ""}
            </div>
            <div className={clsx("text-[11px] font-bold mt-1", summary.ambassador.growthPercent >= 0 ? "text-success" : "text-danger")}>
              {summary.ambassador.growthPercent >= 0 ? "+" : ""}
              {toPersianDigits(summary.ambassador.growthPercent)}٪ نسبت به ماه قبل
            </div>
          </button>
          <button
            onClick={() => openStage("CHURN_RISK")}
            className="text-right bg-danger-soft border border-danger/20 rounded-2xl p-4.5 cursor-pointer"
          >
            <div className="text-[13px] text-danger font-semibold flex items-center gap-1.5">
              <WarningIcon className="w-3.5 h-3.5" /> ریسک ریزش / غیرفعال
            </div>
            <div className="text-2xl font-extrabold mt-2 text-danger">
              {toPersianDigits((summary.currentDistribution.CHURN_RISK ?? 0) + (summary.currentDistribution.CHURNED ?? 0))}
            </div>
          </button>
        </div>
      ) : null}

      {kpis && kpis.salespeople.length > 0 ? (
        <Card className="p-5 mt-6">
          <h2 className="text-[14px] font-extrabold mb-4">عملکرد کارشناسان فروش</h2>
          <div className="flex flex-col gap-2">
            {kpis.salespeople.map((sp) => (
              <div key={sp.userId} className="flex items-center justify-between border-b border-border last:border-0 py-2.5">
                <span className="text-[13px] font-bold">{sp.name}</span>
                <div className="flex items-center gap-4 text-[12px] text-muted">
                  <span>{toPersianDigits(sp.totalLeads)} سرنخ</span>
                  <span>{toPersianDigits(sp.convertedCount)} مشتری</span>
                  <Badge tone="primary">{toPersianDigits(sp.conversionRate)}٪ تبدیل</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {activeStage ? (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end sm:items-center justify-center" onClick={() => setActiveStage(null)}>
          <div
            className="bg-white w-full sm:max-w-[560px] sm:rounded-2xl rounded-t-2xl max-h-[80vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-extrabold">مخاطبین این مرحله</h3>
              <button onClick={() => setActiveStage(null)} className="cursor-pointer text-muted">
                <CloseIcon className="w-4.5 h-4.5" />
              </button>
            </div>
            {stageContacts === null ? (
              <div className="text-center text-muted text-sm py-10">در حال بارگذاری...</div>
            ) : stageContacts.length === 0 ? (
              <div className="text-center text-muted text-sm py-10">مخاطبی در این مرحله نیست</div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {stageContacts.map((c) => (
                  <div key={c.id} className="border border-border rounded-xl p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/crm?contact=${c.id}`} className="text-[13px] font-bold hover:text-primary">
                        {c.name}
                      </Link>
                      {c.isBrandAmbassador ? (
                        <Badge tone="warning">
                          <StarIcon className="w-3 h-3 inline ml-1" />
                          سفیر برند
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-[11.5px] text-muted mt-1 flex items-center gap-3 flex-wrap">
                      {c.company ? <span>{c.company}</span> : null}
                      {c.phone ? <span dir="ltr">{c.phone}</span> : null}
                      {c.owner ? <span>مسئول: {c.owner.name}</span> : null}
                      {c.source ? <span>منبع: {c.source}</span> : null}
                    </div>
                    {c.purchaseCount > 0 ? (
                      <div className="text-[11.5px] text-ink-soft mt-1.5">
                        {toPersianDigits(c.purchaseCount)} خرید
                        {c.lastPurchaseAt ? ` — آخرین خرید: ${formatJalaliDate(new Date(c.lastPurchaseAt))}` : ""}
                        {c.avgPurchaseGapDays ? ` — میانگین فاصله: ${toPersianDigits(c.avgPurchaseGapDays)} روز` : ""}
                      </div>
                    ) : null}
                    {MANUAL_STAGES.some((m) => m.stage === c.funnelStage) ? (
                      <div className="flex items-center gap-1.5 mt-2.5">
                        {MANUAL_STAGES.map((m) => (
                          <button
                            key={m.stage}
                            onClick={() => moveStage(c.id, m.stage)}
                            disabled={m.stage === c.funnelStage}
                            className={clsx(
                              "text-[11px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer disabled:cursor-default",
                              m.stage === c.funnelStage ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
                            )}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
