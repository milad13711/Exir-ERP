import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { fromTehran, tehranParts } from '../booking/tehran-time.js';
import { alertText, CATCH_UP_MS, dueAlerts, isMissed, nextOccurrence, SMS_DAILY_CAP_PER_USER, tehranHHmm, type ReminderLike } from './reminder-logic.js';

const MAX_LEAD_MS = 7 * 24 * 3600_000 + 60_000;

/**
 * آلارم یادآوری‌های تقویم (هر دقیقه، همه‌ی تننت‌های فعال):
 *  - هر پیش‌هشدار/آلارم اصلی با «claim» اتمیک روی alertsSentMin ثبت می‌شود → حتی با چند نمونه‌ی سرور یا
 *    ری‌استارت، هر آلارم حداکثر یک‌بار می‌رود (at-most-once).
 *  - جبران: آلارم اصلی تا ۱ ساعت پس از موعد (قطعی سرور) هنوز ارسال می‌شود؛ پس از آن فقط رخداد بعدیِ
 *    یادآوری‌های تکراری ساخته می‌شود (بدون اعلان کهنه).
 *  - رخداد بعدی تکرار هنگام آلارم اصلی (یا از دست‌رفته) یک‌بار با ساعت دیواریِ همان تهران ساخته می‌شود.
 * کانال‌ها: درون‌برنامه همیشه؛ پوش/ایمیل/پیامک فقط اگر کاربر انتخاب کرده؛ پیامک با سقف روزانه برای هر کاربر.
 */
@Injectable()
export class RemindersCronService {
  private readonly logger = new Logger('RemindersCronService');
  private running = false;

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('* * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
      for (const tenant of tenants) {
        try {
          const db = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
          await this.processTenant(db, tenant.id);
        } catch (err) {
          this.logger.error(`Reminders cron failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async processTenant(db: TenantPrismaClient, tenantId: string, now: Date = new Date()): Promise<{ fired: number; spawned: number; missed: number }> {
    const out = { fired: 0, spawned: 0, missed: 0 };
    const candidates = await db.dashboardReminder.findMany({
      where: {
        status: 'PENDING',
        remindAt: { not: null },
        OR: [
          { snoozedUntil: null, remindAt: { gte: new Date(now.getTime() - CATCH_UP_MS - 60_000), lte: new Date(now.getTime() + MAX_LEAD_MS) } },
          { snoozedUntil: { gte: new Date(now.getTime() - CATCH_UP_MS - 60_000), lte: now } },
        ],
      },
      orderBy: { remindAt: 'asc' },
      take: 500,
    });
    for (const r of candidates) {
      try {
        const offsets = dueAlerts(r as ReminderLike, now);
        for (const offset of offsets) {
          const claimed = await db.dashboardReminder.updateMany({
            where: { id: r.id, status: 'PENDING', NOT: { alertsSentMin: { has: offset } } },
            data: {
              alertsSentMin: { push: offset },
              ...(offset === 0 ? { lastFiredAt: now, ...(r.firedAt ? {} : { firedAt: now }) } : {}),
            },
          });
          if (claimed.count !== 1) continue; // نمونه‌ی دیگر/ری‌استارت قبلاً claim کرده است
          out.fired++;
          await this.deliver(db, tenantId, r, offset, now);
          if (offset === 0 && (await this.spawnNext(db, r, now))) out.spawned++;
        }
      } catch (err) {
        this.logger.error(`Reminder ${r.id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // رخدادهای تکراریِ از دست‌رفته (فراتر از پنجره‌ی جبران): بدون اعلان، فقط زنجیره ادامه پیدا کند.
    const missed = await db.dashboardReminder.findMany({
      where: {
        status: 'PENDING',
        snoozedUntil: null,
        repeatRule: { not: 'NONE' },
        nextSpawned: false,
        NOT: { alertsSentMin: { has: 0 } },
        remindAt: { lt: new Date(now.getTime() - CATCH_UP_MS), gt: new Date(now.getTime() - 45 * 24 * 3600_000) },
      },
      take: 100,
    });
    for (const r of missed) {
      if (!isMissed(r as ReminderLike, now)) continue;
      try {
        const claimed = await db.dashboardReminder.updateMany({
          where: { id: r.id, NOT: { alertsSentMin: { has: 0 } } },
          data: { alertsSentMin: { push: 0 } },
        });
        if (claimed.count !== 1) continue;
        out.missed++;
        if (await this.spawnNext(db, r, now)) out.spawned++;
      } catch (err) {
        this.logger.error(`Missed reminder ${r.id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return out;
  }

  private async deliver(db: TenantPrismaClient, tenantId: string, r: Awaited<ReturnType<TenantPrismaClient['dashboardReminder']['findMany']>>[number], offset: number, now: Date): Promise<void> {
    if (!r.createdByUserId) return;
    const wantsSms = r.channels.includes('SMS');
    let sms = false;
    if (wantsSms) {
      const { dateKey } = tehranParts(now);
      const dayStart = fromTehran(dateKey, 0);
      const sentToday = await db.dashboardReminder.count({ where: { createdByUserId: r.createdByUserId, smsSentAt: { gte: dayStart } } });
      sms = sentToday < SMS_DAILY_CAP_PER_USER;
      if (sms) await db.dashboardReminder.update({ where: { id: r.id }, data: { smsSentAt: now } });
    }
    const when = r.allDay ? 'امروز' : `ساعت ${tehranHHmm(r.snoozedUntil ?? r.remindAt ?? now)}`;
    await this.notifications.notify(db, {
      userId: r.createdByUserId,
      type: 'reminder.alarm',
      title: alertText(r.title, offset),
      body: r.note ? `${when} — ${r.note}` : when,
      link: `/dashboard?reminder=${r.id}`,
      entityType: 'reminder',
      entityId: r.id,
      category: 'reminders',
      critical: offset === 0,
      important: true,
      tag: `reminder-${r.id}`,
      actions: [
        { action: 'done', title: 'انجام شد' },
        { action: 'snooze', title: '۱۰ دقیقه دیگر' },
      ],
      channels: { push: r.channels.includes('PUSH'), email: r.channels.includes('EMAIL'), sms },
    });
    void tenantId;
  }

  /** رخداد بعدیِ تکرار؛ با claim اتمیک روی nextSpawned تا دوباره ساخته نشود. */
  async spawnNext(db: TenantPrismaClient, r: { id: string; remindAt: Date | null; repeatRule: string; nextSpawned: boolean }, now: Date): Promise<boolean> {
    if (r.repeatRule === 'NONE' || !r.remindAt) return false;
    const next = nextOccurrence(r.remindAt, r.repeatRule, now);
    if (!next) return false;
    return db.$transaction(async (tx) => {
      const claim = await tx.dashboardReminder.updateMany({ where: { id: r.id, nextSpawned: false }, data: { nextSpawned: true } });
      if (claim.count !== 1) return false;
      const src = await tx.dashboardReminder.findUnique({ where: { id: r.id } });
      if (!src) return false;
      await tx.dashboardReminder.create({
        data: {
          date: new Date(`${tehranParts(next).dateKey}T00:00:00.000Z`),
          remindAt: next,
          allDay: src.allDay,
          title: src.title,
          note: src.note,
          createdByUserId: src.createdByUserId,
          channels: src.channels,
          leadMinutes: src.leadMinutes,
          alertsSentMin: src.leadMinutes.filter((l) => l > 0 && next.getTime() - l * 60_000 <= now.getTime()),
          repeatRule: src.repeatRule,
          seriesId: src.seriesId ?? src.id,
        },
      });
      return true;
    });
  }
}
