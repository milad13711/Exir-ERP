/**
 * رجیستری ویجت‌های داشبورد + منطق خالص (بدون وابستگی به Nest/DB) برای فیلتر دسترسی، اعتبارسنجی چیدمان و ادغام
 * چیدمان شرکت با شخصی‌سازی کاربر. افزودن ویجت جدید: docs/dev/dashboard-widgets.md
 *
 * قاعده‌ی امنیتی: نمایش/عدم‌نمایش ویجت فقط UX است؛ هر endpoint داده‌ی ویجت باید خودش مجوز/دامنه را اعمال کند
 * (مثلاً GET /dashboard/summary فقط با «مشاهده‌ی همه»ی ماژول مربوط عدد واقعی می‌دهد).
 */
import { BadRequestException } from '@nestjs/common';

export const WIDGET_SIZES = ['S', 'M', 'L', 'FULL'] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export type WidgetPermLevel = 'any' | 'all';

export interface WidgetPerm {
  /** کافی است کاربر روی یکی از این ماژول‌ها سطح لازم را داشته باشد. */
  modules: string[];
  /** any = «مشاهده‌ی همه» یا «فقط خودم»؛ all = فقط «مشاهده‌ی همه» (برای ویجت‌هایی که جمع کل شرکت‌اند). */
  level: WidgetPermLevel;
}

export interface WidgetDef {
  key: string;
  title: string;
  description: string;
  /** کد ماژولی که باید نصب/فعال باشد؛ null = هسته (همیشه). */
  moduleCode: string | null;
  /** null = بدون ماتریس دسترسی (داده‌ی خودِ کاربر یا سرور خودش فیلتر می‌کند). */
  perm: WidgetPerm | null;
  sizes: WidgetSize[];
  variants: string[];
  defaultSize: WidgetSize;
  defaultVariant: string;
  defaultEnabled: boolean;
  /** ترتیب پیش‌فرض (کوچک‌تر = بالاتر). */
  order: number;
}

function w(def: Omit<WidgetDef, 'defaultEnabled'> & { defaultEnabled?: boolean }): WidgetDef {
  return { defaultEnabled: true, ...def };
}

const KPI_SIZES: WidgetSize[] = ['S', 'M'];
const KPI_VARIANTS = ['card', 'compact'];
const LIST_VARIANTS = ['list', 'compact'];
const SUMMARY_SALES: WidgetPerm = { modules: ['sales'], level: 'all' };
const SUMMARY_ACCOUNTING: WidgetPerm = { modules: ['accounting'], level: 'all' };

