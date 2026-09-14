import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { EmailService } from '../email/email.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';

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
    private readonly sms: ExirSmsService,
  ) {}

  async notify(tenantDb: TenantPrismaClient, input: NotifyInput): Promise<void> {
    await tenantDb.notification.create({
      data: { userId: input.userId, type: input.type, title: input.title, body: input.body, link: input.link },
    });

    const [user, preference] = await Promise.all([
      tenantDb.user.findUnique({ where: { id: input.userId } }),
      tenantDb.notificationPreference.findUnique({ where: { userId: input.userId } }),
    ]);
    if (!user) return;

    const emailEnabled = preference?.emailEnabled ?? true;
    const smsEnabled = preference?.smsEnabled ?? false;

    if (emailEnabled && user.email && this.email.isConfigured()) {
      const result = await this.email.sendEmail(
        user.email,
        input.title,
        `<div dir="rtl" style="font-family: Tahoma, sans-serif;"><p>${input.title}</p>${input.body ? `<p>${input.body}</p>` : ''}</div>`,
        input.emailCc?.length ? { cc: input.emailCc } : undefined,
      );
      if (!result.success) this.logger.warn(`Email notification failed for ${user.id}: ${result.error}`);
    }

    if (smsEnabled && user.phone && this.sms.isConfigured()) {
      const result = await this.sms.sendSms(user.phone, `${input.title}${input.body ? ` — ${input.body}` : ''}`);
      if (!result.success) this.logger.warn(`SMS notification failed for ${user.id}: ${result.error}`);
    }
  }
}
