import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { CorrespondenceCoreService } from './correspondence-core.service.js';
import { DUE_SOON_MS, OPEN_INCOMING, classifyReferral, classifyResponseDue } from './reminder-select.js';

/**
 * یادآوری‌ها (هر ساعت، روی همه‌ی تننت‌های دارای ماژول): ارجاع نزدیک/گذشته از مهلت و مهلت پاسخ نامه‌ی وارده.
 * Idempotent: ارجاع‌ها با dueNotifiedAt/overdueNotifiedAt، نامه‌ها با رویداد REMINDER (note=نوع) — تکرار اجرا اعلان تکراری نمی‌سازد.
 */
@Injectable()
export class CorrespondenceCronService {
  private readonly logger = new Logger('CorrespondenceCron');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly core: CorrespondenceCoreService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      const installed = await this.controlDb.tenantModule.findFirst({
        where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'correspondence' } },
        select: { id: true },
      });
      if (!installed) continue;
      try {
        const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
        const ctx = { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
        await this.runForTenant(ctx, new Date());
      } catch (err) {
        this.logger.error(`Correspondence reminders failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  async runForTenant(ctx: TenantRequestContext, now: Date): Promise<{ referralsDue: number; referralsOverdue: number; responses: number }> {
    const db = ctx.tenantDb;
    let referralsDue = 0;
    let referralsOverdue = 0;
    const refs = await db.corrReferral.findMany({
      // فقط موردهایی که هنوز اعلان نگرفته‌اند + مرتب‌سازی پایدار → ردیف‌های قدیمی‌اعلان‌شده صف را گرسنه نمی‌کنند
      where: {
        kind: 'ACTION', status: { in: ['PENDING', 'SEEN'] }, dueAt: { lte: new Date(now.getTime() + DUE_SOON_MS) },
        OR: [{ dueNotifiedAt: null }, { overdueNotifiedAt: null }], letter: { status: { not: 'VOID' }, archivedAt: null },
      },
      include: { letter: { select: { id: true, subject: true, letterNumber: true, confidentiality: true } } },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    for (const r of refs) {
      const c = classifyReferral(r, now);
      if (!c) continue;
      // علامت‌گذاری پیش از ارسال و شرطی: اجرای هم‌زمان دوم، اعلان تکراری نمی‌فرستد
      const field = c === 'OVERDUE' ? 'overdueNotifiedAt' : 'dueNotifiedAt';
      const claim = await db.corrReferral.updateMany({ where: { id: r.id, [field]: null }, data: { [field]: now } });
      if (claim.count !== 1) continue;
      if (c === 'OVERDUE') {
        referralsOverdue++;
        await this.core.notify(ctx, [r.toUserId, r.fromUserId], 'مهلت یک ارجاع گذشته است', 'correspondence.referral_overdue', r.letter);
      } else {
        referralsDue++;
        await this.core.notify(ctx, [r.toUserId], 'مهلت یک ارجاع نزدیک است', 'correspondence.referral_due', r.letter);
      }
    }

    let responses = 0;
    const base = { type: 'INCOMING', status: { in: [...OPEN_INCOMING] as string[] }, archivedAt: null };
    const pick = { id: true, type: true, status: true, subject: true, letterNumber: true, confidentiality: true, responseDueAt: true, archivedAt: true, ownerUserId: true, createdByUserId: true } as const;
    // دو پرس‌وجوی جدا با شرط «هنوز یادآوری نشده» در خود DB (بدون گرسنگی)
    const [overdue, soon] = await Promise.all([
      db.corrLetter.findMany({ where: { ...base, responseDueAt: { lt: now }, events: { none: { type: 'REMINDER', note: 'RESPONSE_OVERDUE' } } }, select: pick, orderBy: [{ responseDueAt: 'asc' }, { id: 'asc' }], take: 300 }),
      db.corrLetter.findMany({ where: { ...base, responseDueAt: { gte: now, lte: new Date(now.getTime() + DUE_SOON_MS) }, events: { none: { type: 'REMINDER', note: 'RESPONSE_DUE' } } }, select: pick, orderBy: [{ responseDueAt: 'asc' }, { id: 'asc' }], take: 300 }),
    ]);
    for (const l of [...overdue, ...soon]) {
      const kind = classifyResponseDue({ ...l, sentReminders: [] }, now);
      if (!kind) continue;
      await this.core.logEvent(db, l.id, 'REMINDER', null, kind);
      responses++;
      await this.core.notify(ctx, [l.ownerUserId, l.createdByUserId], kind === 'RESPONSE_OVERDUE' ? 'مهلت پاسخ به یک نامه گذشته است' : 'مهلت پاسخ به یک نامه نزدیک است', 'correspondence.response_due', l);
    }

    // L6: نامه‌هایی که امضا شدند ولی ثبت مدرک امضا شکست خورد → یک‌بار هشدار به مدیران
    const pending = await db.corrEvent.findMany({ where: { type: 'EVIDENCE_PENDING', note: null }, select: { id: true, letterId: true }, orderBy: { createdAt: 'asc' }, take: 100 });
    if (pending.length) {
      const mgrs = await getManagerUsers(this.controlDb, db, ctx.tenantId).catch(() => []);
      for (const ev of pending) {
        const claim = await db.corrEvent.updateMany({ where: { id: ev.id, note: null }, data: { note: 'NOTIFIED' } });
        if (claim.count !== 1) continue;
        const letter = await db.corrLetter.findUnique({ where: { id: ev.letterId }, select: { id: true, subject: true, letterNumber: true, confidentiality: true } });
        if (letter) await this.core.notify(ctx, mgrs.map((m) => m.tenantUserId), 'مدرک امضای یک نامه ثبت نشد؛ بررسی لازم است', 'correspondence.evidence_pending', letter);
      }
    }
    return { referralsDue, referralsOverdue, responses };
  }
}