export const WIDGET_REGISTRY: readonly WidgetDef[] = [
  w({ key: 'daily-checklist', title: 'لیست کارهای روزانه', description: 'چک‌لیست امروز شما و زیردستان', moduleCode: 'daily-checklist', perm: { modules: ['daily-checklist'], level: 'any' }, sizes: ['M', 'L', 'FULL'], variants: ['default'], defaultSize: 'FULL', defaultVariant: 'default', order: 10 }),
  w({ key: 'forms-inbox', title: 'درخواست‌های جدید فرم‌ها', description: 'پاسخ‌های دیده‌نشده‌ی فرم‌ساز', moduleCode: 'forms', perm: { modules: ['forms'], level: 'any' }, sizes: ['M', 'L', 'FULL'], variants: LIST_VARIANTS, defaultSize: 'FULL', defaultVariant: 'list', order: 20 }),
  w({ key: 'projects-progress', title: 'پروژه‌های در جریان', description: 'پیشرفت پروژه‌های باز', moduleCode: 'projects', perm: { modules: ['projects'], level: 'any' }, sizes: ['M', 'L', 'FULL'], variants: LIST_VARIANTS, defaultSize: 'FULL', defaultVariant: 'list', order: 30 }),
  w({ key: 'calendar', title: 'تقویم و یادآوری‌ها', description: 'رویدادهای ماه به تفکیک روز', moduleCode: null, perm: null, sizes: ['L', 'FULL'], variants: ['default'], defaultSize: 'FULL', defaultVariant: 'default', order: 40 }),
  w({ key: 'approvals', title: 'کارتابل تأیید من', description: 'درخواست‌های منتظر تأیید شما', moduleCode: null, perm: null, sizes: ['M', 'L', 'FULL'], variants: LIST_VARIANTS, defaultSize: 'FULL', defaultVariant: 'list', order: 50 }),
  w({ key: 'messenger-unread', title: 'پیام‌های نخوانده', description: 'تعداد پیام‌های نخوانده‌ی پیام‌رسان', moduleCode: 'messenger', perm: null, sizes: KPI_SIZES, variants: KPI_VARIANTS, defaultSize: 'S', defaultVariant: 'card', order: 55, defaultEnabled: false }),
  w({ key: 'kpi-cash', title: 'موجودی نقد و بانک', description: 'مجموع حساب‌های نقد و بانک', moduleCode: 'accounting', perm: SUMMARY_ACCOUNTING, sizes: KPI_SIZES, variants: KPI_VARIANTS, defaultSize: 'S', defaultVariant: 'card', order: 60 }),
  w({ key: 'kpi-month-invoices', title: 'فاکتورهای این ماه', description: 'تعداد فاکتورهای تأییدشده‌ی ماه جاری', moduleCode: 'sales', perm: SUMMARY_SALES, sizes: KPI_SIZES, variants: KPI_VARIANTS, defaultSize: 'S', defaultVariant: 'card', order: 61 }),
  w({ key: 'kpi-overdue', title: 'مطالبات معوق', description: 'جمع فاکتورهای سررسیدگذشته', moduleCode: 'sales', perm: SUMMARY_SALES, sizes: KPI_SIZES, variants: KPI_VARIANTS, defaultSize: 'S', defaultVariant: 'card', order: 62 }),
  w({ key: 'kpi-checks', title: 'چک‌های نزدیک به سررسید', description: 'جمع چک‌های ۷ روز آینده', moduleCode: 'accounting', perm: SUMMARY_ACCOUNTING, sizes: KPI_SIZES, variants: KPI_VARIANTS, defaultSize: 'S', defaultVariant: 'card', order: 63 }),
  w({ key: 'kpi-low-stock', title: 'کالاهای رو به اتمام', description: 'تعداد کالاهای زیر حداقل موجودی', moduleCode: 'warehouse', perm: { modules: ['warehouse'], level: 'all' }, sizes: KPI_SIZES, variants: KPI_VARIANTS, defaultSize: 'S', defaultVariant: 'card', order: 64 }),
  w({ key: 'sales-trend', title: 'روند فروش ۶ ماه اخیر', description: 'نمودار فروش ماهانه', moduleCode: 'sales', perm: SUMMARY_SALES, sizes: ['M', 'L', 'FULL'], variants: ['chart', 'compact'], defaultSize: 'L', defaultVariant: 'chart', order: 70 }),
  w({ key: 'tasks', title: 'وظایف و یادآوری‌ها', description: 'وظایف باز و افزودن سریع', moduleCode: 'tasks', perm: { modules: ['tasks'], level: 'any' }, sizes: ['M', 'L', 'FULL'], variants: LIST_VARIANTS, defaultSize: 'M', defaultVariant: 'list', order: 71 }),
  w({ key: 'due-invoices', title: 'فاکتورهای نزدیک به سررسید و معوق', description: 'پیگیری و یادآوری پیامکی', moduleCode: 'sales', perm: SUMMARY_SALES, sizes: ['M', 'L', 'FULL'], variants: LIST_VARIANTS, defaultSize: 'M', defaultVariant: 'list', order: 80 }),
  w({ key: 'checks-due', title: 'چک‌های نزدیک به سررسید (فهرست)', description: 'چک‌های دریافتی و صادرشده', moduleCode: 'accounting', perm: SUMMARY_ACCOUNTING, sizes: ['M', 'L', 'FULL'], variants: LIST_VARIANTS, defaultSize: 'M', defaultVariant: 'list', order: 81 }),
  w({ key: 'contracts-expiring', title: 'قراردادهای رو به انقضا', description: 'قراردادهای پایان‌یابنده تا یک ماه آینده', moduleCode: 'contracts', perm: { modules: ['contracts'], level: 'any' }, sizes: ['M', 'L', 'FULL'], variants: LIST_VARIANTS, defaultSize: 'FULL', defaultVariant: 'list', order: 90 }),
  w({ key: 'week-appointments', title: 'نوبت‌های این هفته', description: 'نوبت‌های رزروشده‌ی هفته', moduleCode: 'booking', perm: { modules: ['booking'], level: 'any' }, sizes: ['M', 'L', 'FULL'], variants: LIST_VARIANTS, defaultSize: 'FULL', defaultVariant: 'list', order: 91 }),
  w({ key: 'customer-followups', title: 'مشتریان با موعد پیگیری', description: 'بر اساس ریتم خرید هر مشتری', moduleCode: 'sales', perm: { modules: ['sales', 'crm'], level: 'all' }, sizes: ['M', 'L', 'FULL'], variants: LIST_VARIANTS, defaultSize: 'FULL', defaultVariant: 'list', order: 92 }),
  w({ key: 'production-capacity', title: 'ظرفیت تولید فعلی', description: 'حداکثر تولید ممکن با موجودی مواد', moduleCode: 'production', perm: { modules: ['production', 'warehouse'], level: 'all' }, sizes: ['M', 'L', 'FULL'], variants: LIST_VARIANTS, defaultSize: 'M', defaultVariant: 'list', order: 100 }),
  w({ key: 'production-trend', title: 'روند تولید ۶ ماه اخیر', description: 'مقایسه با سال قبل', moduleCode: 'production', perm: { modules: ['production'], level: 'all' }, sizes: ['M', 'L', 'FULL'], variants: ['chart', 'compact'], defaultSize: 'M', defaultVariant: 'chart', order: 101 }),
  w({ key: 'operations-overview', title: 'وضعیت عملیات', description: 'شمارنده‌ی وظایف عملیاتی: جدید، در حال انجام، معوق، منتظر تأیید', moduleCode: 'operations', perm: null, sizes: ['M', 'L', 'FULL'], variants: ['card', 'compact'], defaultSize: 'M', defaultVariant: 'card', order: 102, defaultEnabled: false }),
  w({ key: 'dispatch-active', title: 'بارهای فعال (اعلام بار)', description: 'تعداد بارهای در جریان به تفکیک وضعیت', moduleCode: 'dispatch', perm: { modules: ['dispatch'], level: 'any' }, sizes: ['M', 'L', 'FULL'], variants: ['card', 'compact'], defaultSize: 'M', defaultVariant: 'card', order: 103, defaultEnabled: false }),
  w({ key: 'correspondence-mine', title: 'مکاتبات من', description: 'امضاهای منتظر، ارجاع‌های رسیده، پیش‌نویس‌ها و معوق‌ها', moduleCode: 'correspondence', perm: { modules: ['correspondence'], level: 'any' }, sizes: ['M', 'L', 'FULL'], variants: ['card', 'compact'], defaultSize: 'M', defaultVariant: 'card', order: 104, defaultEnabled: false }),
  w({ key: 'recent-activity', title: 'فعالیت‌های اخیر', description: 'آخرین رویدادهای ثبت‌شده', moduleCode: null, perm: null, sizes: ['M', 'L', 'FULL'], variants: LIST_VARIANTS, defaultSize: 'FULL', defaultVariant: 'list', order: 110 }),
];

