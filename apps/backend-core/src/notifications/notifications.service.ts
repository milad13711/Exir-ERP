import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { EmailService } from '../email/email.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { PushNotificationsService, type PushSendSummary } from './push-notifications.service.js';
import { SMS_FALLBACK_COOLDOWN_MS, SMS_FALLBACK_DAILY_CAP, claimKey, smsDailyCap, smsText, tehranDateKey, categoryForType, isCriticalType, normalizeCategory, planDelivery, shouldSmsFallback, type NotificationCategory } from './push-logic.js';

export type NotifyInput = {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** رونوشت ایمیل — فقط وقتی کانال ایمیل برای این کاربر فعال و پیکربندی‌شده باشد ارسال می‌شود. */
  emailCc?: string[];
  /**
   * انتخاب صریح کانال‌های بیرونی؛ اگر مقدار بدهند جایگزین ترجیح‌های کاربر می‌شود
   * (مثلاً یادآوری تقویم: فقط همان کانالی که کاربر انتخاب کرده). بدون آن رفتار قبلی حفظ می‌شود.
   */
  channels?: { push?: boolean; email?: boolean; sms?: boolean };
  /** موجودیت مرتبط (task/reminder/letter/…) — در ردیف اعلان ذخیره و به هندلرهای «تحویل» داده می‌شود. */
  entityType?: string;
  entityId?: string;
  /** دسته‌ی اعلان؛ بدون آن از روی پیشوند type حدس زده می‌شود. */
  category?: NotificationCategory;
  /** حیاتی (آلارم موعد/امنیتی): از ساعات سکوت معاف، urgency بالا، requireInteraction. */
  critical?: boolean;
  /** مهم (وظیفه‌ی فوری، درخواست امضا): اگر پوش نرسید و پیامک جایگزین روشن بود، یک پیامک می‌رود. */
  important?: boolean;
  /** محرمانه: متن واقعی فقط درون‌برنامه؛ پوش/ایمیل/پیامک متن عمومی دارند. */
  confidential?: boolean;
  tag?: string;
  actions?: { action: string; title: string }[];
};

const CONFIDENTIAL_TITLE = 'اعلان جدید';
const CONFIDENTIAL_BODY = 'برای مشاهده وارد برنامه شوید';

