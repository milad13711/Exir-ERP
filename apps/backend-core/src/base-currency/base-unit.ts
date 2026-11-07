import { BadRequestException } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { presetOf, reduce, scaleExact, type Rational } from './rational.js';

/** واحد پول پایه‌ی یک محیط کاری. پیش‌فرض (بدون هیچ ردیفی): تومان. */
export type BaseCurrencyState = {
  code: string;
  label: string;
  /** هر ۱ واحد پایه چند تومان است (ریال = ۱/۱۰) — برای درگاه‌های پرداخت و سامانه‌ی مودیان */
  tomanPerUnit: Rational;
  changedAt: string | null;
  conversionId: string | null;
};

export const BASE_CURRENCY_MODULE = 'currency-exchange';
export const BASE_CURRENCY_KEY = 'baseCurrency';

export const DEFAULT_BASE_CURRENCY: BaseCurrencyState = {
  code: 'IRT',
  label: 'تومان',
  tomanPerUnit: { num: 1n, den: 1n },
  changedAt: null,
  conversionId: null,
};

type Db = Pick<TenantPrismaClient, 'moduleSetting'>;

// کوتاه: در چندپروسه‌ای، پروسه‌ی دیگر تبدیل را اجرا کرده و کش این پروسه را نمی‌شناسد. مسیرهای حساس (درگاه) fresh می‌خوانند.
const CACHE_MS = 5_000;
const cache = new WeakMap<object, { at: number; value: BaseCurrencyState }>();

export function parseBaseCurrency(raw: unknown): BaseCurrencyState {
  if (!raw || typeof raw !== 'object') return DEFAULT_BASE_CURRENCY;
  const v = raw as Record<string, unknown>;
  const code = typeof v.code === 'string' && /^[A-Z]{3,4}$/.test(v.code) ? v.code : null;
  const label = typeof v.label === 'string' && v.label.trim() ? v.label.trim().slice(0, 20) : null;
  if (!code || !label) return DEFAULT_BASE_CURRENCY;
  let tpu: Rational;
  try {
    tpu = reduce({ num: BigInt(String(v.tomanPerUnitNum ?? '1')), den: BigInt(String(v.tomanPerUnitDen ?? '1')) });
    if (tpu.num <= 0n || tpu.den <= 0n) throw new Error('bad');
  } catch {
    tpu = presetOf(code)?.tomanPerUnit ?? { num: 1n, den: 1n };
  }
  return {
    code,
    label,
    tomanPerUnit: tpu,
    changedAt: typeof v.changedAt === 'string' ? v.changedAt : null,
    conversionId: typeof v.conversionId === 'string' ? v.conversionId : null,
  };
}

export function serializeBaseCurrency(s: BaseCurrencyState) {
  return {
    code: s.code,
    label: s.label,
    tomanPerUnitNum: s.tomanPerUnit.num.toString(),
    tomanPerUnitDen: s.tomanPerUnit.den.toString(),
    changedAt: s.changedAt,
    conversionId: s.conversionId,
  };
}

/** ارز پایه‌ی فعلی تننت (با کش کوتاه‌مدت روی خودِ کلاینت). هرگز خطا نمی‌دهد: خطا ⇒ تومان. */
export async function loadBaseCurrency(db: Db, opts: { fresh?: boolean } = {}): Promise<BaseCurrencyState> {
  if (!db || typeof db !== 'object') return DEFAULT_BASE_CURRENCY;
  const hit = cache.get(db);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value = DEFAULT_BASE_CURRENCY;
  try {
    const row = await db.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: BASE_CURRENCY_MODULE, key: BASE_CURRENCY_KEY } } });
    value = parseBaseCurrency(row?.value);
  } catch {
    value = DEFAULT_BASE_CURRENCY;
  }
  cache.set(db, { at: Date.now(), value });
  return value;
}

export function invalidateBaseCurrency(db: object): void {
  cache.delete(db);
}

/** برچسب واحد برای چاپ (PDF، پیامک، MCP). */
export async function loadUnitLabel(db: Db): Promise<string> {
  return (await loadBaseCurrency(db)).label;
}

/**
 * مبلغ به واحد پایه → تومان صحیح برای درگاه (زرین‌پال/بیت‌پی همیشه تومان می‌گیرند و خودشان ×۱۰ می‌کنند).
 * اگر مبلغ تومان کامل نشود (مثلاً ریالِ ۱۲۳۴۵) خطا می‌دهد، نه گرد‌کردن بی‌صدا.
 */
export function toGatewayToman(amount: number, state: BaseCurrencyState): number {
  if (!Number.isInteger(amount) || amount < 0) throw new BadRequestException('مبلغ پرداخت نامعتبر است');
  const t = scaleExact(BigInt(amount), state.tomanPerUnit);
  if (t === null) throw new BadRequestException(`مبلغ پرداخت آنلاین باید مضرب کامل تومان باشد (${state.label})`);
  if (t > BigInt(Number.MAX_SAFE_INTEGER)) throw new BadRequestException('مبلغ پرداخت بیش از حد بزرگ است');
  return Number(t);
}
