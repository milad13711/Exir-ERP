import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

/**
 * ثبت اولین رویداد قیف (null → سرنخ جدید) برای مخاطبی که خارج از مسیر اصلی CRM ساخته شده
 * (فرم عمومی، گارانتی، همگام‌سازی معرفی، ورود اکسل). بدون وابستگی به DI تا هر سرویسی
 * بتواند مستقیم صدا بزند. شکست آن هرگز ساخت مخاطب را خراب نمی‌کند.
 */
export async function logInitialFunnelEvent(db: Pick<TenantPrismaClient, 'crmFunnelStageEvent'>, contactId: string): Promise<void> {
  try {
    await db.crmFunnelStageEvent.create({ data: { contactId, fromStage: null, toStage: 'NEW_LEAD' } });
  } catch {
    /* قیف نباید ساخت مخاطب را مختل کند */
  }
}
