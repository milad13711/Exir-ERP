import { Injectable, Logger } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { getParentTenant } from '../common/parent-tenant.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import {
  clip,
  normalizeTicketAlertSettings,
    ticketAlertText,
  ticketLinkForStaff,
  TICKET_NOTIFY_TYPE,
  withinCooldown,
  type TicketAlertKind,
  type TicketAlertSettings,
} from './support-alerts.logic.js';

const SETTING = { moduleCode: 'platform', key: 'ticket-alerts' } as const;
const CLAIM = { moduleCode: 'platform' } as const;

type TicketRef = { id: string; tenantId: string; subject: string; createdByUserId: string };

const tehranDay = (now: Date) => new Date(now.getTime() + 12_600_000).toISOString().slice(0, 10);

/**
 * اعلان تیکت‌های پشتیبانی:
 *  - تیکت/پیام جدید مشتری → کارکنان تننت مادر (مالک/مدیر یا گیرنده‌های تنظیم‌شده): درون‌برنامه + پوش وب (روی موبایل) + پیامک.
 *  - پاسخ کارشناس → سازنده‌ی تیکت (درون‌برنامه + پوش).
 * همه‌ی متدها بی‌خطرند: هیچ‌وقت ثبت تیکت/پاسخ را خراب نمی‌کنند. dedupe و rate-limit روی دیتابیس تننت مادر ذخیره می‌شود (با ری‌استارت از بین نمی‌رود).
 */
@Injectable()
export class SupportAlertsService {
  private readonly logger = new Logger('SupportAlertsService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
    private readonly tenantSms: TenantSmsService,
    private readonly platformSms: ExirSmsService,
  ) {}

