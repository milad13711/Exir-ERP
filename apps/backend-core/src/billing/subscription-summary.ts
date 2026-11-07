/**
 * منبع واحد حقیقتِ «وضعیت اشتراک/لایسنس» — تابع‌های خالص (بدون دیتابیس).
 *
 * همه‌ی مصرف‌کننده‌ها (هدر، تنظیمات ← اشتراک‌ها، پنل ادمین، کرون‌های صورتحساب، payload فضای کار)
 * فقط از همین خروجی می‌خوانند؛ هیچ‌جای دیگر نباید «روز باقی‌مانده/منقضی» را از روی فیلد خام حساب کند.
 *
 * قانون «قابل‌استفاده بودن» (usable) عیناً همان چیزی است که اجرا می‌کند:
 *  - تننت: tenantAccess() ← JwtAuthGuard (SUSPENDED/CANCELLED مسدود، PENDING_PAYMENT فقط billing/*)
 *  - ماژول: isModuleRowUsable() ← ModuleGuard (ردیف INSTALLED/TRIAL، یا بدون ردیف و isCore)
 * تاریخ پایان دوره *به‌تنهایی* دسترسی را قطع نمی‌کند (کرون ماژول‌ها وضعیت را DISABLED می‌کند؛ اشتراک پلن هم
 * فقط با تغییر وضعیت تننت قفل می‌شود)؛ پس «پایان‌یافته ولی هنوز فعال» در نمایش GRACE است نه EXPIRED.
 */

export const RENEWAL_NOTICE_DAYS = 10;
/** بعد از این‌همه روز از انقضا، ماژول منقضی‌شده دیگر در بنر هدر نمی‌آید (فقط در صفحه‌ی اشتراک‌ها). */
export const EXPIRED_BANNER_DAYS = 14;

export type SubscriptionState =
  | 'ACTIVE'
  | 'TRIAL'
  | 'EXPIRING_SOON'
  | 'GRACE'
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'NOT_SUBSCRIBED'
  | 'NO_EXPIRY';

export type NextAction = 'PAY_INVOICE' | 'REQUEST_INVOICE' | 'CONTACT_SUPPORT' | 'NONE';
export type Severity = 'none' | 'info' | 'warning' | 'danger';

// ── روز تهران ─────────────────────────────────────────────────────────

const tehranFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });

