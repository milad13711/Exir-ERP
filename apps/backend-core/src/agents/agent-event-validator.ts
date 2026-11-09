/**
 * اعتبارسنجی سخت‌گیرانه‌ی رویدادهای ورودی (کلیدهای ناشناخته رد می‌شوند، همه‌ی طول‌ها محدودند).
 * خروجی: رویداد نرمال‌شده یا لیست خطاهای فارسی. بدون وابستگی خارجی.
 */
import { normalizeIranMobile } from './agent-phone.js';
import { MAX_EVENT_AMOUNT, SUPPORTED_EVENT_CURRENCIES } from './agent-money.js';
import { netFrom, TX_OCCURRENCES } from './agent-commission.js';

export const EVENT_TYPES = ['customer.registered', 'subscription.activated', 'subscription.renewed', 'subscription.cancelled', 'payment.refunded', 'transaction.recorded'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type NormalizedEvent =
  | { eventId: string; type: 'customer.registered'; occurredAt: Date; data: { referralCode: string; externalCustomerId: string; name: string; phone: string | null; email: string | null } }
  | { eventId: string; type: 'subscription.activated' | 'subscription.renewed'; occurredAt: Date; data: SubscriptionData }
  | { eventId: string; type: 'subscription.cancelled'; occurredAt: Date; data: { externalCustomerId: string; reason: string | null } }
  | { eventId: string; type: 'payment.refunded'; occurredAt: Date; data: { externalCustomerId: string | null; paymentRef: string; amount: number; currency: string } }
  | { eventId: string; type: 'transaction.recorded'; occurredAt: Date; data: TransactionData };

/** هر تراکنش مالی محصول (خرید اشتراک/ماژول، تمدید، بسته، بازپرداخت…) — همه به دفتر مرکزی می‌آیند. مبالغ به ارز `currency`. */
export type TransactionData = {
  transactionId: string;
  externalCustomerId: string;
  /** کد نوع تراکنش نزد محصول، مثلاً SUBSCRIPTION | MODULE | SMS_PACKAGE | REFUND */
  txType: string;
  /** کد قلم فروخته‌شده، مثلاً crm؛ تهی = بدون قلم مشخص */
  itemCode: string | null;
  itemName: string | null;
  /** صریح از محصول؛ وگرنه ERP از سابقه‌ی همین مشتری/قلم تشخیص می‌دهد */
  occurrence: 'FIRST' | 'RENEWAL' | 'ONE_OFF' | null;
  grossAmount: number | null;
  discountAmount: number | null;
  taxAmount: number | null;
  /** مبنای پورسانت؛ اگر نیامد = ناخالص − تخفیف */
  netAmount: number;
  currency: string;
  paidAt: Date;
  periodEnd: Date | null;
  /** فقط برای بازپرداخت: transactionId تراکنش اصلی */
  refundOf: string | null;
};

export type SubscriptionData = {
  externalCustomerId: string;
  planCode: string;
  planName: string;
  amount: number;
  currency: string;
  paidAt: Date;
  periodEnd: Date;
  paymentRef: string;
  isTrial: boolean;
};

export type ValidationResult = { ok: true; event: NormalizedEvent } | { ok: false; errors: string[] };

const ID_RE = /^[A-Za-z0-9._:\-]{1,100}$/;
const CODE_RE = /^[A-Za-z0-9_\-]{2,40}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function unknownKeys(o: Obj, allowed: string[], path: string, errors: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errors.push(`فیلد ناشناخته: ${path}${k}`);
}
function str(o: Obj, k: string, path: string, errors: string[], opts: { min?: number; max: number; optional?: boolean; re?: RegExp }): string | null {
  const v = o[k];
  if (v === undefined || v === null) {
    if (!opts.optional) errors.push(`${path}${k} الزامی است`);
    return null;
  }
  if (typeof v !== 'string') {
    errors.push(`${path}${k} باید رشته باشد`);
    return null;
  }
  const t = v.trim();
  if (t.length < (opts.min ?? (opts.optional ? 0 : 1)) || t.length > opts.max) {
    errors.push(`${path}${k} طول نامعتبر دارد`);
    return null;
  }
  if (opts.re && !opts.re.test(t)) {
    errors.push(`${path}${k} قالب نامعتبر دارد`);
    return null;
  }
  return t === '' ? null : t;
}
function amountField(o: Obj, k: string, errors: string[]): number | null {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_EVENT_AMOUNT) {
    errors.push(`data.${k} باید عدد صحیح بین ۰ و ${MAX_EVENT_AMOUNT} باشد`);
    return null;
  }
  return v;
}
function currencyField(o: Obj, errors: string[]): string | null {
  const c = str(o, 'currency', 'data.', errors, { max: 8 });
  if (c && !SUPPORTED_EVENT_CURRENCIES.includes(c.toUpperCase())) {
    errors.push(`data.currency باید یکی از ${SUPPORTED_EVENT_CURRENCIES.join(' | ')} باشد`);
    return null;
  }
  return c ? c.toUpperCase() : null;
}
function dateField(o: Obj, k: string, path: string, errors: string[], optional = false): Date | null {
  const v = o[k];
  if (v === undefined || v === null) {
    if (!optional) errors.push(`${path}${k} الزامی است`);
    return null;
  }
  if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d{2}-\d{2}/.test(v)) {
    errors.push(`${path}${k} باید تاریخ ISO-8601 باشد`);
    return null;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    errors.push(`${path}${k} تاریخ نامعتبر است`);
    return null;
  }
  return d;
}

