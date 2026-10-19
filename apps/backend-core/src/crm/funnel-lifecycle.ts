/**
 * قواعد خالصِ چرخه‌ی عمر قیف (بدون دیتابیس) — منبع واحد برای سرویس قیف، KPI و لیست مخاطبین.
 *
 * چرخه‌ی عمر:
 *   سرنخ جدید → در تماس → واجد شرایط (هنوز سرنخ) → [فرصت فروش باز] → برد فرصت / اولین خرید
 *   ⇒ «مشتری» → ۲ خرید پرداخت‌شده ⇒ «خرید تکراری» → (سفیر برند | ریسک ریزش → غیرفعال)
 *   مسیر شکست: سرنخ ← رد صلاحیت (با دلیل) که با «بازگشایی» دوباره سرنخ جدید می‌شود.
 *
 * «مشتری بودن» یعنی converted: خرید ثبت‌شده، یا برد فرصت، یا تبدیل دستی — نه صرفاً
 * واجد‌شرایط شدن. واجد‌شرایط یک مرحله‌ی سرنخ است و در فهرست «مشتریان» نمی‌آید؛
 * ولی در لیست «سرنخ‌ها»، «همه» و قیف همیشه دیده می‌شود.
 */

export const LEAD_STAGES = ['NEW_LEAD', 'CONTACTED', 'QUALIFIED'] as const;
export const CUSTOMER_STAGES = ['CUSTOMER', 'REPEAT_CUSTOMER', 'BRAND_AMBASSADOR', 'CHURN_RISK', 'CHURNED'] as const;
export const REPEAT_STAGES = ['REPEAT_CUSTOMER', 'BRAND_AMBASSADOR', 'CHURN_RISK', 'CHURNED'] as const;

export type ManualLeadStage = 'NEW_LEAD' | 'CONTACTED' | 'QUALIFIED' | 'DISQUALIFIED';
export type ContactGroup = 'all' | 'leads' | 'customers' | 'repeat' | 'lost';

export const CONTACT_GROUPS: readonly ContactGroup[] = ['all', 'leads', 'customers', 'repeat', 'lost'];

export type LifecycleContact = {
  funnelStage: string;
  purchaseCount: number;
  convertedAt?: Date | null;
  isBrandAmbassador?: boolean;
};

export function isLeadStage(stage: string): boolean {
  return (LEAD_STAGES as readonly string[]).includes(stage);
}

/** مشتری شده؟ (خرید، برد فرصت یا تبدیل دستی) — مستقل از مرحله‌ی جاری. */
export function isConverted(c: LifecycleContact): boolean {
  return c.purchaseCount >= 1 || !!c.convertedAt || (CUSTOMER_STAGES as readonly string[]).includes(c.funnelStage);
}

export function isRepeat(c: LifecycleContact): boolean {
  return c.purchaseCount >= 2 || (REPEAT_STAGES as readonly string[]).includes(c.funnelStage);
}

/** پیشروی/برگشت دستی فقط برای کسی که هنوز مشتری نشده مجاز است. */
export function canManuallyTransition(c: LifecycleContact, _to: ManualLeadStage): { ok: true } | { ok: false; error: string } {
  if (isConverted(c)) {
    return { ok: false, error: 'این مخاطب مشتری شده و مرحله از این پس به‌صورت خودکار مدیریت می‌شود' };
  }
  return { ok: true };
}

/** مرحله‌ی مخاطب پس از ثبت یک خرید واقعی. */
export function stageAfterPurchase(c: Pick<LifecycleContact, 'purchaseCount' | 'isBrandAmbassador'>): 'CUSTOMER' | 'REPEAT_CUSTOMER' | 'BRAND_AMBASSADOR' {
  if (c.purchaseCount === 0) return 'CUSTOMER';
  return c.isBrandAmbassador ? 'BRAND_AMBASSADOR' : 'REPEAT_CUSTOMER';
}

/**
 * شرط Prisma هر گروه از لیست مخاطبین. گروه‌ها همپوشانی دارند (خرید تکراری زیرمجموعه‌ی
 * مشتریان است) تا هیچ مخاطبی از «همه» غایب نشود.
 */
export function groupWhere(group: ContactGroup | undefined): Record<string, unknown> | null {
  switch (group) {
    case 'leads':
      return { funnelStage: { in: [...LEAD_STAGES] }, purchaseCount: 0, convertedAt: null };
    case 'lost':
      return { funnelStage: 'DISQUALIFIED' };
    case 'customers':
      return { OR: [{ funnelStage: { in: [...CUSTOMER_STAGES] } }, { purchaseCount: { gte: 1 } }, { convertedAt: { not: null } }] };
    case 'repeat':
      return { OR: [{ funnelStage: { in: [...REPEAT_STAGES] } }, { purchaseCount: { gte: 2 } }] };
    default:
      return null;
  }
}

export function parseGroup(value: string | undefined): ContactGroup | undefined {
  return (CONTACT_GROUPS as readonly string[]).includes(value ?? '') ? (value as ContactGroup) : undefined;
}

/** طرف‌حساب صرفاً تأمین‌کننده (نه مشتری/سرنخ) در قیف نمی‌آید. */
export const FUNNEL_PARTY_WHERE = { OR: [{ isCustomer: true }, { isSupplier: false }] } as const;

/** ترکیب امن چند شرط (scope کاربر + گروه + جستجو) بدون تداخل کلید OR. */
export function andWhere(...parts: (Record<string, unknown> | null | undefined)[]): Record<string, unknown> {
  const real = parts.filter((p): p is Record<string, unknown> => !!p && Object.keys(p).length > 0);
  return real.length === 0 ? {} : { AND: real };
}

export type ReachedContact = LifecycleContact & { id: string };

/**
 * «تا کجا رسیده» (تجمعی و یکنواخت): هر کس به مرحله‌ی بالاتر رسیده باشد به مراحل پایین‌تر هم
 * رسیده حساب می‌شود (سرنخی که مستقیم خرید کرده بدون گلوگاه دستی رد شده است). همین تابع هم
 * عدد قیف و هم لیست کلیک روی مرحله را می‌سازد تا عدد و فهرست هرگز نخوانند.
 */
export function computeReached(
  contacts: ReachedContact[],
  contactedIds: Set<string>,
  qualifiedIds: Set<string>,
): Record<'NEW_LEAD' | 'CONTACTED' | 'QUALIFIED' | 'CUSTOMER' | 'REPEAT_CUSTOMER', Set<string>> {
  const all = new Set(contacts.map((c) => c.id));
  const customer = new Set(contacts.filter(isConverted).map((c) => c.id));
  const repeat = new Set(contacts.filter(isRepeat).map((c) => c.id));
  const qualified = new Set<string>([...qualifiedIds, ...customer].filter((id) => all.has(id)));
  const contacted = new Set<string>([...contactedIds, ...qualified].filter((id) => all.has(id)));
  return { NEW_LEAD: all, CONTACTED: contacted, QUALIFIED: qualified, CUSTOMER: customer, REPEAT_CUSTOMER: repeat };
}