/** شماره‌ی روز تقویمی (به وقت تهران) — برای تفاضل «روز باقی‌مانده» که از نیمه‌شب تهران جابه‌جا شود نه UTC. */
export function tehranDayIndex(d: Date): number {
  const [y, m, day] = tehranFmt.format(d).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

export type TimeLeft = { expired: boolean; daysLeft: number; hoursLeft: number; daysOverdue: number };

/**
 * expired ⇔ end <= now (لحظه‌ای). daysLeft = اختلاف روز تقویمی تهران (۰ = امروز تمام می‌شود)؛
 * هیچ‌وقت برای حالت منقضی مثبت نمی‌شود و برای حالت غیرمنقضی منفی نمی‌شود.
 */
export function timeLeft(end: Date, now: Date): TimeLeft {
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return { expired: true, daysLeft: 0, hoursLeft: 0, daysOverdue: Math.max(0, tehranDayIndex(now) - tehranDayIndex(end)) };
  return { expired: false, daysLeft: Math.max(0, tehranDayIndex(end) - tehranDayIndex(now)), hoursLeft: Math.ceil(ms / 3_600_000), daysOverdue: 0 };
}

// ── قانون اجرا (مشترک با گاردها) ─────────────────────────────────────

export type TenantAccessLevel = 'FULL' | 'BILLING_ONLY' | 'BLOCKED';

/** همان منطق JwtAuthGuard روی Tenant.status. */
export function tenantAccess(status: string): TenantAccessLevel {
  if (status === 'SUSPENDED' || status === 'CANCELLED') return 'BLOCKED';
  if (status === 'PENDING_PAYMENT') return 'BILLING_ONLY';
  return 'FULL';
}

/** همان منطق ModuleGuard: ردیف TenantModule اگر هست فقط INSTALLED/TRIAL، وگرنه پیش‌فرض isCore. */
export function isModuleRowUsable(install: { status: string } | null | undefined, isCore: boolean): boolean {
  return install ? install.status === 'INSTALLED' || install.status === 'TRIAL' : isCore;
}

// ── ورودی/خروجی ───────────────────────────────────────────────────────

export type InvoiceInput = {
  id: string;
  amount: number;
  status: string; // PENDING | PAID | FAILED | AWAITING_APPROVAL
  purpose: string | null;
  items: unknown;
  dueAt: Date;
  paidAt: Date | null;
};

export type OpenInvoiceRef = { id: string; amount: number; dueAt: string; purpose: string | null };

export type Entitlement = {
  state: SubscriptionState;
  /** آیا همین حالا (طبق اجرا) می‌شود از آن استفاده کرد؟ */
  usable: boolean;
  /** فقط صفحه‌ی صورتحساب باز است (PENDING_PAYMENT) */
  billingOnly: boolean;
  expiresAt: string | null;
  daysLeft: number | null;
  hoursLeft: number | null;
  daysOverdue: number | null;
  /** فاکتور قابل‌پرداخت (PENDING) مرتبط */
  openInvoice: OpenInvoiceRef | null;
  /** فاکتور تمدید صادر شده ولی هنوز در کارتابل تأیید مدیر پلتفرم است (برای مشتری قابل‌پرداخت نیست) */
  awaitingApproval: boolean;
  nextAction: NextAction;
  severity: Severity;
  /** کد دلیل برای متن فارسی در UI */
  reason: string;
};

export type TenantEntitlement = Entitlement & {
  source: 'CLOUD_SUBSCRIPTION' | 'ON_PREMISE_LICENSE' | 'TENANT_STATUS';
  planName: string | null;
  planCode: string | null;
  autoRenew: boolean | null;
  lifetime: boolean;
  /** رکورد اشتراک با واقعیت پرداخت نمی‌خواند (مثلاً پرداخت‌شده ولی تاریخ پایان قدیمی مانده) */
  staleRecord: boolean;
};

export type ModuleEntitlement = Entitlement & {
  code: string;
  name: string;
  isCore: boolean;
  installStatus: 'INSTALLED' | 'TRIAL' | 'DISABLED' | null;
  billingMode: 'MONTHLY' | 'YEARLY' | 'LICENSE' | null;
};

function refOf(inv: InvoiceInput): OpenInvoiceRef {
  return { id: inv.id, amount: inv.amount, dueAt: inv.dueAt.toISOString(), purpose: inv.purpose };
}

function severityFor(state: SubscriptionState, daysLeft: number | null): Severity {
  switch (state) {
    case 'SUSPENDED':
    case 'EXPIRED':
    case 'GRACE':
      return 'danger';
    case 'EXPIRING_SOON':
      return daysLeft !== null && daysLeft <= 3 ? 'danger' : 'warning';
    case 'TRIAL':
      return 'warning';
    case 'NOT_SUBSCRIBED':
      return 'none';
    default:
      return 'none';
  }
}

function base(state: SubscriptionState, over: Partial<Entitlement> & { usable: boolean; reason: string }): Entitlement {
  const daysLeft = over.daysLeft ?? null;
  return {
    state,
    billingOnly: false,
    expiresAt: null,
    daysLeft,
    hoursLeft: null,
    daysOverdue: null,
    openInvoice: null,
    awaitingApproval: false,
    nextAction: 'NONE',
    severity: severityFor(state, daysLeft),
    ...over,
  };
}

/** فاکتور باز: PENDING ⇒ قابل پرداخت؛ AWAITING_APPROVAL ⇒ هنوز صادر نشده. */
function pickInvoices(invoices: InvoiceInput[]): { open: InvoiceInput | null; awaiting: boolean } {
  const pending = invoices.filter((i) => i.status === 'PENDING').sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  return { open: pending[0] ?? null, awaiting: invoices.some((i) => i.status === 'AWAITING_APPROVAL') };
}

function itemCount(items: unknown): number {
  return Array.isArray(items) ? items.length : 0;
}

/** فاکتور سطح پلن (راه‌اندازی/تمدید پلن/پیش‌فاکتور بدون ریزخط) در برابر فاکتور ماژولی/پیامکی. */
export function isPlanLevelInvoice(inv: { purpose: string | null; items: unknown }): boolean {
  return (inv.purpose === null || inv.purpose === 'TENANT_SETUP' || inv.purpose === 'PLAN_RENEWAL') && itemCount(inv.items) === 0;
}

function actionFor(open: InvoiceInput | null, awaiting: boolean, canRequest = true): NextAction {
  if (open) return 'PAY_INVOICE';
  if (awaiting) return 'NONE'; // صادر شده و منتظر تأیید؛ کار دیگری از مشتری ساخته نیست
  return canRequest ? 'REQUEST_INVOICE' : 'CONTACT_SUPPORT';
}

// ── تننت ─────────────────────────────────────────────────────────────

export type LicenseLike =
  | { mode: 'cloud' }
  | { mode: 'on_premise'; state: 'valid' | 'grace'; daysLeft: number | null; warningLevel?: number; reasonCode?: string }
  | { mode: 'on_premise'; state: 'invalid' | 'expired'; reasonCode?: string };

export type TenantEntitlementInput = {
  tenantStatus: string;
  subscription: {
    status: string; // TRIAL | ACTIVE | PAST_DUE | CANCELLED
    startedAt: Date;
    currentPeriodEnd: Date;
    lifetime: boolean;
    autoRenew: boolean;
    planName: string;
    planCode: string;
  } | null;
  /** فاکتورهای سطح پلن این تننت (هر وضعیت) */
  planInvoices: InvoiceInput[];
  /** فقط در استقرار on-premise که لایسنس محلی مرجع است */
  license?: LicenseLike | null;
};

export function computeTenantEntitlement(input: TenantEntitlementInput, now: Date = new Date()): TenantEntitlement {
  const access = tenantAccess(input.tenantStatus);
  const sub = input.subscription;
  const meta = {
    planName: sub?.planName ?? null,
    planCode: sub?.planCode ?? null,
    autoRenew: sub?.autoRenew ?? null,
    lifetime: !!sub?.lifetime,
    staleRecord: false,
  };
  const wrap = (source: TenantEntitlement['source'], e: Entitlement, over: Partial<typeof meta> = {}): TenantEntitlement => ({ ...e, source, ...meta, ...over });

  // ۱) تننت مسدود (تعلیق/لغو) — همه‌چیز پشت آن بی‌اثر است
  if (access === 'BLOCKED') {
    return wrap('TENANT_STATUS', base('SUSPENDED', { usable: false, reason: input.tenantStatus === 'CANCELLED' ? 'tenant_cancelled' : 'tenant_suspended', nextAction: 'CONTACT_SUPPORT' }));
  }

  // ۲) استقرار اختصاصی: مرجع لایسنس امضاشده است و ردیف اشتراک ابری نادیده گرفته می‌شود
  const lic = input.license;
  if (lic && lic.mode === 'on_premise') {
    if (lic.state === 'invalid' || lic.state === 'expired') {
      return wrap('ON_PREMISE_LICENSE', base('EXPIRED', { usable: false, reason: lic.reasonCode ?? 'license_invalid', nextAction: 'CONTACT_SUPPORT' }));
    }
    if (lic.state === 'grace') {
      return wrap('ON_PREMISE_LICENSE', base('GRACE', { usable: true, reason: lic.reasonCode === 'offline_grace' ? 'license_offline_grace' : 'license_expired_grace', daysLeft: lic.daysLeft, nextAction: 'CONTACT_SUPPORT' }));
    }
    if (lic.state !== 'valid') throw new Error('unreachable');
    if (lic.daysLeft === null) {
      return wrap('ON_PREMISE_LICENSE', base('NO_EXPIRY', { usable: true, reason: 'license_perpetual' }));
    }
    const warn = (lic.warningLevel ?? 0) > 0;
    return wrap('ON_PREMISE_LICENSE', base(warn ? 'EXPIRING_SOON' : 'ACTIVE', { usable: true, reason: lic.reasonCode === 'token_renewal_due' ? 'license_token_renewal_due' : 'license_valid', daysLeft: lic.daysLeft, nextAction: warn ? 'CONTACT_SUPPORT' : 'NONE' }));
  }

  const { open, awaiting } = pickInvoices(input.planInvoices.filter(isPlanLevelInvoice));
  const billingOnly = access === 'BILLING_ONLY';

  // ۳) بدون اشتراک
  if (!sub || sub.status === 'CANCELLED') {
    return wrap('CLOUD_SUBSCRIPTION', base('NOT_SUBSCRIBED', { usable: !billingOnly, billingOnly, reason: 'no_subscription', openInvoice: open ? refOf(open) : null, awaitingApproval: awaiting, nextAction: open ? 'PAY_INVOICE' : 'CONTACT_SUPPORT' }));
  }

  // ۴) مادام‌العمر — تاریخ پایان نمایشی است (۱۰۰ سال بعد) و هرگز نباید «منقضی» دیده شود
  if (sub.lifetime) {
    return wrap('CLOUD_SUBSCRIPTION', base('NO_EXPIRY', { usable: !billingOnly, billingOnly, reason: 'lifetime' }));
  }

  const t = timeLeft(sub.currentPeriodEnd, now);
  const exp = sub.currentPeriodEnd.toISOString();

  // آیا پرداخت پلن *در بازه‌ی پایان* ثبت شده ولی رکورد اشتراک به‌روز نشده؟ (نسخه‌های قدیمی settleInvoicePaid اشتراک را تمدید نمی‌کردند)
  const paidRecently = input.planInvoices.some((i) => i.status === 'PAID' && isPlanLevelInvoice(i) && i.paidAt && i.paidAt.getTime() >= sub.currentPeriodEnd.getTime() - 31 * 86_400_000);
  const lapsed = t.expired || sub.status === 'PAST_DUE';
  const stale = lapsed && paidRecently && !open;

  if (billingOnly) {
    // PENDING_PAYMENT: ورود هست ولی فقط billing/*. اگر پرداختی ثبت شده ولی هنوز قفل است ⇒ مشکل رکورد، نه پرداخت جدید.
    if (stale) {
      return wrap('CLOUD_SUBSCRIPTION', base('EXPIRED', { usable: false, billingOnly: true, reason: 'payment_recorded_locked', expiresAt: exp, daysOverdue: t.daysOverdue, nextAction: 'CONTACT_SUPPORT' }), { staleRecord: true });
    }
    const state: SubscriptionState = t.expired || sub.status === 'PAST_DUE' ? 'EXPIRED' : 'NOT_SUBSCRIBED';
    return wrap('CLOUD_SUBSCRIPTION', base(state, { usable: false, billingOnly: true, reason: state === 'EXPIRED' ? 'trial_or_period_ended' : 'awaiting_first_payment', expiresAt: exp, daysOverdue: t.expired ? t.daysOverdue : null, openInvoice: open ? refOf(open) : null, awaitingApproval: awaiting, nextAction: actionFor(open, awaiting) }));
  }

  if (stale) {
    // تننت فعال و واقعاً پرداخت کرده؛ فقط تاریخ پایانِ ثبت‌شده قدیمی است ⇒ هرگز «منقضی» نشان نده
    return wrap('CLOUD_SUBSCRIPTION', base('ACTIVE', { usable: true, reason: 'paid_record_stale' }), { staleRecord: true });
  }

  if (sub.status === 'TRIAL') {
    if (!t.expired) {
      return wrap('CLOUD_SUBSCRIPTION', base('TRIAL', { usable: true, reason: 'free_trial', expiresAt: exp, daysLeft: t.daysLeft, hoursLeft: t.hoursLeft, openInvoice: open ? refOf(open) : null, awaitingApproval: awaiting, nextAction: actionFor(open, awaiting) }));
    }
    // پایان آزمایشی ولی کرون ساعتی هنوز تننت را قفل نکرده ⇒ طبق اجرا هنوز فعال است
    return wrap('CLOUD_SUBSCRIPTION', base('GRACE', { usable: true, reason: 'trial_ended_pending_lock', expiresAt: exp, daysOverdue: t.daysOverdue, openInvoice: open ? refOf(open) : null, awaitingApproval: awaiting, nextAction: actionFor(open, awaiting) }));
  }

  if (t.expired || sub.status === 'PAST_DUE') {
    // تننت ACTIVE است (اجرا وارد می‌کند) ⇒ مهلت، نه «منقضی»
    return wrap('CLOUD_SUBSCRIPTION', base('GRACE', { usable: true, reason: 'period_ended_still_active', expiresAt: exp, daysOverdue: t.daysOverdue, openInvoice: open ? refOf(open) : null, awaitingApproval: awaiting, nextAction: actionFor(open, awaiting) }));
  }

  if (t.daysLeft <= RENEWAL_NOTICE_DAYS) {
    return wrap('CLOUD_SUBSCRIPTION', base('EXPIRING_SOON', { usable: true, reason: 'renewal_due', expiresAt: exp, daysLeft: t.daysLeft, hoursLeft: t.hoursLeft, openInvoice: open ? refOf(open) : null, awaitingApproval: awaiting, nextAction: actionFor(open, awaiting) }));
  }
  return wrap('CLOUD_SUBSCRIPTION', base('ACTIVE', { usable: true, reason: 'active', expiresAt: exp, daysLeft: t.daysLeft, hoursLeft: t.hoursLeft }));
}

// ── ماژول ────────────────────────────────────────────────────────────

export type ModuleEntitlementInput = {
  code: string;
  name: string;
  isCore: boolean;
  priceMonthly: number;
  install: {
    status: string;
    billingMode: string | null;
    currentPeriodEnd: Date | null;
    pendingRenewalInvoiceId: string | null;
  } | null;
};

function invoiceCoversModule(inv: InvoiceInput, code: string, pendingId: string | null): boolean {
  if (inv.purpose !== 'MODULE_RENEWAL' && inv.purpose !== 'MODULE_PURCHASE') return false;
  if (pendingId && inv.id === pendingId) return true;
  return Array.isArray(inv.items) && (inv.items as Array<{ moduleCode?: string }>).some((it) => it?.moduleCode === code);
}

export function computeModuleEntitlement(
  m: ModuleEntitlementInput,
  invoices: InvoiceInput[],
  tenantAllows: boolean,
  now: Date = new Date(),
): ModuleEntitlement {
  const install = m.install;
  const rowUsable = isModuleRowUsable(install, m.isCore);
  const usableNow = rowUsable && tenantAllows;
  const installStatus = (install?.status ?? null) as ModuleEntitlement['installStatus'];
  const billingMode = (install?.billingMode ?? null) as ModuleEntitlement['billingMode'];
  const wrap = (e: Entitlement): ModuleEntitlement => ({ ...e, code: m.code, name: m.name, isCore: m.isCore, installStatus, billingMode });

  if (!install) {
    return wrap(base(m.isCore ? 'NO_EXPIRY' : 'NOT_SUBSCRIBED', { usable: usableNow, reason: m.isCore ? 'included' : 'not_purchased' }));
  }

  if (install.status === 'TRIAL') {
    return wrap(base('TRIAL', { usable: usableNow, reason: 'demo' }));
  }

  const periodic = billingMode === 'MONTHLY' || billingMode === 'YEARLY';
  const end = install.currentPeriodEnd;
  const relevant = invoices.filter((i) => invoiceCoversModule(i, m.code, install.pendingRenewalInvoiceId));
  const { open, awaiting } = pickInvoices(relevant);
  const inv = { openInvoice: open ? refOf(open) : null, awaitingApproval: awaiting };

  if (install.status === 'DISABLED') {
    if (periodic && end && end.getTime() <= now.getTime()) {
      const t = timeLeft(end, now);
      return wrap(base('EXPIRED', { usable: false, reason: 'period_ended_disabled', expiresAt: end.toISOString(), daysOverdue: t.daysOverdue, ...inv, nextAction: actionFor(open, awaiting) }));
    }
    // غیرفعال‌شده‌ی دستی (توسط مشتری/ادمین) — انقضا نیست، بنر نمی‌خواهد
    return wrap(base('NOT_SUBSCRIBED', { usable: false, reason: end && end.getTime() > now.getTime() ? 'disabled_manually_paid_period' : 'disabled_manually', expiresAt: end ? end.toISOString() : null, ...inv, nextAction: open ? 'PAY_INVOICE' : 'NONE' }));
  }

  // INSTALLED
  if (!periodic || !end) {
    const granted = !m.isCore && m.priceMonthly > 0 && billingMode !== 'LICENSE';
    return wrap(base('NO_EXPIRY', { usable: usableNow, reason: billingMode === 'LICENSE' ? 'license_lifetime' : granted ? 'granted_without_expiry' : 'included' }));
  }

  const t = timeLeft(end, now);
  if (t.expired) {
    // هنوز INSTALLED ⇒ ModuleGuard اجازه می‌دهد (کرون روزانه یا فاکتور در انتظار تأیید نگهش داشته) ⇒ مهلت
    return wrap(base('GRACE', { usable: usableNow, reason: awaiting && !open ? 'period_ended_invoice_awaiting_approval' : 'period_ended_pending_disable', expiresAt: end.toISOString(), daysOverdue: t.daysOverdue, ...inv, nextAction: actionFor(open, awaiting) }));
  }
  if (t.daysLeft <= RENEWAL_NOTICE_DAYS) {
    return wrap(base('EXPIRING_SOON', { usable: usableNow, reason: 'renewal_due', expiresAt: end.toISOString(), daysLeft: t.daysLeft, hoursLeft: t.hoursLeft, ...inv, nextAction: actionFor(open, awaiting) }));
  }
  return wrap(base('ACTIVE', { usable: usableNow, reason: 'active', expiresAt: end.toISOString(), daysLeft: t.daysLeft, hoursLeft: t.hoursLeft }));
}

// ── بنر ──────────────────────────────────────────────────────────────

export type Banner = {
  scope: 'tenant' | 'module';
  state: SubscriptionState;
  severity: Severity;
  nextAction: NextAction;
  daysLeft: number | null;
  hoursLeft: number | null;
  daysOverdue: number | null;
  /** اولین ماژول مسئول بنر */
  moduleCode: string | null;
  moduleName: string | null;
  /** تعداد ماژول‌های دیگر که همین هشدار را دارند */
  moreModules: number;
  invoiceId: string | null;
  awaitingApproval: boolean;
  reason: string;
};

const RANK: Record<SubscriptionState, number> = { SUSPENDED: 6, EXPIRED: 5, GRACE: 4, EXPIRING_SOON: 3, TRIAL: 2, NOT_SUBSCRIBED: 1, ACTIVE: 0, NO_EXPIRY: 0 };

function bannerWorthy(e: Entitlement, scope: 'tenant' | 'module'): boolean {
  if (e.state === 'SUSPENDED' || e.state === 'GRACE' || e.state === 'EXPIRING_SOON') return true;
  if (e.state === 'EXPIRED') return scope === 'tenant' || (e.daysOverdue ?? 0) <= EXPIRED_BANNER_DAYS;
  if (e.state === 'TRIAL') return scope === 'tenant';
  // تننت در انتظار پرداخت اول
  return scope === 'tenant' && e.state === 'NOT_SUBSCRIBED' && e.billingOnly;
}

/** تنها جایی که تصمیم می‌گیرد هدر چه هشداری نشان بدهد. null = هیچ هشداری لازم نیست. */
export function pickBanner(tenant: TenantEntitlement, modules: ModuleEntitlement[]): Banner | null {
  const candidates: Array<{ e: Entitlement; scope: 'tenant' | 'module'; m?: ModuleEntitlement }> = [];
  if (bannerWorthy(tenant, 'tenant')) candidates.push({ e: tenant, scope: 'tenant' });
  for (const m of modules) if (bannerWorthy(m, 'module')) candidates.push({ e: m, scope: 'module', m });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => RANK[b.e.state] - RANK[a.e.state] || (a.scope === 'tenant' ? -1 : 1) - (b.scope === 'tenant' ? -1 : 1) || (a.e.daysLeft ?? 9999) - (b.e.daysLeft ?? 9999));
  const top = candidates[0];
  const sameKind = candidates.filter((c) => c.scope === 'module' && c.e.state === top.e.state && c !== top).length;
  return {
    scope: top.scope,
    state: top.e.state,
    severity: top.e.severity,
    nextAction: top.e.nextAction,
    daysLeft: top.e.daysLeft,
    hoursLeft: top.e.hoursLeft,
    daysOverdue: top.e.daysOverdue,
    moduleCode: top.m?.code ?? null,
    moduleName: top.m?.name ?? null,
    moreModules: top.scope === 'module' ? sameKind : 0,
    invoiceId: top.e.openInvoice?.id ?? null,
    awaitingApproval: top.e.awaitingApproval,
    reason: top.e.reason,
  };
}

