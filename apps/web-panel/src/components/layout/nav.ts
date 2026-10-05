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
  ShareIcon,
  PhoneIcon,
  StarIcon,
  KeyIcon,
  ProposalIcon,
} from "@/components/icons";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Module code gating this page — omitted for pages with no module (or core, always-on) requirement. */
  moduleCode?: string;
  /** همان دسته‌بندی کاتالوگ ماژول‌ها (control/seed.ts) — فقط برای چیدمان پیش‌فرض کنار-هم؛ داده‌ی رسمی نیست. */
  category: string;
};

// ترتیب این آرایه، چیدمان پیش‌فرض سایدبار است — از قبل بر اساس category
// کنار هم چیده شده (نه فقط متادیتای category روی هر آیتم)، تا کاربری که
// هنوز چیدمان دستی ذخیره نکرده همین گروه‌بندی طبیعی را ببیند.
export const primaryNav: NavItem[] = [
  { href: "/dashboard", label: "داشبورد", icon: DashboardIcon, category: "عمومی" },

  // فروش و مشتری
  { href: "/crm", label: "مشتریان (CRM)", icon: CrmIcon, moduleCode: "crm", category: "فروش و مشتری" },
  { href: "/crm/funnel", label: "قیف فروش", icon: FunnelIcon, moduleCode: "crm", category: "فروش و مشتری" },
  { href: "/sales", label: "فروش و فاکتور", icon: ReceiptIcon, moduleCode: "sales", category: "فروش و مشتری" },
  { href: "/booking", label: "رزرو نوبت", icon: CalendarIcon, moduleCode: "booking", category: "فروش و مشتری" },
  { href: "/contracts", label: "مدیریت قرارداد", icon: DocsIcon, moduleCode: "contracts", category: "فروش و مشتری" },
  { href: "/proposals", label: "پروپوزال", icon: ProposalIcon, moduleCode: "proposals", category: "فروش و مشتری" },
  { href: "/mentoring", label: "منتورینگ و مشاوره", icon: CompassIcon, moduleCode: "mentoring", category: "فروش و مشتری" },
  { href: "/events", label: "رویداد و بلیط‌فروشی", icon: TicketIcon, moduleCode: "events", category: "فروش و مشتری" },
  { href: "/forms", label: "فرم‌ساز", icon: ClipboardCheckIcon, moduleCode: "forms", category: "فروش و مشتری" },
  { href: "/warranty", label: "گارانتی", icon: ShieldIcon, moduleCode: "warranty", category: "فروش و مشتری" },
  { href: "/after-sales", label: "خدمات پس از فروش", icon: HeartIcon, moduleCode: "after-sales-service", category: "فروش و مشتری" },
  { href: "/calls", label: "تاریخچه تماس‌ها", icon: PhoneIcon, moduleCode: "voip", category: "فروش و مشتری" },

  // فروش (کانال‌های عمومی)
  { href: "/marketing", label: "بازاریابی", icon: MegaphoneIcon, moduleCode: "marketing", category: "فروش" },
  { href: "/online-store", label: "فروشگاه آنلاین", icon: StoreIcon, moduleCode: "online-store", category: "فروش" },
  { href: "/book-store", label: "فروش تک‌محصولی", icon: DocsIcon, moduleCode: "book-store", category: "فروش" },
  { href: "/referral-marketing", label: "نمایندگی و رفرال", icon: ShareIcon, moduleCode: "referral-marketing", category: "فروش" },

  // خرید و تأمین
  { href: "/purchasing", label: "خرید و تأمین‌کننده", icon: OrdersIcon, moduleCode: "purchasing", category: "خرید و تأمین" },

  // انبار
  { href: "/warehouse", label: "انبار و کالا", icon: WarehouseIcon, moduleCode: "warehouse", category: "انبار" },

  // تولید
  { href: "/production", label: "تولید", icon: FactoryIcon, moduleCode: "production", category: "تولید" },
  { href: "/quality-control", label: "کنترل کیفیت", icon: FlaskIcon, moduleCode: "quality-control", category: "تولید" },
  { href: "/ration-lab", label: "آزمایشگاه جیره", icon: FlaskIcon, moduleCode: "ration-lab", category: "تولید" },

  // مالی
  { href: "/accounting", label: "حسابداری", icon: AccountingIcon, moduleCode: "accounting", category: "مالی" },
  { href: "/checks", label: "چک‌ها", icon: BillingIcon, moduleCode: "checks", category: "مالی" },

  // منابع انسانی
  { href: "/hr", label: "منابع انسانی", icon: HrIcon, moduleCode: "hr", category: "منابع انسانی" },
  { href: "/recruitment", label: "استخدام و جذب نیرو", icon: BriefcaseIcon, moduleCode: "recruitment", category: "منابع انسانی" },
  { href: "/certificates", label: "گواهی‌ها", icon: StarIcon, moduleCode: "certificates", category: "منابع انسانی" },

  // بهره‌وری
  { href: "/projects", label: "مدیریت پروژه", icon: BuildingIcon, moduleCode: "projects", category: "بهره‌وری" },
  { href: "/tasks", label: "وظایف و یادآوری", icon: TasksIcon, category: "بهره‌وری" },
  { href: "/approvals", label: "کارتابل تأیید", icon: ClipboardCheckIcon, category: "بهره‌وری" },

  // عملیات
  { href: "/fleet", label: "ناوگان حمل و نقل", icon: TruckIcon, moduleCode: "fleet", category: "عملیات" },

  // عمومی (بقیه)
  { href: "/automation", label: "اتوماسیون", icon: BoltIcon, moduleCode: "automation", category: "عمومی" },
  { href: "/qr-code", label: "کد QR", icon: QrCodeIcon, moduleCode: "qr-code", category: "عمومی" },
  { href: "/reports", label: "گزارش‌ها", icon: LogIcon, moduleCode: "reports", category: "عمومی" },
  { href: "/confidential-archive", label: "بایگانی اسناد محرمانه", icon: KeyIcon, moduleCode: "confidential-archive", category: "عمومی" },
];

export const secondaryNav: NavItem[] = [
  { href: "/modules", label: "فروشگاه ماژول", icon: StoreIcon, category: "عمومی" },
  { href: "/settings", label: "تنظیمات", icon: SettingsIcon, category: "عمومی" },
];

export const mobileNav: NavItem[] = [
  { href: "/dashboard", label: "داشبورد", icon: DashboardIcon, category: "عمومی" },
  { href: "/tasks", label: "وظایف", icon: TasksIcon, category: "بهره‌وری" },
  { href: "/modules", label: "فروشگاه", icon: StoreIcon, category: "عمومی" },
  { href: "/settings", label: "تنظیمات", icon: SettingsIcon, category: "عمومی" },
];
