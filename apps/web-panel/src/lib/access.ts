import { PERMISSION_GATED_MODULE_CODES, type Me } from "./api";

const MANAGER_ONLY_SETTINGS_EXCEPTIONS = new Set(["/settings/profile", "/settings/notifications"]);

export function isManager(me: Me | null): boolean {
  return me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";
}

/** کاربر می‌تواند این ماژول را در منو ببیند؟ مدیران همه‌چیز؛ ماژول‌های دارای ماتریس دسترسی، فقط با مجوز مشاهده. */
export function canViewModule(me: Me | null, installed: Set<string>, moduleCode?: string): boolean {
  if (!moduleCode) return true;
  if (!installed.has(moduleCode)) return false;
  if (!me || isManager(me)) return true;
  const viewable = (code: string) => !!me.permissions?.modules[code] && (me.permissions.modules[code].canViewAll || me.permissions.modules[code].canViewOwn);
  // چک‌ها زیرمجموعه‌ی فروش/خرید است (همان قاعده‌ی سرور)
  if (moduleCode === "checks") return viewable("sales") || viewable("purchasing");
  if (!(PERMISSION_GATED_MODULE_CODES as readonly string[]).includes(moduleCode)) return true;
  const m = me.permissions?.modules[moduleCode];
  return !!m && (m.canViewAll || m.canViewOwn);
}

/** بخش‌های تنظیمات به‌جز پروفایل و اعلان‌ها فقط برای مدیران است. */
export function canViewSettingsItem(me: Me | null, href: string): boolean {
  return isManager(me) || MANAGER_ONLY_SETTINGS_EXCEPTIONS.has(href);
}
