import { Injectable, Logger } from '@nestjs/common';

const BAHA24_BASE_URL = 'https://baha24.com/api';
// نرخ آزاد دلار (price_dollar_rl) — بدون نیاز به کلید، همیشه به‌روز است.
// دقت شد که «سنا» (سامانه نرخ رسمی/توافقی بانک مرکزی، api.tgju.org/v1/data/sana/json
// و /v1/market/indicator/*/sana_buy_usd) از دی ۱۴۰۴ دیگر داده‌ی جدید برنمی‌گرداند
// (احتمالاً سامانه‌ی سنا در این بازه‌ی زمانی متوقف/جایگزین شده) — پس برای نرخ
// لحظه‌ای واقعاً زنده، نرخ بازار آزاد تنها گزینه‌ی معتبرِ در دسترس از tgju است.
// واحد پاسخ tgju ریال است (نه تومان) — تقسیم بر ۱۰ لازم است.
const TGJU_PROFILE_URL = 'https://api.tgju.org/v1/market/indicator/profile/price_dollar_rl';
const CACHE_TTL_MS = 30 * 60 * 1000; // نیم ساعت — نرخ بازار آزاد نوسان روزانه دارد، کش طولانی‌تر نرخ قدیمی نشان می‌دهد.

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

export type ExchangeRateResult = { usdToToman: number; asOf: string; source: 'tgju' | 'baha24' | 'fallback' };

/**
 * نرخ لحظه‌ای دلار برای قیمت‌گذاری زنده‌ی صفحه‌ی بازاریابی — عمداً جدا از
 * ExchangeRatesService (که سطح تننت است و روی Currency هر تننت می‌نویسد).
 * اولویت با tgju (نرخ بازار آزاد، بدون کلید)، سپس baha24 (اگر BAHA24_API_KEY
 * تنظیم شده)، و در نهایت یک نرخ ثابتِ قابل‌تنظیم با متغیر محیطی — هرگز خطا
 * نمی‌دهد، چون این فقط برای نمایش قیمت است، نه یک تراکنش مالی واقعی.
 */
@Injectable()
export class PublicExchangeRateService {
  private readonly logger = new Logger('PublicExchangeRateService');
  private cached: { result: ExchangeRateResult; expiresAt: number } | null = null;

  private fallbackRate(): number {
    return Number(process.env.USD_TOMAN_FALLBACK_RATE) || 227000;
  }

  private async fetchTgju(): Promise<number | null> {
    try {
      const res = await fetch(TGJU_PROFILE_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        this.logger.warn(`tgju USD rate fetch not usable (HTTP ${res.status})`);
        return null;
      }
      const body = (await res.json()) as { response?: { summary?: { price?: { plain?: unknown } } } };
      const rial = extractRate(body.response?.summary?.price?.plain);
      return rial !== null ? rial / 10 : null;
    } catch (err) {
      this.logger.warn(`tgju USD rate fetch failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private async fetchBaha24(): Promise<number | null> {
    const apiKey = process.env.BAHA24_API_KEY;
    if (!apiKey) return null;
    try {
      const res = await fetch(`${BAHA24_BASE_URL}/v1/price/USD`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        this.logger.warn(`baha24 USD rate fetch not usable (HTTP ${res.status})`);
        return null;
      }
      return extractRate(await res.json());
    } catch (err) {
      this.logger.warn(`baha24 USD rate fetch failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  async getUsdToToman(): Promise<ExchangeRateResult> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.result;

    const tgjuRate = await this.fetchTgju();
    if (tgjuRate !== null) {
      const result: ExchangeRateResult = { usdToToman: tgjuRate, asOf: new Date().toISOString(), source: 'tgju' };
      this.cached = { result, expiresAt: Date.now() + CACHE_TTL_MS };
      return result;
    }

    const baha24Rate = await this.fetchBaha24();
    if (baha24Rate !== null) {
      const result: ExchangeRateResult = { usdToToman: baha24Rate, asOf: new Date().toISOString(), source: 'baha24' };
      this.cached = { result, expiresAt: Date.now() + CACHE_TTL_MS };
      return result;
    }

    const result: ExchangeRateResult = { usdToToman: this.fallbackRate(), asOf: new Date().toISOString(), source: 'fallback' };
    this.cached = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  }
}