// ── دسترسی ────────────────────────────────────────────────────────────────

export interface AclModuleLike {
  canViewAll: boolean;
  canViewOwn: boolean;
}
export interface AclLike {
  manager: boolean;
  modules: Record<string, AclModuleLike | undefined>;
}

export function permits(perm: WidgetPerm | null, acl: AclLike): boolean {
  if (!perm || acl.manager) return true;
  return perm.modules.some((code) => {
    const m = acl.modules[code];
    if (!m) return false;
    return perm.level === 'all' ? m.canViewAll : m.canViewAll || m.canViewOwn;
  });
}

/** ویجت‌هایی که این کاربر اجازه‌ی دیدنشان را دارد: ماژول نصب‌شده + مجوز. نتیجه به ترتیب پیش‌فرض. */
export function availableWidgets(installed: ReadonlySet<string>, acl: AclLike, registry: readonly WidgetDef[] = WIDGET_REGISTRY): WidgetDef[] {
  return registry
    .filter((d) => (d.moduleCode === null || installed.has(d.moduleCode)) && permits(d.perm, acl))
    .sort((a, b) => a.order - b.order);
}

// ── چیدمان‌ها ─────────────────────────────────────────────────────────────

export interface CompanyLayoutItem {
  key: string;
  enabled: boolean;
  size: WidgetSize;
  variant: string;
}
export interface CompanyLayout {
  version: 1;
  items: CompanyLayoutItem[];
}
export interface UserLayoutItem {
  key: string;
  hidden: boolean;
}
export interface UserLayout {
  version: 1;
  items: UserLayoutItem[];
}
export interface ResolvedWidget {
  key: string;
  size: WidgetSize;
  variant: string;
}

