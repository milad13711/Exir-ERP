/**
 * موتور پورسانت (خالص، بدون وابستگی به DB): انتخاب قانون، تشخیص «اول/تمدید» و محاسبه‌ی مبلغ با حساب صحیح.
 *
 * قانون: محصول × سطح × نوع تراکنش × قلم × دفعه → درصد از «مبلغ خالص» (بعد از تخفیف، بدون مالیات).
 * تهی بودن نوع/قلم و occurrence=ANY یعنی «هر». در تطبیق، قانون خاص‌تر برنده است؛ در تساوی، جدیدترین effectiveFrom.
 */

export const RULE_OCCURRENCES = ['FIRST', 'RENEWAL', 'ANY'] as const;
export type RuleOccurrence = (typeof RULE_OCCURRENCES)[number];
export const TX_OCCURRENCES = ['FIRST', 'RENEWAL', 'ONE_OFF'] as const;
export type TxOccurrence = (typeof TX_OCCURRENCES)[number] | 'REFUND';

export type PlanRuleLike = {
  id: string;
  level: string;
  txTypeCode: string | null;
  itemCode: string | null;
  occurrence: string;
  percent: number;
  effectiveFrom: Date;
  endedAt: Date | null;
  createdAt?: Date;
};

export type TxFacts = { level: string; txTypeCode: string; itemCode: string | null; occurrence: TxOccurrence; at: Date };

/** آیا قانون در لحظه‌ی at معتبر است (effectiveFrom ≤ at < endedAt). */
export function isRuleActiveAt(r: Pick<PlanRuleLike, 'effectiveFrom' | 'endedAt'>, at: Date): boolean {
  return r.effectiveFrom.getTime() <= at.getTime() && (!r.endedAt || r.endedAt.getTime() > at.getTime());
}

function matches(r: PlanRuleLike, f: TxFacts): boolean {
  if (r.level !== f.level) return false;
  if (r.txTypeCode !== null && r.txTypeCode !== f.txTypeCode) return false;
  if (r.itemCode !== null && r.itemCode !== f.itemCode) return false;
  if (r.occurrence !== 'ANY' && r.occurrence !== f.occurrence) return false;
  return true;
}

/** امتیاز خاص‌بودن: نوع تراکنش (۴) > قلم (۲) > دفعه (۱). */
export function specificity(r: Pick<PlanRuleLike, 'txTypeCode' | 'itemCode' | 'occurrence'>): number {
  return (r.txTypeCode !== null ? 4 : 0) + (r.itemCode !== null ? 2 : 0) + (r.occurrence !== 'ANY' ? 1 : 0);
}

/** قانونِ حاکم بر یک تراکنش، یا null. بازپرداخت هیچ‌وقت قانون نمی‌گیرد (برگشت از پورسانت اصلی محاسبه می‌شود). */
export function pickPlanRule<T extends PlanRuleLike>(rules: T[], f: TxFacts): T | null {
  if (f.occurrence === 'REFUND') return null;
  let best: T | null = null;
  for (const r of rules) {
    if (!isRuleActiveAt(r, f.at) || !matches(r, f)) continue;
    if (!best) {
      best = r;
      continue;
    }
    const d = specificity(r) - specificity(best);
    if (d > 0) best = r;
    else if (d === 0) {
      const t = r.effectiveFrom.getTime() - best.effectiveFrom.getTime();
      if (t > 0 || (t === 0 && (r.createdAt?.getTime() ?? 0) > (best.createdAt?.getTime() ?? 0))) best = r;
    }
  }
  return best;
}

/** درصد با حداکثر دو رقم اعشار → مبلغ صحیح (رو به پایین)، بدون خطای اعشاری. */
export function commissionAmount(baseAmount: number, percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0 || !Number.isInteger(baseAmount) || baseAmount <= 0) return 0;
  const bp = BigInt(Math.round(percent * 100)); // صدم درصد
  return Number((BigInt(baseAmount) * bp) / 10_000n);
}

/** مبلغ خالص: اگر ارسال نشده، ناخالص − تخفیف (مالیات هرگز جزو مبنا نیست). */
export function netFrom(input: { netAmount?: number | null; grossAmount?: number | null; discountAmount?: number | null }): number | null {
  if (typeof input.netAmount === 'number') return input.netAmount;
  if (typeof input.grossAmount === 'number') return Math.max(0, input.grossAmount - (input.discountAmount ?? 0));
  return null;
}

/** «اول» اگر این مشتری برای همین قلم/نوع تراکنش پرداخت قبلی ندارد؛ در غیر این صورت «تمدید». مقدار صریح محصول مقدم است. */
export function deriveOccurrence(provided: TxOccurrence | null | undefined, priorPayments: number): TxOccurrence {
  if (provided) return provided;
  return priorPayments === 0 ? 'FIRST' : 'RENEWAL';
}

/**
 * سهم برگشتی از یک پورسانت بابت بازپرداخت جزئی/کامل: متناسب با مبلغ بازپرداخت، و هرگز بیش از مانده‌ی برگشت‌نخورده.
 * خروجی عددی نامنفی (در دفتر با علامت منفی ثبت می‌شود).
 */
