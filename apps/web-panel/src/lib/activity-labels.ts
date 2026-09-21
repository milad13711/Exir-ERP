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

const VERB_LABELS: Record<string, string> = {
  created: "ایجاد کرد",
  updated: "ویرایش کرد",
  deleted: "حذف کرد",
  approved: "تأیید کرد",
  rejected: "رد کرد",
  confirmed: "تأیید نهایی کرد",
  cancelled: "لغو/ابطال کرد",
  voided: "ابطال کرد",
  posted: "ثبت قطعی کرد",
  decided: "تصمیم‌گیری کرد",
  signed: "امضا کرد",
  received: "دریافت ثبت کرد",
  completed: "تکمیل کرد",
  hired: "جذب نهایی کرد",
};

/** لاگ خودکار (module.entity.verb) که ماژول‌ها برچسب اختصاصی ندارند. */
function genericLabel(action: string, userName: string | null): string | null {
  const parts = action.split(".");
  const verb = parts[parts.length - 1];
  if (parts.length < 3 || !VERB_LABELS[verb]) return null;
  const module = MODULE_LABELS_FA[parts[0]] ?? parts[0];
  return `${userName ?? "یک کاربر"} در بخش «${module}» یک رکورد (${parts.slice(1, -1).join(" / ")}) را ${VERB_LABELS[verb]}.`;
}

export function formatActivityAction(action: string, userName: string | null): string {
  return (ACTIVITY_LABELS[action] ?? (() => genericLabel(action, userName) ?? action))(userName);
}
