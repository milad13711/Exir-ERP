import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { deriveModulePrices } from '../modules-catalog/module-license-usd.js';
import { PublicExchangeRateService } from './public-exchange-rate.service.js';

/**
 * قیمت تومانی ماژول‌ها (ModuleDefinition.priceMonthly/priceYearly) را از روی قیمت پایه‌ی دلاری
 * (licenseUsd) و نرخ روز دلار همگام نگه می‌دارد تا فروشگاه ماژول، فاکتورها، تمدیدها و سایت بازاریابی
 * یک قیمت واحد داشته باشند. روی استارت و روزانه اجرا می‌شود؛ ادمین هم می‌تواند دستی اجرا کند.
 */
@Injectable()
export class ModulePricingSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger('ModulePricingSync');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly rate: PublicExchangeRateService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.syncAll().catch((err) => this.logger.warn(`initial pricing sync failed: ${err instanceof Error ? err.message : err}`));
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async daily(): Promise<void> {
    await this.syncAll().catch((err) => this.logger.warn(`daily pricing sync failed: ${err instanceof Error ? err.message : err}`));
  }

  async syncAll(): Promise<{ updated: number; usdToToman: number }> {
    const { usdToToman } = await this.rate.getUsdToToman();
    const modules = await this.controlDb.moduleDefinition.findMany({ where: { licenseUsd: { gt: 0 } } });
    let updated = 0;
    for (const m of modules) {
      const p = deriveModulePrices(m.licenseUsd, usdToToman);
      if (m.priceMonthly !== p.monthly || m.priceYearly !== p.yearly) {
        await this.controlDb.moduleDefinition.update({ where: { code: m.code }, data: { priceMonthly: p.monthly, priceYearly: p.yearly } });
        updated++;
      }
    }
    if (updated > 0) this.logger.log(`Module prices synced for ${updated} modules @ ${usdToToman} Toman/USD`);
    return { updated, usdToToman };
  }
}
