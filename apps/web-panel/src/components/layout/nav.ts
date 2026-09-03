import type { ComponentType, SVGProps } from "react";
import {
  DashboardIcon,
  CrmIcon,
  ReceiptIcon,
  OrdersIcon,
  WarehouseIcon,
  AccountingIcon,
  HrIcon,
  TasksIcon,
  StoreIcon,
  SettingsIcon,
  BillingIcon,
  FactoryIcon,
  FlaskIcon,
} from "@/components/icons";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Module code gating this page — omitted for pages with no module (or core, always-on) requirement. */
  moduleCode?: string;
};

export const primaryNav: NavItem[] = [
  { href: "/dashboard", label: "داشبورد", icon: DashboardIcon },
  { href: "/crm", label: "مشتریان (CRM)", icon: CrmIcon, moduleCode: "crm" },
  { href: "/sales", label: "فروش و فاکتور", icon: ReceiptIcon, moduleCode: "sales" },
  { href: "/purchasing", label: "خرید و تأمین‌کننده", icon: OrdersIcon, moduleCode: "purchasing" },
  { href: "/warehouse", label: "انبار و کالا", icon: WarehouseIcon, moduleCode: "warehouse" },
  { href: "/production", label: "تولید", icon: FactoryIcon, moduleCode: "production" },
  { href: "/quality-control", label: "کنترل کیفیت", icon: FlaskIcon, moduleCode: "quality-control" },
  { href: "/accounting", label: "حسابداری", icon: AccountingIcon, moduleCode: "accounting" },
  { href: "/checks", label: "چک‌ها", icon: BillingIcon, moduleCode: "checks" },
  { href: "/hr", label: "منابع انسانی", icon: HrIcon, moduleCode: "hr" },
  { href: "/tasks", label: "وظایف و یادآوری", icon: TasksIcon },
];

export const secondaryNav: NavItem[] = [
  { href: "/modules", label: "فروشگاه ماژول", icon: StoreIcon },
  { href: "/settings", label: "تنظیمات", icon: SettingsIcon },
];

export const mobileNav: NavItem[] = [
  { href: "/dashboard", label: "داشبورد", icon: DashboardIcon },
  { href: "/tasks", label: "وظایف", icon: TasksIcon },
  { href: "/modules", label: "فروشگاه", icon: StoreIcon },
  { href: "/settings", label: "تنظیمات", icon: SettingsIcon },
];
