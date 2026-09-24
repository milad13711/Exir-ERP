import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { EmailService } from '../email/email.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { PushNotificationsService } from './push-notifications.service.js';

export type NotifyInput = {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** رونوشت ایمیل — فقط وقتی کانال ایمیل برای این کاربر فعال و پیکربندی‌شده باشد ارسال می‌شود. */
  emailCc?: string[];
};

/**
 * The single entry point every module calls to notify a tenant user —
 * always records an in-app row, and additionally sends email/SMS if the
 * user has that channel enabled (NotificationPreference, default: email on,
 * SMS off) and the corresponding service is actually configured. Missing
 * config or a delivery failure never blocks the in-app notification or the
 * caller's own operation — this always resolves, never throws.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');

  constructor(
    private readonly email: EmailService,
    private readonly sms: TenantSmsService,
    private readonly push: PushNotificationsService,
  ) {}

  async notify(tenantDb: TenantPrismaClient, input: NotifyInput): Promise<void> {
    await tenantDb.notification.create({
      data: { userId: input.userId, type: input.type, title: input.title, body: input.body, link: input.link },
    });

    // اعلان درون‌برنامه ثبت شد؛ کانال‌های بیرونی (پوش/ایمیل/پیامک) در پس‌زمینه و موازی می‌روند تا
    // کندی SMTP یا درگاه پیامک نه پاسخ درخواست را عقب بیندازد و نه پوش را دیر برساند.
    void this.deliverExternal(tenantDb, input).catch((err) =>
      this.logger.warn(`External notification delivery failed for ${input.userId}: ${err instanceof Error ? err.message : err}`),
    );
  }

  private async deliverExternal(tenantDb: TenantPrismaClient, input: NotifyInput): Promise<void> {
    const pushPromise = this.push.sendToTenantUser(tenantDb, input.userId, {
      title: input.title,
      body: input.body ?? '',
      url: input.link,
    });

    const [user, preference] = await Promise.all([
      tenantDb.user.findUnique({ where: { id: input.userId } }),
      tenantDb.notificationPreference.findUnique({ where: { userId: input.userId } }),
    ]);
    if (!user) {
      await pushPromise;
      return;
    }

    const emailEnabled = preference?.emailEnabled ?? true;
    const smsEnabled = preference?.smsEnabled ?? false;

    const emailPromise =
      emailEnabled && user.email && this.email.isConfigured()
        ? this.email
            .sendEmail(
              user.email,
              input.title,
              `<div dir="rtl" style="font-family: Tahoma, sans-serif;"><p>${input.title}</p>${input.body ? `<p>${input.body}</p>` : ''}</div>`,
              input.emailCc?.length ? { cc: input.emailCc } : undefined,
            )
            .then((result) => {
              if (!result.success) this.logger.warn(`Email notification failed for ${user.id}: ${result.error}`);
            })
        : Promise.resolve();

    const smsPromise =
      smsEnabled && user.phone
        ? this.sms
            .sendSms({ tenantDb }, user.phone, `${input.title}${input.body ? ` — ${input.body}` : ''}`)
            .then((result) => {
              if (!result.success) this.logger.warn(`SMS notification failed for ${user.id}: ${result.error}`);
            })
        : Promise.resolve();

    await Promise.allSettled([pushPromise, emailPromise, smsPromise]);
  }
}