export function reversalAmount(credit: number, alreadyReversed: number, originalNet: number, refundNet: number): number {
  if (credit <= 0 || originalNet <= 0 || refundNet <= 0) return 0;
  const remaining = Math.max(0, credit - alreadyReversed);
  const prop = Number((BigInt(credit) * BigInt(Math.min(refundNet, originalNet))) / BigInt(originalNet));
  return Math.min(remaining, prop);
}

/** کیف پول: جمع پورسانت‌ها به تفکیک «قابل تسویه» (availableAt گذشته) و «در انتظار». برگشت‌ها همیشه فوری کم می‌شوند. */
export function walletBalances(rows: Array<{ amount: number; availableAt: Date }>, now = new Date()): { available: number; held: number; total: number } {
  let available = 0;
  let held = 0;
  for (const r of rows) {
    if (r.amount < 0 || r.availableAt.getTime() <= now.getTime()) available += r.amount;
    else held += r.amount;
  }
  return { available, held, total: available + held };
}

// ── تسویه ────────────────────────────────────────────────
export const PAYOUT_STATUSES = ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
/** درخواست‌های «در جریان» مبلغشان را از موجودی قابل تسویه رزرو می‌کنند. */
export const OPEN_PAYOUT_STATUSES: readonly PayoutStatus[] = ['REQUESTED', 'APPROVED'];

export type WalletSummary = {
  /** پورسانت آزادشده (پس از مهلت نگهداری) منهای برگشت‌ها */
  earnedAvailable: number;
  /** پورسانت در مهلت نگهداری */
  held: number;
  /** کل پورسانت خالص (آزاد + در انتظار) */
  totalEarned: number;
  /** رزرو برای درخواست‌های تسویه‌ی در جریان */
  pending: number;
  /** تسویه‌شده (پرداخت قطعی) */
  paid: number;
  /** قابل درخواست تسویه = آزاد − در جریان − پرداخت‌شده (ممکن است منفی باشد: برگشت پس از پرداخت) */
  withdrawable: number;
};

export function walletSummary(
  commissions: Array<{ amount: number; availableAt: Date }>,
  payouts: Array<{ amount: number; status: string }>,
  now = new Date(),
): WalletSummary {
  const b = walletBalances(commissions, now);
  let pending = 0;
  let paid = 0;
  for (const p of payouts) {
    if ((OPEN_PAYOUT_STATUSES as readonly string[]).includes(p.status)) pending += p.amount;
    else if (p.status === 'PAID') paid += p.amount;
  }
  return { earnedAvailable: b.available, held: b.held, totalEarned: b.total, pending, paid, withdrawable: b.available - pending - paid };
}

export type PayoutCheck = {
  amount: number;
  withdrawable: number;
  minAmount: number;
  membershipStatus: string;
  hasOpenPayout: boolean;
  shebaVerified: boolean;
};

/** دلیل ردِ درخواست تسویه (کد + پیام فارسی) یا null اگر مجاز است. */
export function payoutRejection(c: PayoutCheck): { code: string; message: string } | null {
  if (!Number.isSafeInteger(c.amount) || c.amount <= 0) return { code: 'INVALID_AMOUNT', message: 'مبلغ تسویه باید عدد صحیح مثبت باشد' };
  if (c.membershipStatus !== 'ACTIVE' && c.membershipStatus !== 'ENDED') return { code: 'MEMBERSHIP_NOT_ELIGIBLE', message: 'عضویت در این وضعیت امکان تسویه ندارد' };
  if (!c.shebaVerified) return { code: 'SHEBA_NOT_VERIFIED', message: 'ابتدا شماره‌ی شبا را ثبت و با پیامک تأیید کنید' };
  if (c.hasOpenPayout) return { code: 'OPEN_PAYOUT_EXISTS', message: 'یک درخواست تسویه‌ی در جریان دارید؛ تا نتیجه‌ی آن صبر کنید' };
  if (c.amount < c.minAmount) return { code: 'BELOW_MINIMUM', message: `حداقل مبلغ تسویه ${c.minAmount.toLocaleString('en-US')} است` };
  if (c.amount > c.withdrawable) return { code: 'INSUFFICIENT_BALANCE', message: 'مبلغ از موجودی قابل تسویه بیشتر است' };
  return null;
}

/** گذارهای مجاز وضعیت تسویه. */
export function canTransitionPayout(from: string, to: PayoutStatus): boolean {
  switch (to) {
    case 'APPROVED':
      return from === 'REQUESTED';
    case 'PAID':
      return from === 'APPROVED';
    case 'REJECTED':
      return from === 'REQUESTED' || from === 'APPROVED';
    case 'CANCELLED':
      return from === 'REQUESTED';
    default:
      return false;
  }
}

/** لینک معرفی کارت ویزیت: قالب محصول با {code}، وگرنه websiteUrl?ref=code. فقط http(s). */
export function referralUrl(template: string | null | undefined, websiteUrl: string | null | undefined, code: string | null | undefined): string | null {
  if (!code) return null;
  const enc = encodeURIComponent(code);
  let url: string | null = null;
  if (template && template.includes('{code}')) url = template.split('{code}').join(enc);
  else if (websiteUrl) {
    try {
      const u = new URL(websiteUrl);
      u.searchParams.set('ref', code);
      url = u.toString();
    } catch {
      url = null;
    }
  }
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
