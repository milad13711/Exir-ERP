import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { verifyAckToken } from './push-logic.js';
import { ackKey } from './push-tokens.js';

export type DeliveryVia = 'push' | 'in-app' | 'socket';

export type DeliveryEvent = {
  tenantId?: string;
  userId: string;
  notificationId: string;
  entityType?: string | null;
  entityId?: string | null;
  link?: string | null;
};
export type DeliveryHandler = (evt: DeliveryEvent) => Promise<void>;

/**
 * قرارداد «تحویل» اعلان: وقتی اعلان واقعاً به دستگاه/برنامه‌ی کاربر رسید (ack پوش از سرویس‌ورکر، دریافت در زنگوله یا سوکت)،
 * Notification.deliveredAt یک‌بار ثبت می‌شود و هندلرهای ثبت‌شده (مثلاً تیک خاکستریِ وظایف) صدا زده می‌شوند.
 * idempotent: هر اعلان حداکثر یک‌بار «تحویل» حساب می‌شود و هندلرها فقط برای همان بار اجرا می‌شوند.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger('NotificationDeliveryService');
  private readonly handlers: DeliveryHandler[] = [];

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /** ثبت هندلر؛ تابع لغو ثبت را برمی‌گرداند. */
  registerHandler(handler: DeliveryHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** تعداد اعلان‌هایی که برای اولین‌بار «تحویل‌شده» شدند. */
  async markDelivered(tenantDb: TenantPrismaClient, userId: string, notificationIds: string[], via: DeliveryVia, tenantId?: string): Promise<number> {
    const ids = [...new Set(notificationIds.filter((x) => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, 100);
    if (ids.length === 0) return 0;
    const now = new Date();
    let newly = 0;
    try {
      // ردیف ارسال پوش (برای پیام‌هایی که اعلان درون‌برنامه ندارند، مثل پیام‌رسان) — هرگز نباید خطا بدهد
      await tenantDb.pushAttempt.updateMany({ where: { userId, pushId: { in: ids }, deliveredAt: null, channel: 'push' }, data: { deliveredAt: now } }).catch(() => undefined);
      const rows = await tenantDb.notification.findMany({
        where: { id: { in: ids }, userId, deliveredAt: null },
        select: { id: true, entityType: true, entityId: true, link: true },
      });
      for (const row of rows) {
        const claim = await tenantDb.notification.updateMany({ where: { id: row.id, userId, deliveredAt: null }, data: { deliveredAt: now, deliveredVia: via } });
        if (claim.count !== 1) continue; // نمونه‌ی دیگری زودتر ثبت کرد
        newly++;
        await this.runHandlers({ tenantId, userId, notificationId: row.id, entityType: row.entityType, entityId: row.entityId, link: row.link });
      }
    } catch (err) {
      this.logger.warn(`markDelivered failed: ${err instanceof Error ? err.message : err}`);
    }
    return newly;
  }

  private async runHandlers(evt: DeliveryEvent): Promise<void> {
    for (const h of [...this.handlers]) {
      try {
        await h(evt);
      } catch (err) {
        this.logger.warn(`delivery handler failed for ${evt.notificationId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /** ack بدون احراز هویت (از سرویس‌ورکر): توکن HMAC امضاشده. هیچ‌وقت خطا/اوراکل نمی‌دهد. */
  async ackByToken(token: unknown): Promise<void> {
    try {
      const key = ackKey();
      if (!key) return;
      const claims = verifyAckToken(token, key);
      if (!claims) return;
      const tenant = await this.controlDb.tenant.findFirst({ where: { dbName: claims.t } });
      if (!tenant || tenant.status !== 'ACTIVE') return;
      const db = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
      await this.markDelivered(db, claims.u, [claims.n], 'push', tenant.id);
    } catch (err) {
      this.logger.warn(`ack failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