const byKey = (registry: readonly WidgetDef[]) => new Map(registry.map((d) => [d.key, d]));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** ورودی سخت‌گیرانه (PUT): هر خطا ← ۴۰۰. */
export function validateCompanyLayoutInput(raw: unknown, registry: readonly WidgetDef[] = WIDGET_REGISTRY): CompanyLayout {
  if (!isObj(raw) || !Array.isArray(raw.items)) throw new BadRequestException('ساختار چیدمان نامعتبر است');
  const defs = byKey(registry);
  if (raw.items.length > registry.length) throw new BadRequestException('تعداد ویجت‌ها بیش از حد مجاز است');
  const seen = new Set<string>();
  const items: CompanyLayoutItem[] = raw.items.map((it) => {
    if (!isObj(it) || typeof it.key !== 'string') throw new BadRequestException('ویجت نامعتبر است');
    const def = defs.get(it.key);
    if (!def) throw new BadRequestException(`ویجت ناشناخته: ${it.key}`);
    if (seen.has(it.key)) throw new BadRequestException(`ویجت تکراری: ${it.key}`);
    seen.add(it.key);
    if (typeof it.enabled !== 'boolean') throw new BadRequestException(`وضعیت فعال‌بودن «${def.title}» نامعتبر است`);
    const size = it.size ?? def.defaultSize;
    const variant = it.variant ?? def.defaultVariant;
    if (typeof size !== 'string' || !def.sizes.includes(size as WidgetSize)) throw new BadRequestException(`اندازه‌ی «${def.title}» مجاز نیست`);
    if (typeof variant !== 'string' || !def.variants.includes(variant)) throw new BadRequestException(`حالت نمایش «${def.title}» مجاز نیست`);
    return { key: def.key, enabled: it.enabled, size: size as WidgetSize, variant };
  });
  return { version: 1, items };
}

export function validateUserLayoutInput(raw: unknown, registry: readonly WidgetDef[] = WIDGET_REGISTRY): UserLayout {
  if (!isObj(raw) || !Array.isArray(raw.items)) throw new BadRequestException('ساختار چیدمان نامعتبر است');
  const defs = byKey(registry);
  if (raw.items.length > registry.length) throw new BadRequestException('تعداد ویجت‌ها بیش از حد مجاز است');
  const seen = new Set<string>();
  const items: UserLayoutItem[] = raw.items.map((it) => {
    if (!isObj(it) || typeof it.key !== 'string' || !defs.has(it.key)) throw new BadRequestException('ویجت ناشناخته است');
    if (seen.has(it.key)) throw new BadRequestException(`ویجت تکراری: ${it.key}`);
    seen.add(it.key);
    if (typeof it.hidden !== 'boolean') throw new BadRequestException('وضعیت نمایش نامعتبر است');
    return { key: it.key, hidden: it.hidden };
  });
  return { version: 1, items };
}

