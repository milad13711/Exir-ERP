import type { ProposalStatus } from "@/lib/api";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: "پیش‌نویس",
  SENT: "ارسال‌شده",
  VIEWED: "مشاهده‌شده",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "ردشده",
  REVISION_REQUESTED: "نیاز به اصلاحات",
  EXPIRED: "منقضی",
};

export const PROPOSAL_STATUS_TONES: Record<ProposalStatus, "neutral" | "primary" | "accent" | "success" | "danger" | "warning"> = {
  DRAFT: "neutral",
  SENT: "primary",
  VIEWED: "accent",
  ACCEPTED: "success",
  REJECTED: "danger",
  REVISION_REQUESTED: "warning",
  EXPIRED: "neutral",
};

export const PROPOSAL_STATUSES = Object.keys(PROPOSAL_STATUS_LABELS) as ProposalStatus[];

export const EVENT_LABELS: Record<string, string> = {
  CREATED: "ایجاد",
  UPDATED: "ویرایش",
  SENT: "ارسال",
  SMS_SENT: "ارسال پیامک",
  LINK_SHARED: "اشتراک لینک",
  VIEWED_FIRST: "اولین مشاهده",
  ACCEPTED: "پذیرش",
  REJECTED: "رد",
  REVISION_REQUESTED: "درخواست اصلاح",
  COMMENT: "نظر مشتری",
  STATUS_CHANGED: "تغییر وضعیت",
  ASSIGNED: "ارجاع",
  INVOICED: "صدور فاکتور",
  EXPIRED: "انقضا",
};

export const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
export const labelClass = "text-[11.5px] font-semibold text-ink-soft";