export function validateEvent(body: unknown, now = new Date()): ValidationResult {
  const errors: string[] = [];
  if (!isObj(body)) return { ok: false, errors: ['بدنه باید یک شیء JSON باشد'] };
  unknownKeys(body, ['eventId', 'type', 'occurredAt', 'data'], '', errors);
  const eventId = str(body, 'eventId', '', errors, { max: 100, re: ID_RE });
  const type = body.type;
  if (typeof type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(type)) errors.push(`type باید یکی از ${EVENT_TYPES.join(' | ')} باشد`);
  const occurredAt = dateField(body, 'occurredAt', '', errors, true) ?? now;
  if (occurredAt.getTime() > now.getTime() + 10 * 60_000) errors.push('occurredAt در آینده است');
  const data = body.data;
  if (!isObj(data)) {
    errors.push('data باید یک شیء باشد');
    return { ok: false, errors };
  }
  if (errors.length || !eventId || typeof type !== 'string') return { ok: false, errors };

  const ext = (opt = false) => str(data, 'externalCustomerId', 'data.', errors, { max: 100, re: ID_RE, optional: opt });
  switch (type as EventType) {
    case 'customer.registered': {
      unknownKeys(data, ['referralCode', 'externalCustomerId', 'name', 'phone', 'email'], 'data.', errors);
      const referralCode = str(data, 'referralCode', 'data.', errors, { max: 40, re: CODE_RE });
      const externalCustomerId = ext();
      const name = str(data, 'name', 'data.', errors, { min: 2, max: 120 });
      const rawPhone = str(data, 'phone', 'data.', errors, { max: 20, optional: true });
      const phone = rawPhone ? normalizeIranMobile(rawPhone) : null;
      if (rawPhone && !phone) errors.push('data.phone شماره‌ی موبایل معتبر نیست');
      const email = str(data, 'email', 'data.', errors, { max: 160, optional: true, re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ });
      if (errors.length) return { ok: false, errors };
      return { ok: true, event: { eventId, type: 'customer.registered', occurredAt, data: { referralCode: referralCode!.toUpperCase(), externalCustomerId: externalCustomerId!, name: name!, phone, email } } };
    }
    case 'subscription.activated':
    case 'subscription.renewed': {
      unknownKeys(data, ['externalCustomerId', 'planCode', 'planName', 'amount', 'currency', 'paidAt', 'periodEnd', 'paymentRef', 'isTrial'], 'data.', errors);
      const externalCustomerId = ext();
      const planCode = str(data, 'planCode', 'data.', errors, { max: 60, re: ID_RE });
      const planName = str(data, 'planName', 'data.', errors, { max: 120 });
      const amount = amountField(data, 'amount', errors);
      const currency = currencyField(data, errors);
      const paidAt = dateField(data, 'paidAt', 'data.', errors);
      const periodEnd = dateField(data, 'periodEnd', 'data.', errors);
      const paymentRef = str(data, 'paymentRef', 'data.', errors, { max: 100, re: ID_RE });
      let isTrial = false;
      if (data.isTrial !== undefined) {
        if (typeof data.isTrial !== 'boolean') errors.push('data.isTrial باید بولین باشد');
        else isTrial = data.isTrial;
      }
      if (paidAt && periodEnd && periodEnd.getTime() <= paidAt.getTime()) errors.push('data.periodEnd باید پس از paidAt باشد');
      if (isTrial === false && amount === 0) errors.push('پرداخت غیرآزمایشی نمی‌تواند مبلغ صفر باشد');
      if (errors.length) return { ok: false, errors };
      return { ok: true, event: { eventId, type: type as 'subscription.activated' | 'subscription.renewed', occurredAt, data: { externalCustomerId: externalCustomerId!, planCode: planCode!, planName: planName!, amount: amount!, currency: currency!, paidAt: paidAt!, periodEnd: periodEnd!, paymentRef: paymentRef!, isTrial } } };
    }
    case 'subscription.cancelled': {
      unknownKeys(data, ['externalCustomerId', 'reason'], 'data.', errors);
      const externalCustomerId = ext();
      const reason = str(data, 'reason', 'data.', errors, { max: 300, optional: true });
      if (errors.length) return { ok: false, errors };
      return { ok: true, event: { eventId, type: 'subscription.cancelled', occurredAt, data: { externalCustomerId: externalCustomerId!, reason } } };
    }
    case 'transaction.recorded': {
      unknownKeys(data, ['transactionId', 'externalCustomerId', 'txType', 'itemCode', 'itemName', 'occurrence', 'grossAmount', 'discountAmount', 'taxAmount', 'netAmount', 'currency', 'paidAt', 'periodEnd', 'refundOf'], 'data.', errors);
      const transactionId = str(data, 'transactionId', 'data.', errors, { max: 100, re: ID_RE });
      const externalCustomerId = ext();
      const txType = str(data, 'txType', 'data.', errors, { max: 40, re: CODE_RE });
      const itemCode = str(data, 'itemCode', 'data.', errors, { max: 60, re: ID_RE, optional: true });
      const itemName = str(data, 'itemName', 'data.', errors, { max: 120, optional: true });
      const occRaw = str(data, 'occurrence', 'data.', errors, { max: 10, optional: true });
      const occurrence = occRaw ? (occRaw.toUpperCase() as TransactionData['occurrence']) : null;
      if (occurrence && !(TX_OCCURRENCES as readonly string[]).includes(occurrence)) errors.push(`data.occurrence باید یکی از ${TX_OCCURRENCES.join(' | ')} باشد`);
      const opt = (k: string) => (data[k] === undefined || data[k] === null ? null : amountField(data, k, errors));
      const grossAmount = opt('grossAmount');
      const discountAmount = opt('discountAmount');
      const taxAmount = opt('taxAmount');
      const netRaw = opt('netAmount');
      const currency = currencyField(data, errors);
      const paidAt = dateField(data, 'paidAt', 'data.', errors);
      const periodEnd = dateField(data, 'periodEnd', 'data.', errors, true);
      const refundOf = str(data, 'refundOf', 'data.', errors, { max: 100, re: ID_RE, optional: true });
      const netAmount = netFrom({ netAmount: netRaw, grossAmount, discountAmount });
      if (netAmount === null) errors.push('یکی از data.netAmount یا data.grossAmount الزامی است');
      if (grossAmount !== null && discountAmount !== null && discountAmount > grossAmount) errors.push('data.discountAmount بیشتر از grossAmount است');
      if (netAmount === 0 && !refundOf) errors.push('مبلغ خالص تراکنش نمی‌تواند صفر باشد');
      if (refundOf && occurrence) errors.push('بازپرداخت occurrence ندارد');
      if (paidAt && periodEnd && periodEnd.getTime() <= paidAt.getTime()) errors.push('data.periodEnd باید پس از paidAt باشد');
      if (errors.length) return { ok: false, errors };
      return {
        ok: true,
        event: {
          eventId,
          type: 'transaction.recorded',
          occurredAt,
          data: { transactionId: transactionId!, externalCustomerId: externalCustomerId!, txType: txType!.toUpperCase(), itemCode, itemName, occurrence, grossAmount, discountAmount, taxAmount, netAmount: netAmount!, currency: currency!, paidAt: paidAt!, periodEnd, refundOf },
        },
      };
    }
    case 'payment.refunded': {
      unknownKeys(data, ['externalCustomerId', 'paymentRef', 'amount', 'currency'], 'data.', errors);
      const externalCustomerId = ext(true);
      const paymentRef = str(data, 'paymentRef', 'data.', errors, { max: 100, re: ID_RE });
      const amount = amountField(data, 'amount', errors);
      const currency = currencyField(data, errors);
      if (errors.length) return { ok: false, errors };
      return { ok: true, event: { eventId, type: 'payment.refunded', occurredAt, data: { externalCustomerId, paymentRef: paymentRef!, amount: amount!, currency: currency! } } };
    }
  }
  return { ok: false, errors: ['نوع رویداد ناشناخته'] };
}
