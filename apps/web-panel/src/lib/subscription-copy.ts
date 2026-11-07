import { formatJalaliDate, toPersianDigits } from "./persian";
import type {
  ModuleSubscriptionEntitlement,
  SubscriptionBanner,
  SubscriptionEntitlement,
  SubscriptionState,
  TenantSubscriptionEntitlement,
} from "./api";

/**
 * تنها منبع «متن فارسی» وضعیت اشتراک/لایسنس. هدر، صفحه‌ی تنظیمات و بنر همه از همین‌جا می‌خوانند؛
 * منطق (چه‌چیزی منقضی است؟ چه اقدامی لازم است؟) فقط در بک‌اند محاسبه می‌شود (billing/subscription-summary.ts).
 */

export const STATE_LABEL: Record<SubscriptionState, string> = {
  ACTIVE: "فعال",
  TRIAL: "آزمایشی",
  EXPIRING_SOON: "در آستانه‌ی انقضا",
  GRACE: "مهلت تمدید",
  EXPIRED: "منقضی‌شده",
  SUSPENDED: "تعلیق‌شده",
  NOT_SUBSCRIBED: "فعال نشده",
  NO_EXPIRY: "بدون انقضا",
};

export type StateTone = "success" | "warning" | "danger" | "neutral" | "primary" | "accent";
export const STATE_TONE: Record<SubscriptionState, StateTone> = {
  ACTIVE: "success",
  TRIAL: "warning",
  EXPIRING_SOON: "warning",
  GRACE: "danger",
  EXPIRED: "danger",
  SUSPENDED: "danger",
  NOT_SUBSCRIBED: "neutral",
  NO_EXPIRY: "accent",
};

const n = (v: number) => toPersianDigits(v);

function remaining(e: SubscriptionEntitlement): string {
  if (e.daysLeft === null) return "";
  if (e.daysLeft === 0) return "امروز به پایان می‌رسد";
  return `${n(e.daysLeft)} روز تا پایان`;
}

function overdue(e: SubscriptionEntitlement): string {
  if (!e.daysOverdue) return "امروز به پایان رسید";
  return `${n(e.daysOverdue)} روز از پایان گذشته`;
}

/** جمله‌ی کوتاه وضعیت تننت (پلن/لایسنس). */
export function tenantDetail(t: TenantSubscriptionEntitlement): string {
  switch (t.state) {
    case "NO_EXPIRY":
      return t.source === "ON_PREMISE_LICENSE" ? "لایسنس دائمی" : "لایسنس مادام‌العمر";
    case "ACTIVE":
      if (t.source === "ON_PREMISE_LICENSE") return `لایسنس معتبر — ${n(t.daysLeft ?? 0)} روز تا انقضا`;
      return t.expiresAt ? `فعال تا ${formatJalaliDate(t.expiresAt)}` : "فعال";
    case "TRIAL":
      return t.hoursLeft !== null && t.hoursLeft <= 48 ? `${n(Math.max(0, t.hoursLeft))} ساعت تا پایان دوره‌ی رایگان` : `${n(t.daysLeft ?? 0)} روز تا پایان دوره‌ی رایگان`;
    case "EXPIRING_SOON":
      if (t.source === "ON_PREMISE_LICENSE") return t.reason === "license_token_renewal_due" ? `تمدید خودکار لایسنس تا ${n(t.daysLeft ?? 0)} روز دیگر لازم است — اتصال اینترنت را بررسی کنید` : `${n(t.daysLeft ?? 0)} روز تا انقضای لایسنس`;
      return remaining(t);
    case "GRACE":
      if (t.reason === "license_offline_grace") return `اتصال به سرور لایسنس برقرار نیست — ${n(t.daysLeft ?? 0)} روز مهلت`;
      if (t.reason === "license_expired_grace") return `لایسنس منقضی شده — ${n(t.daysLeft ?? 0)} روز مهلت اضافه`;
      if (t.reason === "trial_ended_pending_lock") return "دوره‌ی رایگان به پایان رسیده است";
      return `اشتراک: ${overdue(t)} — لطفاً تمدید کنید`;
    case "EXPIRED":
      if (t.reason === "payment_recorded_locked") return "پرداخت شما ثبت شده، اما فعال‌سازی هنوز اعمال نشده است";
      if (t.billingOnly) return "برای ادامه‌ی استفاده، فاکتور تمدید را پرداخت کنید";
      return t.source === "ON_PREMISE_LICENSE" ? "لایسنس نامعتبر یا منقضی است" : "اشتراک منقضی شده";
    case "SUSPENDED":
      return t.reason === "tenant_cancelled" ? "این محیط کاری لغو شده است" : "این محیط کاری تعلیق شده است";
    case "NOT_SUBSCRIBED":
      return t.billingOnly ? "فعال‌سازی پس از پرداخت فاکتور اول" : "اشتراک فعالی ثبت نشده است";
  }
}

