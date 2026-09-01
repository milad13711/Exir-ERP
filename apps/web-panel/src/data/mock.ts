export const currentUser = {
  name: "سارا محمدی",
  role: "مدیر فروش",
  initials: "س‌م",
};

export const subscription = {
  planName: "پلن حرفه‌ای",
  daysLeft: 23,
};

export const kpis = [
  {
    key: "sales",
    label: "فروش امروز",
    value: 42850000,
    unit: "تومان",
    delta: "۱۲٪",
    trend: "up" as const,
    tone: "success" as const,
  },
  {
    key: "orders",
    label: "سفارش‌های جدید",
    value: 128,
    delta: "۸٪",
    trend: "up" as const,
    tone: "primary" as const,
  },
  {
    key: "lowstock",
    label: "کالاهای رو به اتمام",
    value: 14,
    unitSuffix: "قلم",
    note: "نیاز به تأمین مجدد",
    tone: "warning" as const,
  },
  {
    key: "tasks",
    label: "وظایف امروز",
    value: 7,
    valueSuffix: " از ۱۱",
    note: "۴ وظیفه باقی‌مانده",
    tone: "accent" as const,
  },
];

export const salesChart = [
  { label: "فروردین", value: 96 },
  { label: "اردیبهشت", value: 120 },
  { label: "خرداد", value: 78 },
  { label: "تیر", value: 142 },
  { label: "مرداد", value: 110 },
  { label: "شهریور", value: 180 },
];

export type Task = {
  id: string;
  title: string;
  time: string;
  priority?: "urgent" | "medium";
  done?: boolean;
};

export const tasks: Task[] = [
  { id: "t1", title: "پیگیری فاکتور شرکت آریا صنعت", time: "امروز، ساعت ۱۶:۰۰", priority: "urgent" },
  { id: "t2", title: "تأیید سفارش خرید مواد اولیه", time: "امروز، ساعت ۱۸:۳۰", priority: "medium" },
  { id: "t3", title: "ارسال گزارش هفتگی به مدیریت", time: "دیروز، ساعت ۱۷:۰۰", done: true },
  { id: "t4", title: "جلسه‌ی هفتگی تیم فروش", time: "فردا، ساعت ۰۹:۰۰" },
];

export const activities = [
  { id: "a1", text: "فاکتور شماره ۱۰۴۵۲ برای «شرکت پارس تجهیز» صادر شد.", time: "۱۰ دقیقه پیش", tone: "success" as const },
  { id: "a2", text: "مشتری جدید «آرمان کیمیا» توسط رضا احمدی ثبت شد.", time: "۴۵ دقیقه پیش", tone: "primary" as const },
  { id: "a3", text: "موجودی «کاغذ A4 - بسته ۵۰۰ برگ» به زیر حد سفارش رسید.", time: "۲ ساعت پیش", tone: "warning" as const },
];

export type ModuleItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: "crm" | "warehouse" | "accounting" | "hr" | "chart" | "store";
  status: "installed" | "popular" | "available";
  price?: number;
};

export const modules: ModuleItem[] = [
  {
    id: "crm",
    name: "مدیریت ارتباط با مشتری",
    description: "پیگیری سرنخ‌ها، مخاطبین و فرصت‌های فروش در یک قیف یکپارچه.",
    category: "فروش و مشتری",
    icon: "crm",
    status: "installed",
  },
  {
    id: "warehouse",
    name: "انبارداری و موجودی",
    description: "کنترل موجودی، رسید و حواله، و هشدار کمبود کالا.",
    category: "انبار",
    icon: "warehouse",
    status: "installed",
  },
  {
    id: "accounting",
    name: "حسابداری مالی",
    description: "اسناد حسابداری، دفتر کل، خزانه‌داری و گزارش‌های مالیاتی.",
    category: "مالی",
    icon: "accounting",
    status: "popular",
    price: 490000,
  },
  {
    id: "hr",
    name: "منابع انسانی و حقوق",
    description: "پرونده پرسنلی، حضور و غیاب، مرخصی و فیش حقوقی.",
    category: "منابع انسانی",
    icon: "hr",
    status: "available",
    price: 390000,
  },
  {
    id: "reports",
    name: "گزارش‌ساز هوشمند",
    description: "ساخت داشبورد و گزارش سفارشی از داده‌های همه‌ی ماژول‌ها.",
    category: "گزارش‌گیری",
    icon: "chart",
    status: "available",
    price: 290000,
  },
  {
    id: "store",
    name: "فروشگاه آنلاین",
    description: "اتصال به فروشگاه اینترنتی و همگام‌سازی سفارش و موجودی.",
    category: "فروش و مشتری",
    icon: "store",
    status: "available",
    price: 590000,
  },
];

export type TeamUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleTone: "primary" | "accent" | "warning" | "neutral";
  access: string;
  status: "active" | "pending";
  initials: string;
};

export const teamUsers: TeamUser[] = [
  { id: "u1", name: "سارا محمدی", email: "sara.mohammadi@exir.co", role: "مدیر سیستم", roleTone: "primary", access: "دسترسی کامل", status: "active", initials: "س‌م" },
  { id: "u2", name: "رضا احمدی", email: "reza.ahmadi@exir.co", role: "کارشناس فروش", roleTone: "accent", access: "CRM، وظایف", status: "active", initials: "ر‌ا" },
  { id: "u3", name: "مریم کریمی", email: "maryam.karimi@exir.co", role: "حسابدار", roleTone: "warning", access: "حسابداری، انبار", status: "active", initials: "م‌ک" },
  { id: "u4", name: "حسین نجفی", email: "hossein.najafi@exir.co", role: "انباردار", roleTone: "neutral", access: "انبار و کالا", status: "pending", initials: "ح‌ن" },
];

export const supportMessages = [
  { id: "m1", from: "agent" as const, text: "سلام، وقت بخیر. چطور می‌تونم کمکتون کنم؟", time: "۱۰:۰۲" },
  { id: "m2", from: "user" as const, text: "سلام، هنگام صدور فاکتور فروش، مبلغ مالیات به‌درستی محاسبه نمی‌شه.", time: "۱۰:۰۴" },
  { id: "m3", from: "agent" as const, text: "متوجه شدم. این مورد رو به‌صورت وظیفه برای واحد فنی ثبت می‌کنم و به‌محض بررسی نتیجه رو همینجا اطلاع می‌دم.", time: "۱۰:۰۶" },
  { id: "m4", from: "system" as const, text: "تیکت #۱۴۲۲ ثبت و به علیرضا کاظمی ارجاع داده شد" },
  { id: "m5", from: "agent" as const, text: "مشکل شناسایی و رفع شد. لطفاً یک فاکتور آزمایشی صادر کنید و نتیجه رو اینجا بگید.", time: "۱۱:۴۵" },
];

export const supportTicket = {
  code: "۱۴۲۲",
  team: "واحد فنی",
  status: "در حال بررسی",
  assignee: "علیرضا کاظمی",
};
