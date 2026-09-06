import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

/**
 * Codes this system supports auto-updating, mapped to their tgju.org free-
 * market indicator slug. tgju needs no API key and returns a live rate in
 * Rial (hence ÷10 for Toman in fetchTgjuRate) — same source wired into
 * PublicExchangeRateService for the marketing site. Add a code here (and
 * its tgju slug) to support auto-updating it.
 */
const TGJU_SLUGS: Record<string, string> = {
  USD: 'price_dollar_rl',
  EUR: 'price_eur',
  GBP: 'price_gbp',
  AED: 'price_aed',
  TRY: 'price_try',
  CNY: 'price_cny',
};
const SUPPORTED_CODES = Object.keys(TGJU_SLUGS);

const BAHA24_BASE_URL = 'https://baha24.com/api';

/**
 * baha24.com's own OpenAPI spec documents the 200 response body only as
 * `{ type: "string" }` — no field names are published, and we have no API
 * key yet to test a real response. So the numeric rate is extracted
 * defensively: if the payload is itself a number/numeric string, use it;
 * otherwise search one level of common key names. If neither works, this
 * currency's update is skipped (logged) rather than silently writing a
 * garbage rate — worth revisiting with a real response sample once
 * BAHA24_API_KEY is actually set.
 */
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

/**
 * به‌روزرسانی دوره‌ای نرخ ارزهایی که تننت صریحاً autoUpdate را برایشان
 * فعال کرده — همان کاری که BillingDunningService برای یادآوری تمدید
 * می‌کند: یک cron در سطح کنترل‌پلین که روی دیتابیس هر تننت وصل می‌شود.
 * منبع اصلی tgju.org است (بدون نیاز به کلید، همیشه فعال)؛ baha24 فقط اگر
 * BAHA24_API_KEY تنظیم شده باشد، برای ارزهایی که tgju نتوانست پاسخ بدهد،
 * به‌عنوان جایگزین دوم امتحان می‌شود.
 */
@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger('ExchangeRatesService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /** همیشه true است چون tgju نیازی به کلید ندارد — برای سازگاری با کد/مستندات قدیمی نگه داشته شده. */
  isConfigured(): boolean {
    return true;
  }

  @Cron(CronExpression.EVERY_3_HOURS)
  async updateAllTenants(): Promise<void> {
    const rates = await this.fetchRates();
    if (Object.keys(rates).length === 0) {
      this.logger.warn('No rates fetched this cycle — skipping tenant updates');
      return;
    }

    const tenants = await this.controlDb.tenant.findMany({
      where: {
        status: 'ACTIVE',
        tenantModules: { some: { status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'currency-exchange' } } },
      },
      select: { id: true, dbHost: true, dbPort: true, dbName: true },
    });

    for (const tenant of tenants) {
      try {
        await this.updateOneTenant(tenant, rates);
      } catch (err) {
        this.logger.warn(`Failed updating currencies for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async fetchTgjuRate(code: string): Promise<number | null> {
    const slug = TGJU_SLUGS[code];
    if (!slug) return null;
    try {
      const res = await fetch(`https://api.tgju.org/v1/market/indicator/profile/${slug}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        this.logger.warn(`tgju HTTP ${res.status} for ${code}`);
        return null;
      }
      const body = (await res.json()) as { response?: { summary?: { price?: { plain?: unknown } } } };
      const rial = extractRate(body.response?.summary?.price?.plain);
      return rial !== null ? rial / 10 : null;
    } catch (err) {
      this.logger.warn(`tgju fetch failed for ${code}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private async fetchBaha24Rate(code: string): Promise<number | null> {
    const apiKey = process.env.BAHA24_API_KEY;
    if (!apiKey) return null;
    try {
      const res = await fetch(`${BAHA24_BASE_URL}/v1/price/${code}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        this.logger.warn(`baha24 HTTP ${res.status} for ${code}`);
        return null;
      }
      const rate = extractRate(await res.json());
      if (rate === null) this.logger.warn(`Could not parse a rate for ${code} from baha24 response`);
      return rate;
    } catch (err) {
      this.logger.warn(`Failed fetching baha24 rate for ${code}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** tgju اول امتحان می‌شود (بدون کلید)؛ فقط اگر شکست خورد و کلید baha24 تنظیم شده، آن را جایگزین می‌کند. */
  private async fetchRates(): Promise<Record<string, number>> {
    const rates: Record<string, number> = {};

    await Promise.all(
      SUPPORTED_CODES.map(async (code) => {
        const tgjuRate = await this.fetchTgjuRate(code);
        if (tgjuRate !== null) {
          rates[code] = tgjuRate;
          return;
        }
        const baha24Rate = await this.fetchBaha24Rate(code);
        if (baha24Rate !== null) rates[code] = baha24Rate;
      }),
    );

    return rates;
  }

  private async updateOneTenant(
    tenant: { id: string; dbHost: string; dbPort: number; dbName: string },
    rates: Record<string, number>,
  ): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant(tenant);
    const currencies = await tenantDb.currency.findMany({ where: { autoUpdate: true } });

    for (const currency of currencies) {
      const newRate = rates[currency.code];
      if (newRate === undefined) continue;

      await tenantDb.currency.update({
        where: { id: currency.id },
        data: { rate: newRate, lastAutoRateAt: new Date() },
      });
    }
  }
}
