import { Injectable, Logger } from '@nestjs/common';

const BAHA24_BASE_URL = 'https://baha24.com/api';
const CACHE_TTL_MS = 60 * 60 * 1000; // یک ساعت — از فشار زیاد روی baha24 جلوگیری می‌کند، برای قیمت‌گذاری بازاریابی نیازی به لحظه‌به‌لحظه نیست.

/** فقط یک زیرمجموعه‌ی extractRate در exchange-rates.service.ts — همان منطق دفاعی، چون فرمت واقعی پاسخ baha24 مستند نیست. */
function extractRate(payload: unknown): number | null {
  const tryNumber = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };
  const direct = tryNumber(payload);
  if (direct !== null) return direct;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['price', 'value', 'rate', 'sell', 'toman', 'amount']) {
      const found = tryNumber(obj[key]);
      if (found !== null) return found;
    }
    if (obj.data) return extractRate(obj.data);
  }
  return null;
}

export type ExchangeRateResult = { usdToToman: number; asOf: string; source: 'baha24' | 'fallback' };

/**
 * نرخ لحظه‌ای دلار برای قیمت‌گذاری زنده‌ی صفحه‌ی بازاریابی — عمداً جدا از
 * ExchangeRatesService (که سطح تننت است و روی Currency هر تننت می‌نویسد).
 * بدون BAHA24_API_KEY یا در صورت خطا، یک نرخ مرجع قابل‌تنظیم با متغیر محیطی
 * برمی‌گرداند — هرگز خطا نمی‌دهد، چون این فقط برای نمایش قیمت است، نه یک
 * تراکنش مالی واقعی.
 */
@Injectable()
export class PublicExchangeRateService {
  private readonly logger = new Logger('PublicExchangeRateService');
  private cached: { result: ExchangeRateResult; expiresAt: number } | null = null;

  private fallbackRate(): number {
    return Number(process.env.USD_TOMAN_FALLBACK_RATE) || 950000;
  }

  async getUsdToToman(): Promise<ExchangeRateResult> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.result;

    const apiKey = process.env.BAHA24_API_KEY;
    if (apiKey) {
      try {
        const res = await fetch(`${BAHA24_BASE_URL}/v1/price/USD`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          const rate = extractRate(await res.json());
          if (rate !== null) {
            const result: ExchangeRateResult = { usdToToman: rate, asOf: new Date().toISOString(), source: 'baha24' };
            this.cached = { result, expiresAt: Date.now() + CACHE_TTL_MS };
            return result;
          }
        }
        this.logger.warn(`baha24 USD rate fetch not usable (HTTP ${res.status})`);
      } catch (err) {
        this.logger.warn(`baha24 USD rate fetch failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    const result: ExchangeRateResult = { usdToToman: this.fallbackRate(), asOf: new Date().toISOString(), source: 'fallback' };
    this.cached = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  }
}