/**
 * The single entry point every module calls to notify a tenant user —
 * always records an in-app row, and additionally sends push/email/SMS per the user's
 * preferences (category × channel, quiet hours; critical types bypass quiet hours).
 * Missing config or a delivery failure never blocks the in-app notification or the
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
    try {
      const category = normalizeCategory(input.category) ?? categoryForType(input.type);
      const critical = isCriticalType(input.type, input.critical);
      const preference = await tenantDb.notificationPreference.findUnique({ where: { userId: input.userId } }).catch(() => null);
      const plan = planDelivery(preference, { category, critical, channels: input.channels });

      const row = await tenantDb.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
          entityType: input.entityType,
          entityId: input.entityId,
          category,
          // درون‌برنامه برای این دسته خاموش است: ردیف برای تاریخچه/ack می‌ماند ولی «نخوانده» نیست
          readAt: plan.inApp ? null : new Date(),
        },
      });

      // اعلان درون‌برنامه ثبت شد؛ کانال‌های بیرونی (پوش/ایمیل/پیامک) در پس‌زمینه و موازی می‌روند تا
      // کندی SMTP یا درگاه پیامک نه پاسخ درخواست را عقب بیندازد و نه پوش را دیر برساند.
      void this.deliverExternal(tenantDb, input, { notificationId: row.id, category, critical, plan, preference }).catch((err) =>
        this.logger.warn(`External notification delivery failed for ${input.userId}: ${err instanceof Error ? err.message : err}`),
      );
    } catch (err) {
      // هرگز به فراخواننده پرتاب نمی‌شود: عملیات اصلی او (مثلاً ساخت وظیفه) نباید به‌خاطر اعلان شکست بخورد
      this.logger.warn(`notify() failed for ${input.userId} (${input.type}): ${err instanceof Error ? err.message : err}`);
    }
  }

  private async deliverExternal(
    tenantDb: TenantPrismaClient,
    input: NotifyInput,
    ctx: { notificationId: string; category: NotificationCategory; critical: boolean; plan: ReturnType<typeof planDelivery>; preference: Awaited<ReturnType<TenantPrismaClient['notificationPreference']['findUnique']>> },
  ): Promise<void> {
    const { plan, preference } = ctx;
    const title = input.confidential ? CONFIDENTIAL_TITLE : input.title;
    const body = input.confidential ? CONFIDENTIAL_BODY : (input.body ?? '');

    const badgeCount = await tenantDb.notification.count({ where: { userId: input.userId, readAt: null } }).catch(() => undefined);
    const emptySummary: PushSendSummary = { pushId: ctx.notificationId, total: 0, sent: 0, failed: 0, results: [], skipped: 'disabled' };
    const pushPromise: Promise<PushSendSummary> = plan.push
      ? this.push.sendToTenantUser(
          tenantDb,
          input.userId,
          {
            title,
            body,
            url: input.link,
            tag: input.tag,
            actions: input.actions,
            requireInteraction: ctx.critical ? true : undefined,
            renotify: input.tag ? ctx.critical : undefined,
            silentIfVisible: !ctx.critical,
            entityType: input.entityType,
            entityId: input.entityId,
            badgeCount,
          },
          { category: ctx.category, critical: ctx.critical, notificationId: ctx.notificationId },
        )
      : Promise.resolve(emptySummary);

    const user = await tenantDb.user.findUnique({ where: { id: input.userId } });
    if (!user) {
      await pushPromise;
      return;
    }

    const emailEnabled = input.channels?.email ?? preference?.emailEnabled ?? true;

    const emailPromise =
      emailEnabled && user.email && this.email.isConfigured()
        ? this.email
            .sendEmail(
              user.email,
              title,
              `<div dir="rtl" style="font-family: Tahoma, sans-serif;"><p>${escapeHtml(title)}</p>${body ? `<p>${escapeHtml(body)}</p>` : ''}</div>`,
              input.emailCc?.length ? { cc: input.emailCc } : undefined,
            )
            .then((result) => {
              if (!result.success) this.logger.warn(`Email notification failed for ${user.id}: ${result.error}`);
            })
        : Promise.resolve();

    const smsPromise =
      plan.sms && user.phone
        ? this.claimSlot(tenantDb, user.id, 'sms', smsDailyCap(), ctx.notificationId).then(async (claimed) => {
            if (!claimed) {
              this.logger.warn(`SMS daily cap reached for ${user.id}`);
              return;
            }
            const result = await this.sms.sendSms({ tenantDb }, user.phone!, smsText(title));
            if (!result.success) this.logger.warn(`SMS notification failed for ${user.id}: ${result.error}`);
          })
        : Promise.resolve();

    const [pushResult] = await Promise.allSettled([pushPromise, emailPromise, smsPromise]);

    // پیامک جایگزین: فقط اعلان «مهم»، فقط اگر پوش به هیچ دستگاهی نرسید، فقط اگر کاربر روشن کرده (پیش‌فرض خاموش)
    const important = ctx.critical || Boolean(input.important);
    if (plan.sms || !important || !preference?.smsFallbackEnabled || !user.phone) return;
    if (plan.quiet && !ctx.critical) return;
    const pushOk = pushResult.status === 'fulfilled' && pushResult.value.sent > 0;
    if (pushOk) return;
    try {
      const last = await tenantDb.pushAttempt.findFirst({ where: { userId: user.id, channel: 'sms', claimKey: { startsWith: 'smsfb' } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (!shouldSmsFallback({ enabled: true, important, pushOk, smsInLast24h: 0, lastSmsAt: last?.createdAt ?? null })) return;
      // claim اتمیک (unique) پیش از ارسال: cooldown (یک پنجره‌ی ۱۰دقیقه‌ای) و سقف روزانه (۳ جایگاه) — رقابت هم‌زمان پیامک دوبل نمی‌فرستد
      const now = Date.now();
      const cd = await this.tryClaim(tenantDb, { userId: user.id, pushId: ctx.notificationId, key: claimKey('smsfb-cd', user.id, Math.floor(now / SMS_FALLBACK_COOLDOWN_MS)), category: ctx.category });
      if (!cd) return;
      const slot = await this.claimSlot(tenantDb, user.id, 'smsfb', SMS_FALLBACK_DAILY_CAP, ctx.notificationId);
      if (!slot) return;
      const result = await this.sms.sendSms({ tenantDb }, user.phone, smsText(title));
      await tenantDb.pushAttempt.updateMany({ where: { claimKey: slot }, data: { status: result.success ? 'sent' : 'failed', reason: result.success ? 'sms_fallback' : String(result.error ?? 'sms_failed').slice(0, 200) } });
    } catch (err) {
      this.logger.warn(`SMS fallback failed for ${user.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** درج اتمیک یک ردیف claim (کلید یکتا)؛ تکراری ⇒ false. */
  private async tryClaim(tenantDb: TenantPrismaClient, a: { userId: string; pushId: string; key: string; category: string }): Promise<boolean> {
    try {
      await tenantDb.pushAttempt.create({ data: { userId: a.userId, pushId: a.pushId, category: a.category, channel: 'sms', status: 'claimed', reason: 'claim', claimKey: a.key } });
      return true;
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'P2002') return false;
      throw err;
    }
  }

  /** جایگاه روزانه (۱..cap) برای هر کاربر؛ کلید claim برگردانده می‌شود یا null وقتی سقف پر است. */
  private async claimSlot(tenantDb: TenantPrismaClient, userId: string, kind: 'sms' | 'smsfb', cap: number, pushId: string): Promise<string | null> {
    const day = tehranDateKey(new Date());
    for (let i = 1; i <= cap; i++) {
      const key = claimKey(kind, userId, day, i);
      if (await this.tryClaim(tenantDb, { userId, pushId, key, category: 'system' })) return key;
    }
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
