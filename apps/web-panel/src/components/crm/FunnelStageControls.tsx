"use client";

import { useState } from "react";
import clsx from "clsx";
import { Badge, type Tone } from "@/components/ui/Badge";
import { ApiError, convertContactToCustomer, updateFunnelStage, type CrmFunnelStage } from "@/lib/api";

export const FUNNEL_STAGE_META: Record<CrmFunnelStage, { label: string; tone: Tone }> = {
  NEW_LEAD: { label: "سرنخ جدید", tone: "neutral" },
  CONTACTED: { label: "در تماس", tone: "primary" },
  QUALIFIED: { label: "واجد شرایط", tone: "accent" },
  CUSTOMER: { label: "مشتری", tone: "success" },
  REPEAT_CUSTOMER: { label: "خرید تکراری", tone: "success" },
  BRAND_AMBASSADOR: { label: "سفیر برند", tone: "warning" },
  CHURN_RISK: { label: "در معرض ریزش", tone: "danger" },
  CHURNED: { label: "غیرفعال", tone: "danger" },
  DISQUALIFIED: { label: "رد صلاحیت", tone: "neutral" },
};

/** مشتری شده؟ (هم‌خوان با isConverted بک‌اند) */
export function isConvertedContact(c: { funnelStage?: CrmFunnelStage; purchaseCount?: number; convertedAt?: string | null }): boolean {
  const stage = c.funnelStage ?? "NEW_LEAD";
  return (c.purchaseCount ?? 0) >= 1 || !!c.convertedAt || ["CUSTOMER", "REPEAT_CUSTOMER", "BRAND_AMBASSADOR", "CHURN_RISK", "CHURNED"].includes(stage);
}

export function FunnelStageBadge({ stage }: { stage?: CrmFunnelStage }) {
  const meta = FUNNEL_STAGE_META[stage ?? "NEW_LEAD"];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

type ManualStage = "NEW_LEAD" | "CONTACTED" | "QUALIFIED";
const MANUAL: ManualStage[] = ["NEW_LEAD", "CONTACTED", "QUALIFIED"];

/**
 * کنترل‌های چرخه‌ی عمر سرنخ: تغییر مرحله، رد صلاحیت (با دلیل) و «تبدیل به مشتری».
 * برای مشتریان فقط توضیح می‌دهد که مرحله خودکار مدیریت می‌شود.
 */
export function FunnelStageControls({
  contactId,
  stage,
  purchaseCount,
  convertedAt,
  disqualifyReason,
  labels,
  onChanged,
}: {
  contactId: string;
  stage?: CrmFunnelStage;
  purchaseCount?: number;
  convertedAt?: string | null;
  disqualifyReason?: string | null;
  labels?: Record<string, string> | null;
  onChanged: () => void;
}) {
  const current = stage ?? "NEW_LEAD";
  const converted = isConvertedContact({ funnelStage: current, purchaseCount, convertedAt });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAskReason(false);
      setReason("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  if (converted) {
    return (
      <div className="text-[11.5px] text-muted mt-2">
        این مخاطب مشتری است؛ مرحله‌ی او (مشتری، خرید تکراری، سفیر برند، ریسک ریزش) با خریدها و رویدادهای واقعی خودکار مدیریت می‌شود.
      </div>
    );
  }

  return (
    <div className="mt-2.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        {current === "DISQUALIFIED" ? (
          <>
            <Badge tone="neutral">رد صلاحیت{disqualifyReason ? `: ${disqualifyReason}` : ""}</Badge>
            <button
              disabled={busy}
              onClick={() => run(() => updateFunnelStage(contactId, "NEW_LEAD"))}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-100 text-ink-soft cursor-pointer disabled:opacity-50"
            >
              بازگشایی به‌عنوان سرنخ
            </button>
          </>
        ) : (
          <>
            {MANUAL.map((s) => (
              <button
                key={s}
                disabled={busy || s === current}
                onClick={() => run(() => updateFunnelStage(contactId, s))}
                className={clsx(
                  "text-[11px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer disabled:cursor-default",
                  s === current ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
                )}
              >
                {labels?.[s] ?? FUNNEL_STAGE_META[s].label}
              </button>
            ))}
            <button
              disabled={busy}
              onClick={() => setAskReason((v) => !v)}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-100 text-danger cursor-pointer disabled:opacity-50"
            >
              رد صلاحیت
            </button>
          </>
        )}
        <button
          disabled={busy}
          onClick={() => run(() => convertContactToCustomer(contactId))}
          className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-success text-white cursor-pointer disabled:opacity-50 mr-auto"
        >
          تبدیل به مشتری
        </button>
      </div>
      {askReason ? (
        <div className="flex items-center gap-1.5 mt-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="دلیل رد صلاحیت (الزامی)"
            className="flex-1 border border-border rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-primary"
          />
          <button
            disabled={busy || !reason.trim()}
            onClick={() => run(() => updateFunnelStage(contactId, "DISQUALIFIED", reason.trim()))}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-danger text-white cursor-pointer disabled:opacity-50"
          >
            ثبت
          </button>
        </div>
      ) : null}
      <div className="text-[11px] text-muted mt-1.5">
        «واجد شرایط» هنوز سرنخ است؛ با اولین خرید پرداخت‌شده، برد یک فرصت فروش یا دکمه‌ی «تبدیل به مشتری» به مشتری تبدیل می‌شود.
      </div>
      {error ? <div className="text-[11.5px] text-danger mt-1">{error}</div> : null}
    </div>
  );
}
