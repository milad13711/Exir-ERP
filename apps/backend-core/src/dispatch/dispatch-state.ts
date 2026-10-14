/**
 * ماشین‌حالت گردش‌کار اعلام بار (ماژول dispatch) — کاملاً خالص و بدون وابستگی به دیتابیس.
 * وضعیت‌های قدیمی fleet (DRAFT/OFFERED/ACCEPTED/DELIVERED/CANCELLED) همچنان معتبرند؛ مقادیر تازه افزایشی‌اند.
 */

export const SHIPMENT_STATUSES = [
  'DRAFT',
  'AWAITING_DRIVER',
  'OFFERED',
  'ACCEPTED',
  'VEHICLE_ARRIVED',
  'CLEANLINESS_APPROVED',
  'TARE_RECORDED',
  'LOADED',
  'WEIGHED',
  'AWAITING_DOCS',
  'FINAL_CHECK',
  'READY_TO_DEPART',
  'IN_TRANSIT',
  'DELIVERED',
  'SUSPENDED',
  'CANCELLED',
] as const;
export type ShipmentStatusValue = (typeof SHIPMENT_STATUSES)[number];

export const STATUS_LABELS_FA: Record<ShipmentStatusValue, string> = {
  DRAFT: 'ثبت‌شده',
  AWAITING_DRIVER: 'در انتظار راننده',
  OFFERED: 'در حال پیشنهاد به راننده',
  ACCEPTED: 'راننده تعیین شد',
  VEHICLE_ARRIVED: 'ماشین رسیده',
  CLEANLINESS_APPROVED: 'نظافت تأیید شد',
  TARE_RECORDED: 'وزن خالی ثبت شد',
  LOADED: 'بارگیری شده',
  WEIGHED: 'وزن‌کشی شد',
  AWAITING_DOCS: 'در انتظار اسناد',
  FINAL_CHECK: 'کنترل نهایی',
  READY_TO_DEPART: 'آماده حرکت',
  IN_TRANSIT: 'در مسیر',
  DELIVERED: 'تحویل شد',
  SUSPENDED: 'متوقف',
  CANCELLED: 'لغو',
};

/** ترتیب پیشروی خودکار؛ وضعیت خودکار هرگز به عقب برنمی‌گردد. */
const RANK: Record<string, number> = {
  DRAFT: 0,
  AWAITING_DRIVER: 1,
  OFFERED: 2,
  ACCEPTED: 3,
  VEHICLE_ARRIVED: 4,
  CLEANLINESS_APPROVED: 5,
  TARE_RECORDED: 6,
  LOADED: 7,
  WEIGHED: 8,
  AWAITING_DOCS: 9,
  FINAL_CHECK: 10,
  READY_TO_DEPART: 11,
  IN_TRANSIT: 12,
  DELIVERED: 13,
};

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['DELIVERED', 'CANCELLED']);

export function statusRank(s: string): number {
  return RANK[s] ?? -1;
}

export class DispatchRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DispatchRuleError';
  }
}

export type DispatchStep =
  | 'ASSIGN_DRIVER'
  | 'ARRIVAL'
  | 'CLEANLINESS'
  | 'TARE'
  | 'LOADING'
  | 'GROSS'
  | 'FINAL_CHECK'
  | 'READY'
  | 'DEPART'
  | 'DELIVER';

/** عکس لحظه‌ای وضعیت پیشرفت یک بار برای تصمیم‌گیری. */
export type ProgressFacts = {
  status: string;
  hasDriver: boolean;
  arrived: boolean;
  cleanlinessResult: string | null;
  tareKg: number | null;
  loaded: boolean;
  grossKg: number | null;
  netKg: number | null;
  loaderUserId: string | null;
  finalCheckResult: string | null;
  docsRequired: boolean;
  docsComplete: boolean;
  docsOverridden: boolean;
  readyGranted: boolean;
  departed: boolean;
  receiptDone: boolean;
  receiptRequiredBeforeDeparture: boolean;
  receiptOverridden: boolean;
  needsWeighing: boolean;
  weightConfirmed: boolean;
};

