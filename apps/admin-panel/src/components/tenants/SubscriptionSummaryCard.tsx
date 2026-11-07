"use client";

import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import type { SubscriptionState, TenantSubscriptionSummary } from "@/lib/api";

const LABEL: Record<SubscriptionState, string> = {
  ACTIVE: "فعال",
  TRIAL: "آزمایشی",
  EXPIRING_SOON: "در آستانه‌ی انقضا",
  GRACE: "مهلت تمدید",
  EXPIRED: "منقضی‌شده",
  SUSPENDED: "تعلیق‌شده",
  NOT_SUBSCRIBED: "فعال نشده",
  NO_EXPIRY: "بدون انقضا",
};
const TONE: Record<SubscriptionState, "success" | "warning" | "danger" | "neutral" | "accent"> = {
  ACTIVE: "success",
  TRIAL: "warning",
  EXPIRING_SOON: "warning",
  GRACE: "danger",
  EXPIRED: "danger",
  SUSPENDED: "danger",
  NOT_SUBSCRIBED: "neutral",
  NO_EXPIRY: "accent",
};
const ACTION: Record<string, string> = {
  PAY_INVOICE: "فاکتور باز منتظر پرداخت مشتری است",
  REQUEST_INVOICE: "فاکتوری صادر نشده — مشتری می‌تواند درخواست دهد یا از «صدور فاکتور» بسازید",
  CONTACT_SUPPORT: "نیازمند اقدام پشتیبانی",
};
const BILLING: Record<string, string> = { MONTHLY: "ماهانه", YEARLY: "سالانه", LICENSE: "لایسنس مادام‌العمر" };

function when(e: { state: SubscriptionState; expiresAt: string | null; daysLeft: number | null; daysOverdue: number | null }): string {
  if (e.state === "NO_EXPIRY") return "بدون تاریخ انقضا";
  if (!e.expiresAt) return "—";
  const date = formatJalaliDate(e.expiresAt);
  if (e.daysLeft !== null) return `${date} — ${e.daysLeft === 0 ? "امروز" : `${toPersianDigits(e.daysLeft)} روز مانده`}`;
  if (e.daysOverdue !== null && (e.state === "GRACE" || e.state === "EXPIRED")) return `${date} — ${e.daysOverdue === 0 ? "امروز تمام شد" : `${toPersianDigits(e.daysOverdue)} روز گذشته`}`;
  return date;
}

/** نمای ادمین از همان خلاصه‌ی اشتراکی که خود مشتری در هدر/تنظیمات می‌بیند. */
export function SubscriptionSummaryCard({ summary }: { summary: TenantSubscriptionSummary | null }) {
  if (!summary) return <Card className="mt-5 p-4 text-[12px] text-muted">در حال بارگذاری وضعیت اشتراک...</Card>;
  const t = summary.tenant;
  const tracked = summary.modules.filter((m) => !(m.isCore && m.state === "NO_EXPIRY") && m.state !== "NOT_SUBSCRIBED");
  return (
    <Card className="mt-5 p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Badge tone="primary">{t.source === "ON_PREMISE_LICENSE" ? "لایسنس اختصاصی" : (t.planName ?? "بدون پلن")}</Badge>
          <Badge tone={TONE[t.state]}>{LABEL[t.state]}</Badge>
          {t.lifetime ? <Badge tone="accent">مادام‌العمر</Badge> : null}
          {t.billingOnly ? <Badge tone="danger">فقط صفحه‌ی صورتحساب باز است</Badge> : null}
        </div>
        <span className="text-[12px] text-muted">{when(t)}</span>
      </div>
      {ACTION[t.nextAction] || t.awaitingApproval ? (
        <div className="text-[12px] text-ink-soft mt-2">{t.awaitingApproval ? "فاکتور تمدید در کارتابل تأیید مدیر پلتفرم است" : ACTION[t.nextAction]}</div>
      ) : null}
      {t.staleRecord ? <div className="text-[12px] text-warning mt-2">رکورد اشتراک با پرداخت‌های ثبت‌شده هم‌خوان نیست (تاریخ پایان قدیمی) — با «تنظیم دستی اشتراک» یا «تمدید» اصلاح کنید.</div> : null}

      {tracked.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3 flex flex-col gap-2">
          {tracked.map((m) => (
            <div key={m.code} className="flex items-center justify-between flex-wrap gap-2 text-[12px]">
              <span className="flex items-center gap-2">
                <span className="font-semibold">{m.name}</span>
                <Badge tone={TONE[m.state]}>{LABEL[m.state]}</Badge>
                {m.billingMode ? <span className="text-muted">{BILLING[m.billingMode]}</span> : null}
                {m.reason === "granted_without_expiry" ? <span className="text-muted">فعال‌شده دستی</span> : null}
              </span>
              <span className="text-muted">{when(m)}{m.openInvoice ? " — فاکتور باز" : m.awaitingApproval ? " — فاکتور در انتظار تأیید" : ""}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
