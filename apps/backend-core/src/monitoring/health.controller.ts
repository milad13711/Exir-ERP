import { Controller, Get, Header, HttpException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

/**
 * GET /api/health — هدف پایش بیرونی (UptimeRobot/BetterStack/…). بدون احراز هویت و بدون هیچ اطلاعات حساسی:
 * فقط {"ok":true} وقتی بک‌اند بالا و دیتابیس کنترل پاسخگوست. نتیجه ۱۰ ثانیه کش می‌شود تا
 * فراخوانی زیاد هرگز به DB فشار نیاورد. کلیدواژه‌ی پایش: "ok":true
 */
@Controller('health')
export class HealthController {
  private cache: { at: number; ok: boolean } | null = null;
  constructor(private readonly db: ControlPrismaService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async health() {
    const now = Date.now();
    if (!this.cache || now - this.cache.at > 10_000) {
      let ok = false;
      try {
        await Promise.race([this.db.$queryRawUnsafe('SELECT 1'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
        ok = true;
      } catch {
        ok = false;
      }
      this.cache = { at: now, ok };
    }
    if (!this.cache.ok) throw new HttpException({ ok: false }, 503);
    return { ok: true };
  }
}