/** وضعیت خودکار بعد از تکمیل یک مرحله؛ null یعنی تغییری لازم نیست. */
export function autoStatusAfter(current: string, step: DispatchStep): ShipmentStatusValue | null {
  if (current === 'SUSPENDED' || TERMINAL_STATUSES.has(current)) return null;
  let target: ShipmentStatusValue;
  switch (step) {
    case 'ASSIGN_DRIVER':
      target = 'ACCEPTED';
      break;
    case 'ARRIVAL':
      target = 'VEHICLE_ARRIVED';
      break;
    case 'CLEANLINESS':
      target = 'CLEANLINESS_APPROVED';
      break;
    case 'TARE':
      target = 'TARE_RECORDED';
      break;
    case 'LOADING':
      target = 'LOADED';
      break;
    case 'GROSS':
      target = 'WEIGHED';
      break;
    case 'FINAL_CHECK':
      target = 'FINAL_CHECK';
      break;
    case 'READY':
      target = 'READY_TO_DEPART';
      break;
    case 'DEPART':
      target = 'IN_TRANSIT';
      break;
    case 'DELIVER':
      target = 'DELIVERED';
      break;
  }
  return statusRank(target) > statusRank(current) ? target : null;
}

/** بعد از وزن‌کشی/تغییر اسناد: «در انتظار اسناد» یا «کنترل نهایی». فقط وقتی بار بین WEIGHED و FINAL_CHECK است. */
export function statusForDocs(current: string, grossRecorded: boolean, docsRequired: boolean, docsComplete: boolean, docsOverridden: boolean): ShipmentStatusValue | null {
  if (!grossRecorded) return null;
  if (statusRank(current) < statusRank('WEIGHED') || statusRank(current) > statusRank('FINAL_CHECK')) return null;
  const target: ShipmentStatusValue = docsRequired && !docsComplete && !docsOverridden ? 'AWAITING_DOCS' : 'FINAL_CHECK';
  return target === current ? null : target;
}