  async getSettings(tenantDb: TenantPrismaClient): Promise<TicketAlertSettings> {
    const row = await tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: SETTING } });
    return normalizeTicketAlertSettings(row?.value);
  }

  async saveSettings(tenantDb: TenantPrismaClient, input: unknown): Promise<TicketAlertSettings> {
    const value = normalizeTicketAlertSettings(input);
    await tenantDb.moduleSetting.upsert({ where: { moduleCode_key: SETTING }, create: { ...SETTING, value: value as never }, update: { value: value as never } });
    return value;
  }

  /** تیکت تازه ساخته شد (پیام اول مشتری). */
  async onTicketCreated(ticket: TicketRef, firstMessage: string): Promise<void> {
    await this.alertStaff('new', ticket, firstMessage).catch((e) => this.fail('onTicketCreated', e));
  }

  /** مشتری روی تیکت موجود پیام داد. */
  async onCustomerMessage(ticket: TicketRef, body: string, senderUserId?: string): Promise<void> {
    await this.alertStaff('reply', ticket, body, senderUserId).catch((e) => this.fail('onCustomerMessage', e));
  }

  /** کارشناس پاسخ داد یا تیکت را رفع کرد → سازنده‌ی تیکت خبردار شود. */
  async onStaffReply(ticket: TicketRef, body: string): Promise<void> {
    await this.alertCreator(ticket, body).catch((e) => this.fail('onStaffReply', e));
  }

  private fail(where: string, e: unknown) {
    this.logger.warn(`${where} failed: ${e instanceof Error ? e.message : e}`);
  }

  private async recipients(tenantDb: TenantPrismaClient, tenantId: string, settings: TicketAlertSettings, excludeGlobalUserId?: string) {
    const memberships = settings.roles.length
      ? await this.controlDb.tenantMembership.findMany({ where: { tenantId, role: { in: settings.roles }, status: 'ACTIVE' }, select: { globalUserId: true } })
      : [];
    const users = await tenantDb.user.findMany({
      where: {
        status: 'ACTIVE', // کاربر غیرفعال/دعوت‌نشده اعلان (و پیامک) نمی‌گیرد
        OR: [
          ...(memberships.length ? [{ globalUserId: { in: memberships.map((m) => m.globalUserId) } }] : []),
          ...(settings.extraUserIds.length ? [{ id: { in: settings.extraUserIds } }] : []),
        ],
      },
    });
    return users.filter((u) => !excludeGlobalUserId || u.globalUserId !== excludeGlobalUserId);
  }

  private async alertStaff(kind: TicketAlertKind, ticket: TicketRef, preview: string, senderUserId?: string): Promise<{ notified: number; sms: number } | null> {
    const parent = await getParentTenant(this.controlDb, this.tenantPrisma);
    if (!parent) return null;
    const db = parent.tenantDb;
    const settings = await this.getSettings(db);
    if (!settings.enabled) return null;
    if (Math.random() < 0.02) void this.cleanup(db);

    const tenant = await this.controlDb.tenant.findUnique({ where: { id: ticket.tenantId }, select: { name: true } });
    const text = ticketAlertText(kind, { tenantName: tenant?.name ?? '', subject: ticket.subject, preview, ticketId: ticket.id });
    const link = ticketLinkForStaff(ticket.id);
    const now = new Date();
    const hour = now.toISOString().slice(0, 13);

    // سقف ساعتی هر تننت و هر کاربر (شمارنده‌ی اتمیک با ردیف یکتا)؛ بالاتر از سقف: فقط پوش، بدون پیامک
    const isNew = kind === 'new';
    const sender = senderUserId ?? ticket.createdByUserId;
    const tenantOk = await this.claimSlot(db, `tk:rate:${hour}:t:${ticket.tenantId}:${kind}`, isNew ? settings.tenantTicketsPerHour : settings.tenantMessagesPerHour);
    const userOk = await this.claimSlot(db, `tk:rate:${hour}:u:${sender}:${kind}`, isNew ? settings.userTicketsPerHour : settings.userMessagesPerHour);
    const overLimit = !tenantOk || !userOk;

    // کاربر خودِ تننت مادر که تیکت را زده، برای تیکتِ خودش اعلان نمی‌گیرد
    const users = await this.recipients(db, parent.tenantId, settings, sender);

    if (overLimit && (await this.claimOnce(db, `tk:abuse:${hour}:${ticket.tenantId}`))) {
      for (const u of users) {
        await this.notifications.notify(db, {
          userId: u.id,
          type: TICKET_NOTIFY_TYPE.abuse,
          title: 'ترافیک غیرعادی تیکت',
          body: `تعداد تیکت/پیام‌های «${clip(tenant?.name ?? '', 60)}» از سقف ساعتی گذشت؛ پیامک این تیکت‌ها تا ساعت بعد متوقف است.`,
          link: '/platform?tab=tickets',
          channels: { push: settings.push, email: false, sms: false },
        });
      }
    }

    let notified = 0;
    let smsSent = 0;
    for (const u of users) {
      if (kind === 'new') {
        // dedupe اتمیک «تیکت جدید»: ردیف یکتا به‌ازای (تیکت، گیرنده)
        if (!(await this.claimOnce(db, `tk:new:${ticket.id}:${u.id}`))) continue;
      } else {
        const last = await db.notification.findFirst({
          where: { userId: u.id, link, type: { in: [TICKET_NOTIFY_TYPE.new, TICKET_NOTIFY_TYPE.reply] } },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        if (withinCooldown(last?.createdAt, now, settings.replyCooldownSec)) continue;
      }

      await this.notifications.notify(db, {
        userId: u.id,
        type: TICKET_NOTIFY_TYPE[kind],
        title: text.title,
        body: text.body,
        link,
        channels: { push: settings.push, email: false, sms: false },
      });
      notified++;

      if (!overLimit && u.phone && settings.sms && (await this.claimSlot(db, `tk:sms:${tehranDay(now)}:${u.id}`, settings.smsDailyCap))) {
        if (await this.sendStaffSms(parent, u.phone, text.sms)) smsSent++;
      }
    }
    return { notified, sms: smsSent };
  }

  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
  }

  /** ثبت اتمیک یک کلید یکتا؛ false = قبلاً ثبت شده. */
  private async claimOnce(db: TenantPrismaClient, key: string): Promise<boolean> {
    try {
      await db.moduleSetting.create({ data: { ...CLAIM, key, value: {} } });
      return true;
    } catch (e) {
      if (this.isUnique(e)) return false;
      throw e;
    }
  }

  /** گرفتن یک «جایگاه» از سقف: ردیف‌های prefix:0..limit-1 با کلید یکتا؛ اتمیک و مستقل از ری‌استارت. */
  private async claimSlot(db: TenantPrismaClient, prefix: string, limit: number): Promise<boolean> {
    for (let n = 0; n < limit; n++) if (await this.claimOnce(db, `${prefix}:${n}`)) return true;
    return false;
  }

  private async cleanup(db: TenantPrismaClient): Promise<void> {
    await db.moduleSetting
      .deleteMany({ where: { moduleCode: CLAIM.moduleCode, key: { startsWith: 'tk:' }, updatedAt: { lt: new Date(Date.now() - 3 * 86_400_000) } } })
      .catch(() => undefined);
  }

  /** پنل پیامکِ خودِ تننت مادر اگر متصل است؛ وگرنه پنل سیستمی پلتفرم (این پیامک عملیاتیِ صاحب پلتفرم است). */
  private async sendStaffSms(parent: { tenantId: string; tenantDb: TenantPrismaClient }, phone: string, message: string): Promise<boolean> {
    try {
      const conn = await this.tenantSms.getConnection(parent.tenantDb);
      const result =
        conn.mode === 'NONE'
          ? this.platformSms.isConfigured()
            ? await this.platformSms.sendSms(phone, message, { tenantId: parent.tenantId, source: 'PLATFORM' })
            : ({ success: false, error: 'no sms panel' } as const)
          : await this.tenantSms.sendSms(parent, phone, message, { purpose: 'support-ticket-alert', moduleCode: 'support' });
      if (!result.success) this.logger.warn(`Ticket alert SMS failed: ${result.error}`);
      return result.success;
    } catch (e) {
      this.fail('sendStaffSms', e);
      return false;
    }
  }

  private async alertCreator(ticket: TicketRef, body: string): Promise<void> {
    const parent = await getParentTenant(this.controlDb, this.tenantPrisma);
    const settings = parent ? await this.getSettings(parent.tenantDb) : null;
    if (settings && !settings.notifyCreatorOnReply) return;

    const tenant = await this.controlDb.tenant.findUnique({ where: { id: ticket.tenantId } });
    if (!tenant) return;
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    const user = await tenantDb.user.findUnique({ where: { globalUserId: ticket.createdByUserId } });
    if (!user) return;

    const link = `/support?ticket=${ticket.id}`;
    const cooldown = settings?.replyCooldownSec ?? 120;
    const last = await tenantDb.notification.findFirst({
      where: { userId: user.id, type: TICKET_NOTIFY_TYPE.staffReply, link },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (withinCooldown(last?.createdAt, new Date(), cooldown)) return;

    await this.notifications.notify(tenantDb, {
      userId: user.id,
      type: TICKET_NOTIFY_TYPE.staffReply,
      title: 'پشتیبانی به تیکت شما پاسخ داد',
      body: `${clip(ticket.subject, 60)}: ${clip(body, 140)}`,
      link,
      channels: { push: true, email: false, sms: false },
    });
  }
}
