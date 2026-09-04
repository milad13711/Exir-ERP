import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

/**
 * Codes this system supports auto-updating — baha24.com's `GET
 * /v1/price/{symbol}` takes any uppercase symbol, so this is just the
 * subset we bother requesting (avoids one API call per obscure currency
 * code a tenant might add). Add a code here to support auto-updating it.
 */
const SUPPORTED_CODES = ['USD', 'EUR', 'GBP', 'AED', 'TRY', 'CNY'];

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
 * بدون BAHA24_API_KEY، این سرویس کاملاً غیرفعال می‌ماند (نه خطا، فقط
 * skip) — یعنی می‌تواند بدون کلید در پروداکشن دیپلوی و بعداً با افزودن
 * فقط یک متغیر محیطی فعال شود.
 */
@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger('ExchangeRatesService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  isConfigured(): boolean {
    return Boolean(process.env.BAHA24_API_KEY);
  }

  @Cron(CronExpression.EVERY_3_HOURS)
  async updateAllTenants(): Promise<void> {
    if (!this.isConfigured()) return;

    const rates = await this.fetchRates();
    if (Object.keys(rates).length === 0) {
      this.logger.warn('No rates fetched from baha24 this cycle — skipping tenant updates');
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

  /** One request per supported symbol — baha24 has no documented bulk endpoint field mapping we can rely on. */
  private async fetchRates(): Promise<Record<string, number>> {
    const apiKey = process.env.BAHA24_API_KEY;
    const rates: Record<string, number> = {};

    await Promise.all(
      SUPPORTED_CODES.map(async (code) => {
        try {
          const res = await fetch(`${BAHA24_BASE_URL}/v1/price/${code}`, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
          });
          if (!res.ok) {
            this.logger.warn(`baha24 HTTP ${res.status} for ${code}`);
            return;
          }
          const body = await res.json();
          const rate = extractRate(body);
          if (rate === null) {
            this.logger.warn(`Could not parse a rate for ${code} from baha24 response: ${JSON.stringify(body)}`);
            return;
          }
          rates[code] = rate;
        } catch (err) {
          this.logger.warn(`Failed fetching baha24 rate for ${code}: ${err instanceof Error ? err.message : err}`);
        }
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
