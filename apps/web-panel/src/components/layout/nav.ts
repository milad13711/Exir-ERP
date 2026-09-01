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
} from "@/components/icons";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const primaryNav: NavItem[] = [
  { href: "/dashboard", label: "داشبورد", icon: DashboardIcon },
  { href: "/crm", label: "مشتریان (CRM)", icon: CrmIcon },
  { href: "/sales", label: "فروش و فاکتور", icon: ReceiptIcon },
  { href: "/purchasing", label: "خرید و تأمین‌کننده", icon: OrdersIcon },
  { href: "/warehouse", label: "انبار و کالا", icon: WarehouseIcon },
  { href: "/accounting", label: "حسابداری", icon: AccountingIcon },
  { href: "/checks", label: "چک‌ها", icon: BillingIcon },
  { href: "/hr", label: "منابع انسانی", icon: HrIcon },
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