export type SubscriptionSummary = {
  generatedAt: string;
  /** ADMIN = OWNER/ADMIN با جزئیات کامل؛ MEMBER = فقط وضعیت خنثی */
  viewer: 'ADMIN' | 'MEMBER';
  tenant: TenantEntitlement;
  modules: ModuleEntitlement[];
  banner: Banner | null;
  openInvoices: Array<OpenInvoiceRef & { scope: 'plan' | 'module'; moduleCode?: string }>;
};

export function buildSummary(
  tenantIn: TenantEntitlementInput,
  modulesIn: ModuleEntitlementInput[],
  moduleInvoices: InvoiceInput[],
  now: Date = new Date(),
): SubscriptionSummary {
  const tenant = computeTenantEntitlement(tenantIn, now);
  const allows = tenantAccess(tenantIn.tenantStatus) === 'FULL' && (tenantIn.license?.mode !== 'on_premise' || tenant.usable);
  const modules = modulesIn.map((m) => computeModuleEntitlement(m, moduleInvoices, allows, now));
  const openInvoices: SubscriptionSummary['openInvoices'] = [];
  if (tenant.openInvoice) openInvoices.push({ ...tenant.openInvoice, scope: 'plan' });
  for (const m of modules) if (m.openInvoice && !openInvoices.some((o) => o.id === m.openInvoice!.id)) openInvoices.push({ ...m.openInvoice, scope: 'module', moduleCode: m.code });
  return { generatedAt: now.toISOString(), viewer: 'ADMIN', tenant, modules, banner: pickBanner(tenant, modules), openInvoices };
}

/** کاربر عادی (غیر مالک/ادمین): فقط وضعیت خنثی؛ بدون مبلغ، فاکتور، تاریخ و نام پلن. */
export function redactForMember(s: SubscriptionSummary): SubscriptionSummary {
  const neutral = <T extends Entitlement>(e: T): T => ({ ...e, expiresAt: null, daysLeft: null, hoursLeft: null, daysOverdue: null, openInvoice: null, awaitingApproval: false, nextAction: 'NONE' });
  const tenant = { ...neutral(s.tenant), planName: null, planCode: null, autoRenew: null };
  const b = s.banner;
  // کاربر عادی فقط مشکلِ سطح تننت را می‌بیند (کاری از او ساخته نیست؛ به مدیر ارجاع می‌شود)
  const banner: Banner | null =
    b && b.scope === 'tenant' && (b.state === 'GRACE' || b.state === 'EXPIRED' || b.state === 'SUSPENDED')
      ? { ...b, daysLeft: null, hoursLeft: null, daysOverdue: null, invoiceId: null, awaitingApproval: false, nextAction: 'NONE' }
      : null;
  return { generatedAt: s.generatedAt, viewer: 'MEMBER', tenant, modules: s.modules.map(neutral), banner, openInvoices: [] };
}
