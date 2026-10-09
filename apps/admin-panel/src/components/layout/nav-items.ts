import type { ComponentType, SVGProps } from "react";
import { BuildingIcon, PackageIcon, ChatIcon, CheckIcon, TargetIcon, ReceiptIcon, UsersIcon, KeyIcon, LogIcon, ShieldIcon } from "@/components/icons";

export type NavItem = { href: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; superOnly?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { href: "/tenants", label: "تننت‌ها", icon: BuildingIcon },
  { href: "/support", label: "پشتیبانی", icon: ChatIcon },
  { href: "/tasks", label: "وظایف", icon: CheckIcon },
  { href: "/leads", label: "فروش", icon: TargetIcon },
  { href: "/catalog", label: "کاتالوگ", icon: PackageIcon },
  { href: "/reseller-applications", label: "درخواست نمایندگی", icon: ReceiptIcon },
  { href: "/resellers", label: "همکاران", icon: UsersIcon },
  { href: "/sms-packages", label: "بسته‌های پیامک", icon: PackageIcon },
  { href: "/licenses", label: "لایسنس‌ها", icon: KeyIcon },
  { href: "/logs", label: "لاگ‌ها", icon: LogIcon },
  { href: "/security", label: "امنیت", icon: ShieldIcon },
  { href: "/team", label: "کاربران پلتفرم", icon: UsersIcon, superOnly: true },
  { href: "/backups", label: "بکاپ و بازیابی", icon: ShieldIcon },
  { href: "/monitoring", label: "پایش و هشدار", icon: ShieldIcon },
];

/** چهار مورد پرکاربرد که در نوار پایین موبایل می‌مانند؛ بقیه پشت «بیشتر». */
export const PRIMARY_NAV_HREFS = ["/tenants", "/support", "/tasks", "/leads"];