/** پیش‌شرط هر مرحله؛ در صورت نقض، پیام فارسی می‌اندازد. */
export function assertStepAllowed(step: DispatchStep, f: ProgressFacts, actorUserId: string | null): void {
  if (f.status === 'SUSPENDED') throw new DispatchRuleError('این بار متوقف شده است؛ ابتدا ازسر بگیرید');
  if (TERMINAL_STATUSES.has(f.status)) throw new DispatchRuleError('این بار بسته شده است');
  switch (step) {
    case 'ASSIGN_DRIVER':
      return;
    case 'ARRIVAL':
      if (!f.hasDriver) throw new DispatchRuleError('ابتدا راننده را تعیین کنید');
      if (f.arrived) throw new DispatchRuleError('رسیدن ماشین قبلاً ثبت شده است');
      return;
    case 'CLEANLINESS':
      if (!f.arrived) throw new DispatchRuleError('ابتدا رسیدن ماشین را ثبت کنید');
      if (f.cleanlinessResult === 'PASS') throw new DispatchRuleError('نظافت قبلاً تأیید شده است');
      return;
    case 'TARE':
      if (f.cleanlinessResult !== 'PASS') throw new DispatchRuleError('ابتدا نظافت ماشین باید تأیید شود');
      if (f.tareKg != null) throw new DispatchRuleError('وزن خالی قبلاً ثبت شده است');
      return;
    case 'LOADING':
      if (f.tareKg == null) throw new DispatchRuleError('ابتدا وزن خالی ماشین را ثبت کنید');
      if (f.loaded) throw new DispatchRuleError('بارگیری قبلاً ثبت شده است');
      return;
    case 'GROSS':
      if (!f.loaded) throw new DispatchRuleError('ابتدا بارگیری را ثبت کنید');
      if (f.grossKg != null) throw new DispatchRuleError('وزن پر قبلاً ثبت شده است');
      return;
    case 'FINAL_CHECK':
      if (f.grossKg == null || f.netKg == null) throw new DispatchRuleError('ابتدا وزن پر (وزن خالص) باید ثبت شود');
      if (f.finalCheckResult === 'PASS') throw new DispatchRuleError('کنترل نهایی قبلاً تأیید شده است');
      assertFourEyes(f.loaderUserId, actorUserId);
      return;
    case 'READY':
      if (f.finalCheckResult !== 'PASS') throw new DispatchRuleError('ابتدا کنترل نهایی باید تأیید شود');
      if (f.readyGranted) throw new DispatchRuleError('مجوز آماده حرکت قبلاً صادر شده است');
      if (f.needsWeighing && !f.weightConfirmed) throw new DispatchRuleError('وزن نهایی هنوز تأیید نشده است');
      assertDocsGate(f.docsRequired, f.docsComplete, f.docsOverridden);
      return;
    case 'DEPART':
      if (!f.readyGranted) throw new DispatchRuleError('مجوز «آماده حرکت» هنوز صادر نشده است');
      if (f.departed) throw new DispatchRuleError('حرکت قبلاً ثبت شده است');
      if (f.receiptRequiredBeforeDeparture && !f.receiptDone && !f.receiptOverridden) throw new DispatchRuleError('رسید راننده هنوز امضا یا ثبت نشده است');
      return;
    case 'DELIVER':
      if (!f.departed && f.status !== 'IN_TRANSIT') throw new DispatchRuleError('بار هنوز در مسیر نیست');
      return;
  }
}

/** چشم دوم: کنترل‌کننده‌ی نهایی نباید همان بارگیرنده باشد. */
export function assertFourEyes(loaderUserId: string | null, checkerUserId: string | null): void {
  if (!checkerUserId) throw new DispatchRuleError('کنترل نهایی فقط با ورود یک کاربر واقعی ممکن است');
  if (loaderUserId && loaderUserId === checkerUserId) {
    throw new DispatchRuleError('کنترل نهایی باید توسط شخصی غیر از بارگیرنده انجام شود (اصل دو نفره)');
  }
}

/** دروازه‌ی «اسناد تکمیل است». */
export function assertDocsGate(docsRequired: boolean, docsComplete: boolean, overridden: boolean): void {
  if (docsRequired && !docsComplete && !overridden) {
    throw new DispatchRuleError('اسناد الزامی هنوز کامل نیست؛ سند را بارگذاری کنید یا با دسترسی مدیر و ثبت دلیل عبور دهید');
  }
}

export const MIN_REASON_LENGTH = 3;

export function assertReason(reason: string | null | undefined, what = 'این تغییر'): string {
  const r = (reason ?? '').trim();
  if (r.length < MIN_REASON_LENGTH) throw new DispatchRuleError(`برای ${what} ثبت دلیل الزامی است`);
  return r;
}

/** تغییر دستی وضعیت (با دلیل اجباری). SUSPENDED و CANCELLED هم از همین مسیر می‌آیند. */
export function validateManualChange(from: string, to: string, reason: string | null | undefined): string {
  if (!(SHIPMENT_STATUSES as readonly string[]).includes(to)) throw new DispatchRuleError('وضعیت مقصد نامعتبر است');
  if (TERMINAL_STATUSES.has(from)) throw new DispatchRuleError('بار بسته‌شده قابل تغییر وضعیت نیست');
  if (from === to) throw new DispatchRuleError('وضعیت جدید با وضعیت فعلی یکی است');
  if (to === 'DRAFT') throw new DispatchRuleError('بازگشت به «ثبت‌شده» مجاز نیست');
  return assertReason(reason, 'تغییر دستی وضعیت');
}
