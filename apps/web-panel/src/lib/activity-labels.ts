export const MODULE_LABELS_FA: Record<string, string> = {
  crm: "مشتریان (CRM)",
  accounting: "حسابداری",
  warehouse: "انبار",
  hr: "منابع انسانی",
  task: "وظایف",
  user: "کاربران",
  module: "ماژول‌ها",
  settings: "تنظیمات",
};

/** action -> (userName) => Persian sentence. Falls back to the raw action string when unmapped. */
export const ACTIVITY_LABELS: Record<string, (userName: string | null) => string> = {
  "task.created": (u) => `${u ?? "یک کاربر"} یک وظیفه‌ی جدید ثبت کرد.`,
  "user.invited": (u) => `${u ?? "یک کاربر"} یک عضو جدید دعوت کرد.`,
  "crm.contact.created": (u) => `${u ?? "یک کاربر"} یک مخاطب جدید در CRM ثبت کرد.`,
  "crm.deal.created": (u) => `${u ?? "یک کاربر"} یک فرصت فروش جدید ثبت کرد.`,
  "crm.deal.stage_changed": (u) => `${u ?? "یک کاربر"} مرحله‌ی یک فرصت فروش را تغییر داد.`,
  "accounting.entry.created": (u) => `${u ?? "یک کاربر"} یک سند حسابداری (پیش‌نویس) ثبت کرد.`,
  "accounting.entry.posted": (u) => `${u ?? "یک کاربر"} یک سند حسابداری را ثبت قطعی کرد.`,
  "warehouse.movement.created": (u) => `${u ?? "یک کاربر"} یک رسید/حواله‌ی انبار ثبت کرد.`,
  "module.installed": (u) => `${u ?? "یک کاربر"} یک ماژول جدید نصب کرد.`,
  "module.uninstalled": (u) => `${u ?? "یک کاربر"} یک ماژول را حذف کرد.`,
};

export function formatActivityAction(action: string, userName: string | null): string {
  return (ACTIVITY_LABELS[action] ?? (() => action))(userName);
}