/** خواندن بی‌خطا از دیتابیس: ورودی‌های نامعتبر/قدیمی (ویجت حذف‌شده، اندازه‌ی منسوخ) بی‌سروصدا کنار گذاشته می‌شوند. */
export function parseStoredCompanyLayout(raw: unknown, registry: readonly WidgetDef[] = WIDGET_REGISTRY): CompanyLayout | null {
  if (!isObj(raw) || !Array.isArray(raw.items)) return null;
  const defs = byKey(registry);
  const seen = new Set<string>();
  const items: CompanyLayoutItem[] = [];
  for (const it of raw.items) {
    if (!isObj(it) || typeof it.key !== 'string') continue;
    const def = defs.get(it.key);
    if (!def || seen.has(it.key)) continue;
    seen.add(it.key);
    items.push({
      key: def.key,
      enabled: typeof it.enabled === 'boolean' ? it.enabled : def.defaultEnabled,
      size: typeof it.size === 'string' && def.sizes.includes(it.size as WidgetSize) ? (it.size as WidgetSize) : def.defaultSize,
      variant: typeof it.variant === 'string' && def.variants.includes(it.variant) ? it.variant : def.defaultVariant,
    });
  }
  return { version: 1, items };
}

export function parseStoredUserLayout(raw: unknown, registry: readonly WidgetDef[] = WIDGET_REGISTRY): UserLayout | null {
  if (!isObj(raw) || !Array.isArray(raw.items)) return null;
  const defs = byKey(registry);
  const seen = new Set<string>();
  const items: UserLayoutItem[] = [];
  for (const it of raw.items) {
    if (!isObj(it) || typeof it.key !== 'string' || !defs.has(it.key) || seen.has(it.key)) continue;
    seen.add(it.key);
    items.push({ key: it.key, hidden: it.hidden === true });
  }
  return { version: 1, items };
}

/**
 * چیدمان مؤثر شرکت برای مجموعه‌ی دلخواه ویجت‌ها: ترتیب ذخیره‌شده، سپس ویجت‌های جدید (که هنوز در چیدمان نیستند)
 * با ترتیب پیش‌فرض و تنظیمات پیش‌فرض.
 */
export function effectiveCompanyItems(company: CompanyLayout | null, defs: readonly WidgetDef[]): CompanyLayoutItem[] {
  const stored = new Map((company?.items ?? []).map((i, idx) => [i.key, { item: i, idx }]));
  const known = defs.filter((d) => stored.has(d.key)).sort((a, b) => stored.get(a.key)!.idx - stored.get(b.key)!.idx);
  const fresh = defs.filter((d) => !stored.has(d.key)).sort((a, b) => a.order - b.order);
  return [...known, ...fresh].map((d) => {
    const s = stored.get(d.key)?.item;
    return s ?? { key: d.key, enabled: d.defaultEnabled, size: d.defaultSize, variant: d.defaultVariant };
  });
}

/**
 * ادغام: شرکت (فعال/اندازه/حالت/ترتیب) ← کاربر (پنهان‌کردن + ترتیب). کاربر هرگز ویجتی را اضافه نمی‌کند
 * که در `allowed` (نصب + مجوز) یا فعال‌بودن شرکت نیست.
 */
export function resolveLayout(allowed: readonly WidgetDef[], company: CompanyLayout | null, user: UserLayout | null): ResolvedWidget[] {
  const base = effectiveCompanyItems(company, allowed).filter((i) => i.enabled);
  if (!user) return base.map(({ key, size, variant }) => ({ key, size, variant }));
  const baseKeys = new Set(base.map((b) => b.key));
  const hidden = new Set(user.items.filter((i) => i.hidden).map((i) => i.key));
  const userOrder = user.items.map((i) => i.key).filter((k) => baseKeys.has(k));
  const ordered = new Set(userOrder);
  const rest = base.filter((b) => !ordered.has(b.key)).map((b) => b.key);
  const baseByKey = new Map(base.map((b) => [b.key, b]));
  return [...userOrder, ...rest]
    .filter((k) => !hidden.has(k))
    .map((k) => {
      const b = baseByKey.get(k)!;
      return { key: b.key, size: b.size, variant: b.variant };
    });
}
