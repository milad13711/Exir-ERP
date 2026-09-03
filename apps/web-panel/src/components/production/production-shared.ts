import type { ProductionOrderStatus } from "@/lib/api";

export const ORDER_STATUS_LABELS: Record<ProductionOrderStatus, string> = {
  DRAFT: "پیش‌نویس",
  RAW_MATERIAL_APPROVED: "مواد اولیه تأییدشده",
  IN_PROGRESS: "در حال تولید",
  QC_PENDING: "منتظر کنترل کیفیت",
  COMPLETED: "تکمیل‌شده",
  REJECTED: "ردشده",
  CANCELLED: "لغوشده",
};

export const ORDER_STATUS_TONES: Record<ProductionOrderStatus, "success" | "warning" | "danger" | "neutral" | "primary"> = {
  DRAFT: "neutral",
  RAW_MATERIAL_APPROVED: "primary",
  IN_PROGRESS: "warning",
  QC_PENDING: "warning",
  COMPLETED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

export const STAGE_STATUS_LABELS: Record<"PENDING" | "IN_PROGRESS" | "DONE", string> = {
  PENDING: "شروع‌نشده",
  IN_PROGRESS: "در حال انجام",
  DONE: "انجام‌شده",
};
