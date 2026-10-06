import type { TaxInvoiceStatus, TaxInvoiceSubject } from "@/lib/api";

export const TAX_STATUS_LABELS: Record<TaxInvoiceStatus, string> = {
  DRAFT: "پیش‌نویس",
  PENDING_APPROVAL: "در انتظار تأیید مدیر",
  APPROVED: "تأییدشده (در صف)",
  QUEUED: "در حال ارسال",
  SENT: "ارسال‌شده — در انتظار نتیجه",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "ردشده",
  FAILED: "ناموفق (فنی)",
  CANCELLED: "لغوشده",
};

export const TAX_STATUS_TONES: Record<TaxInvoiceStatus, "neutral" | "primary" | "accent" | "success" | "danger" | "warning"> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "primary",
  QUEUED: "primary",
  SENT: "accent",
  ACCEPTED: "success",
  REJECTED: "danger",
  FAILED: "danger",
  CANCELLED: "neutral",
};

export const TAX_STATUSES = Object.keys(TAX_STATUS_LABELS) as TaxInvoiceStatus[];

export const TAX_SUBJECT_LABELS: Record<TaxInvoiceSubject, string> = {
  ORIGINAL: "اصلی",
  CORRECTION: "اصلاحی",
  CANCELLATION: "ابطالی",
  RETURN: "برگشت از فروش",
};

export const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors disabled:opacity-60";
export const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

/** فیلدهای جدول ۷ مودیان که در پیش‌نمایش با نام فارسی نشان داده می‌شوند. */
export const HEADER_LABELS: Record<string, string> = {
  taxid: "شماره منحصر به فرد مالیاتی",
  inno: "سریال",
  inty: "نوع صورتحساب",
  inp: "الگو",
  ins: "موضوع",
  tins: "شماره اقتصادی فروشنده",
  tob: "نوع شخص خریدار",
  bid: "شناسه/کد ملی خریدار",
  tinb: "شماره اقتصادی خریدار",
  bpc: "کد پستی خریدار",
  tprdis: "جمع قبل از تخفیف (ریال)",
  tdis: "جمع تخفیف (ریال)",
  tadis: "جمع بعد از تخفیف (ریال)",
  tvam: "جمع ارزش افزوده (ریال)",
  tbill: "جمع صورتحساب (ریال)",
  setm: "روش تسویه",
  cap: "پرداخت نقدی (ریال)",
  insp: "پرداخت نسیه (ریال)",
  tvop: "سهم ارزش افزوده از پرداخت (ریال)",
  irtaxid: "شماره مالیاتی مرجع",
};
