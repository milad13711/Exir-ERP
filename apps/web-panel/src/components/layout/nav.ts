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
  BoltIcon,
  CalendarIcon,
  DocsIcon,
  BuildingIcon,
  TruckIcon,
  FunnelIcon,
  MegaphoneIcon,
  CompassIcon,
  TicketIcon,
  ClipboardCheckIcon,
  ShieldIcon,
  HeartIcon,
  QrCodeIcon,
  BriefcaseIcon,
  LogIcon,
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
  { href: "/crm/funnel", label: "قیف فروش", icon: FunnelIcon, moduleCode: "crm" },
  { href: "/marketing", label: "بازاریابی", icon: MegaphoneIcon, moduleCode: "marketing" },
  { href: "/sales", label: "فروش و فاکتور", icon: ReceiptIcon, moduleCode: "sales" },
  { href: "/purchasing", label: "خرید و تأمین‌کننده", icon: OrdersIcon, moduleCode: "purchasing" },
  { href: "/warehouse", label: "انبار و کالا", icon: WarehouseIcon, moduleCode: "warehouse" },
  { href: "/production", label: "تولید", icon: FactoryIcon, moduleCode: "production" },
  { href: "/quality-control", label: "کنترل کیفیت", icon: FlaskIcon, moduleCode: "quality-control" },
  { href: "/accounting", label: "حسابداری", icon: AccountingIcon, moduleCode: "accounting" },
  { href: "/checks", label: "چک‌ها", icon: BillingIcon, moduleCode: "checks" },
  { href: "/booking", label: "رزرو نوبت", icon: CalendarIcon, moduleCode: "booking" },
  { href: "/contracts", label: "مدیریت قرارداد", icon: DocsIcon, moduleCode: "contracts" },
  { href: "/projects", label: "مدیریت پروژه", icon: BuildingIcon, moduleCode: "projects" },
  { href: "/mentoring", label: "منتورینگ و مشاوره", icon: CompassIcon, moduleCode: "mentoring" },
  { href: "/events", label: "رویداد و بلیط‌فروشی", icon: TicketIcon, moduleCode: "events" },
  { href: "/forms", label: "فرم‌ساز", icon: ClipboardCheckIcon, moduleCode: "forms" },
  { href: "/warranty", label: "گارانتی", icon: ShieldIcon, moduleCode: "warranty" },
  { href: "/after-sales", label: "خدمات پس از فروش", icon: HeartIcon, moduleCode: "after-sales-service" },
  { href: "/fleet", label: "ناوگان حمل و نقل", icon: TruckIcon, moduleCode: "fleet" },
  { href: "/online-store", label: "فروشگاه آنلاین", icon: StoreIcon, moduleCode: "online-store" },
  { href: "/hr", label: "منابع انسانی", icon: HrIcon, moduleCode: "hr" },
  { href: "/recruitment", label: "استخدام و جذب نیرو", icon: BriefcaseIcon, moduleCode: "recruitment" },
  { href: "/tasks", label: "وظایف و یادآوری", icon: TasksIcon },
  { href: "/automation", label: "اتوماسیون", icon: BoltIcon, moduleCode: "automation" },
  { href: "/qr-code", label: "کد QR", icon: QrCodeIcon, moduleCode: "qr-code" },
  { href: "/reports", label: "گزارش‌ها", icon: LogIcon, moduleCode: "reports" },
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
