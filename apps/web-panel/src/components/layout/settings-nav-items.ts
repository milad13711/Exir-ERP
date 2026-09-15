import type { ComponentType, SVGProps } from "react";
import {
  CalendarIcon,
  HrIcon,
  BillingIcon,
  StoreIcon,
  DocsIcon,
  BellIcon,
  LogIcon,
  CurrencyIcon,
  PhoneIcon,
  BotIcon,
  BoltIcon,
  UserCircleIcon,
} from "@/components/icons";

export type SettingsNavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  moduleCode?: string;
};

export const settingsNav: SettingsNavItem[] = [
  { href: "/settings/profile", label: "پروفایل من", icon: UserCircleIcon },
  { href: "/settings/general", label: "عمومی و برندینگ", icon: CalendarIcon },
  { href: "/settings/users", label: "کاربران و نقش‌ها", icon: HrIcon },
  { href: "/settings/billing", label: "اشتراک و صورتحساب", icon: BillingIcon },
  { href: "/settings/modules", label: "ماژول‌های نصب‌شده", icon: StoreIcon },
  { href: "/settings/currencies", label: "ارزها و نرخ تبدیل", icon: CurrencyIcon, moduleCode: "currency-exchange" },
  { href: "/settings/voip", label: "اتصال تلفن (VoIP)", icon: PhoneIcon, moduleCode: "voip" },
  { href: "/settings/api", label: "API، وب‌هوک و MCP", icon: DocsIcon, moduleCode: "api-access" },
  { href: "/settings/ai-assistant", label: "دستیار هوشمند (MCP)", icon: BotIcon, moduleCode: "mcp" },
  { href: "/settings/offline-sync", label: "همگام‌سازی آفلاین", icon: BoltIcon, moduleCode: "offline-sync" },
  { href: "/settings/notifications", label: "اعلان‌ها", icon: BellIcon },
  { href: "/settings/logs", label: "لاگ فعالیت‌ها و خطاها", icon: LogIcon },
];
