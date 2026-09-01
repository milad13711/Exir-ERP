import type { Tone } from "@/components/ui/Badge";
import type { AccountType, JournalEntryStatus } from "@/lib/api";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "دارایی",
  LIABILITY: "بدهی",
  EQUITY: "حقوق صاحبان سهام",
  REVENUE: "درآمد",
  EXPENSE: "هزینه",
};

export const ACCOUNT_TYPE_TONES: Record<AccountType, Tone> = {
  ASSET: "primary",
  LIABILITY: "warning",
  EQUITY: "neutral",
  REVENUE: "success",
  EXPENSE: "danger",
};

export const ENTRY_STATUS_LABELS: Record<JournalEntryStatus, string> = {
  DRAFT: "پیش‌نویس",
  POSTED: "ثبت قطعی",
};

export const ENTRY_STATUS_TONES: Record<JournalEntryStatus, Tone> = {
  DRAFT: "warning",
  POSTED: "success",
};
