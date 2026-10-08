import { Injectable } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

const ROW_ID = 'global';
const CACHE_MS = 5_000;

/**
 * «دوره‌ی نشست» سراسری: با بالا رفتنِ آن، همه‌ی توکن‌های صادرشده (tenant و admin) نامعتبر می‌شوند.
 * توکن‌ها نسخه‌ی مؤثر (epoch + tokenVersion تننت/عضو/ادمین) را در claim `tv` حمل می‌کنند؛
 * توکن بدون `tv` (صادرشده پیش از این قابلیت) نسخه ۰ حساب می‌شود، پس با اولین افزایش باطل می‌شود.
 * کش ۵ثانیه‌ای: روی هر درخواست یک کوئری اضافه نمی‌زند و در چند نمونه‌ی بک‌اند حداکثر ۵ ثانیه تأخیر دارد.
 */
@Injectable()
export class SessionEpochService {
  private cached: { value: number; at: number } | null = null;

  constructor(private readonly controlDb: ControlPrismaService) {}

  async current(): Promise<number> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < CACHE_MS) return this.cached.value;
    try {
      const row = await this.controlDb.securityState.findUnique({ where: { id: ROW_ID } });
      const value = row?.sessionEpoch ?? 0;
      this.cached = { value, at: now };
      return value;
    } catch (err) {
      // پیش از اجرای مایگریشن، جدول وجود ندارد: ۰ فرض می‌شود تا ورود قطع نشود (سازگار با استقرار مرحله‌ای)
      if (this.cached) return this.cached.value;
      return 0;
    }
  }

  /** نسخه‌ی مؤثر یک نشست tenant یا admin: مجموع epoch سراسری و نسخه‌های محلی؛ فقط افزایشی است. */
  async effective(...localVersions: Array<number | null | undefined>): Promise<number> {
    return (await this.current()) + localVersions.reduce<number>((a, b) => a + (b ?? 0), 0);
  }

  /** «خروج اجباری همه». نسخه‌ی جدید را برمی‌گرداند. */
  async bump(): Promise<number> {
    const row = await this.controlDb.securityState.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, sessionEpoch: 1 },
      update: { sessionEpoch: { increment: 1 } },
    });
    this.cached = { value: row.sessionEpoch, at: Date.now() };
    return row.sessionEpoch;
  }
}