const MODULE_REASON: Record<string, string> = {
  included: "همراه پلن شما",
  granted_without_expiry: "فعال‌شده توسط پشتیبانی — بدون تاریخ پایان",
  license_lifetime: "لایسنس مادام‌العمر",
  not_purchased: "تهیه نشده",
  demo: "نسخه‌ی آزمایشی",
  disabled_manually: "غیرفعال شده",
  disabled_manually_paid_period: "غیرفعال شده — دوره‌ی پرداخت‌شده هنوز باقی است",
};

export function moduleDetail(m: ModuleSubscriptionEntitlement): string {
  switch (m.state) {
    case "ACTIVE":
      return m.expiresAt ? `فعال تا ${formatJalaliDate(m.expiresAt)}` : "فعال";
    case "EXPIRING_SOON":
      return `${remaining(m)}${m.expiresAt ? ` (${formatJalaliDate(m.expiresAt)})` : ""}`;
    case "GRACE":
      return m.reason === "period_ended_invoice_awaiting_approval" ? "دوره به پایان رسیده — فاکتور تمدید در حال صدور است" : `دوره: ${overdue(m)} — به‌زودی غیرفعال می‌شود`;
    case "EXPIRED":
      return `منقضی شده${m.expiresAt ? ` در ${formatJalaliDate(m.expiresAt)}` : ""} — ماژول غیرفعال است`;
    default:
      return MODULE_REASON[m.reason] ?? STATE_LABEL[m.state];
  }
}

/** توضیح زیر دکمه/وضعیت فاکتور برای یک entitlement. */
export function invoiceHint(e: SubscriptionEntitlement): string | null {
  if (e.nextAction === "PAY_INVOICE" && e.openInvoice) return "فاکتور تمدید صادر شده و منتظر پرداخت است";
  if (e.awaitingApproval) return "فاکتور تمدید در حال صدور است و به‌زودی برای پرداخت اعلام می‌شود";
  if (e.nextAction === "REQUEST_INVOICE") return "هنوز فاکتور تمدید صادر نشده است";
  return null;
}

export type BannerCopy = {
  label: string;
  detail: string;
  tone: "warning" | "danger" | "primary" | "accent";
  cta: { kind: "pay"; label: string; href: string } | { kind: "request"; label: string; moduleCode: string | null } | { kind: "support"; label: string } | null;
};

/** بنر هدر. admin=false ⇒ کاربر عادی: متن خنثی و بدون دکمه. */
export function bannerCopy(b: SubscriptionBanner, tenant: TenantSubscriptionEntitlement, admin: boolean): BannerCopy {
  const tone: BannerCopy["tone"] = b.severity === "danger" ? "danger" : "warning";
  if (!admin) {
    return { label: "اشتراک سازمان", detail: b.state === "SUSPENDED" ? "این محیط کاری تعلیق شده است" : "نیاز به تمدید دارد — به مدیر سازمان اطلاع دهید", tone, cta: null };
  }
  const label =
    b.scope === "module"
      ? `ماژول ${b.moduleName ?? ""}${b.moreModules > 0 ? ` و ${n(b.moreModules)} ماژول دیگر` : ""}`
      : tenant.source === "ON_PREMISE_LICENSE"
        ? "استقرار اختصاصی"
        : b.state === "TRIAL"
          ? "استفاده رایگان"
          : (tenant.planName ?? "اشتراک");

  let detail: string;
  if (b.scope === "tenant") {
    detail = tenantDetail(tenant);
  } else if (b.state === "EXPIRING_SOON") {
    detail = b.daysLeft === 0 ? "امروز به پایان می‌رسد" : `${n(b.daysLeft ?? 0)} روز تا پایان دوره`;
  } else if (b.state === "GRACE") {
    detail = b.awaitingApproval ? "دوره به پایان رسیده — فاکتور تمدید در حال صدور است" : "دوره به پایان رسیده — تمدید کنید";
  } else {
    detail = "منقضی شده";
  }

  let cta: BannerCopy["cta"] = null;
  if (b.nextAction === "PAY_INVOICE" && b.invoiceId) cta = { kind: "pay", label: "پرداخت فاکتور", href: `/pay/${b.invoiceId}` };
  else if (b.nextAction === "REQUEST_INVOICE") cta = { kind: "request", label: "درخواست فاکتور تمدید", moduleCode: b.moduleCode };
  else if (b.nextAction === "CONTACT_SUPPORT") cta = { kind: "support", label: "تماس با پشتیبانی" };
  return { label, detail, tone, cta };
}
