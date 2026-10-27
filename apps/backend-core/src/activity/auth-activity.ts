import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { maskIp } from './activity-redact.util.js';
import { summarizeDevice } from './user-activity.logic.js';

export type AuthActivityMeta = { ip?: string | null; userAgent?: string | null };

/**
 * ثبت رویدادهای ورود/امنیت در لاگ فعالیتِ تننت (برای آرشیو فعالیت کاربر). مسیر /auth از AuditInterceptor مستثنی است،
 * پس اینجا صریح ثبت می‌شود. IP ماسک و UA فقط به‌صورت «مرورگر · سیستم‌عامل» ذخیره می‌شود. هرگز خطا نمی‌دهد.
 */
export async function recordAuthActivity(
  db: TenantPrismaClient,
  globalUserId: string,
  ev: { action: 'auth.login' | 'auth.2fa_enabled' | 'auth.2fa_disabled'; summary: string; actionType?: string } & AuthActivityMeta,
): Promise<void> {
  try {
    const user = await db.user.findUnique({ where: { globalUserId }, select: { id: true } });
    if (!user) return;
    const device = summarizeDevice(ev.userAgent);
    await db.activityLog.create({
      data: {
        userId: user.id,
        actorType: 'MANUAL',
        moduleCode: 'auth',
        actionType: ev.actionType ?? (ev.action === 'auth.login' ? 'login' : 'other'),
        action: ev.action,
        entityType: 'User',
        entityId: user.id,
        summary: ev.summary,
        ip: maskIp(ev.ip),
        metadata: { src: 'auth', ...(device ? { device } : {}) } as never,
      },
    });
  } catch {
    /* هرگز ورود را خراب نکن */
  }
}
