import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { keyHint } from './license-key.js';

export type LicenseEventInput = {
  kind: 'ADMIN' | 'PUBLIC' | 'CHECKIN' | 'SYSTEM';
  action: string;
  licenseId?: string | null;
  licenseKey?: string | null;
  code?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown>;
};

/**
 * ثبت رویدادهای لایسنس — فقط افزودن (این کلاس عمداً هیچ متد update/delete ندارد).
 * شکست نوشتن هرگز درخواست را نمی‌شکند، ولی برای عملیات ادمین `recordStrict` وجود دارد تا بدون ردپا تغییری انجام نشود.
 * هرگز کلید کامل، راز یا اطلاعات شخصی در detail نوشته نمی‌شود (فقط hint ۸ نویسه‌ای).
 */
@Injectable()
export class LicenseAuditService {
  private readonly logger = new Logger('LicenseAudit');
  private sampleCounter = 0;

  constructor(private readonly db: ControlPrismaService) {}

  /** ردیف DB برای نوشتن داخل تراکنش فراخواننده (mutation + ردپا اتمیک). */
  rowOf(ev: LicenseEventInput) {
    return this.toRow(ev);
  }

  private toRow(ev: LicenseEventInput) {
    return {
      licenseId: ev.licenseId ?? null,
      licenseKeyHint: keyHint(ev.licenseKey),
      kind: ev.kind,
      action: ev.action,
      code: ev.code ?? null,
      actorId: ev.actorId ?? null,
      actorLabel: ev.actorLabel ?? null,
      ip: ev.ip ?? null,
      detail: (ev.detail ?? undefined) as never,
    };
  }

  async record(ev: LicenseEventInput): Promise<void> {
    try {
      await this.db.licenseEvent.create({ data: this.toRow(ev) });
    } catch (err) {
      this.logger.warn(`license event write failed: ${(err as Error).message}`);
    }
  }

  /** برای عملیات ادمین: اگر ثبت نشد خطا پرتاب می‌شود. */
  async recordStrict(ev: LicenseEventInput): Promise<void> {
    await this.db.licenseEvent.create({ data: this.toRow(ev) });
  }

  /** پاسخ‌های عمومی: همه‌ی شکست‌ها و فعال‌سازی/غیرفعال‌سازی ثبت می‌شود؛ verify/check-in موفق فقط ۱ از N. */
  shouldSample(everyN: number): boolean {
    this.sampleCounter = (this.sampleCounter + 1) % Math.max(1, everyN);
    return this.sampleCounter === 0;
  }

  /**
   * نگهداری: رویدادهای عمومی/check-in/سیستم بیش از ۹۰ روز پاک می‌شوند (جلوگیری از رشد بی‌کران با ترافیک عمومی).
   * رویدادهای ADMIN هرگز پاک نمی‌شوند.
   */
  @Cron('30 3 * * *')
  async purgeOldPublicEvents(retentionDays = Number(process.env.LICENSE_EVENT_RETENTION_DAYS) || 90): Promise<number> {
    try {
      const r = await this.db.licenseEvent.deleteMany({
        where: { kind: { in: ['PUBLIC', 'CHECKIN', 'SYSTEM'] }, createdAt: { lt: new Date(Date.now() - retentionDays * 86_400_000) } },
      });
      return r.count;
    } catch (err) {
      this.logger.warn(`license event purge failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
