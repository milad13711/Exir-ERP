import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { isModuleEnabled } from '../common/module-enabled.util.js';
import {
  DELIVERY_CHANNEL,
  RELEASE_PREFS_KEY,
  SMS_MAX_RECIPIENTS_PER_TENANT,
  SMS_TENANT_DAILY_CAP,
  buildSmsText,
  isRetryable,
  normalizeChannels,
  normalizePrefs,
  notificationText,
  releaseLink,
  releasePath,
  tehranDay,
  ticketText,
  type ChannelSelection,
  type CleanChange,
  type DeliveryStatus,
  type ReleaseChannel,
  type TenantReleasePrefs,
} from './module-release.logic.js';

type ReleaseRow = { id: string; shortCode: string; moduleCode: string; version: string; title: string; summary: string };
type TenantRow = { id: string; slug: string; name: string; dbHost: string; dbPort: number; dbName: string };
type Outcome = { status: DeliveryStatus; sent: number; failed: number; reason?: string; ticketId?: string };
export type FanoutSummary = { tenants: number; processed: number; byStatus: Record<string, number> };

const CLAIM = { moduleCode: 'platform' } as const;

/**
 * پخش اعلان انتشار به همه‌ی تننت‌های ACTIVE که ماژول را (با همان منطق واقعی ModuleGuard) فعال دارند.
 * تضمین عدم تکرار: ردیف یکتای (انتشار، تننت، کانال) در لاگ تحویل + کلیدهای یکتا در خودِ تننت برای هر کاربر
 * (اعلان: entityId؛ پیامک: ModuleSetting claim؛ تیکت: sourceRef یکتا) — تلاش مجدد هرگز دوبل نمی‌فرستد.
 */
@Injectable()
export class ModuleReleaseFanoutService {
  private readonly logger = new Logger('ModuleReleaseFanout');
  private readonly running = new Set<string>();

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
    private readonly tenantSms: TenantSmsService,
  ) {}

  dbOf(t: TenantRow): TenantPrismaClient {
    return this.tenantPrisma.forTenant({ dbHost: t.dbHost, dbPort: t.dbPort, dbName: t.dbName });
  }

  /** تننت‌های ACTIVE که ماژول برایشان فعال است (همان منطق ModuleGuard، شامل وابستگی‌های انتقالی). */
  async eligibleTenants(moduleCode: string): Promise<TenantRow[]> {
    const tenants = await this.controlDb.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true, name: true, dbHost: true, dbPort: true, dbName: true },
      orderBy: { createdAt: 'asc' },
    });
    const out: TenantRow[] = [];
    for (const t of tenants) if (await isModuleEnabled(this.controlDb, t.id, moduleCode)) out.push(t);
    return out;
  }

  async getPrefs(db: TenantPrismaClient): Promise<TenantReleasePrefs> {
    const row = await db.moduleSetting.findUnique({ where: { moduleCode_key: RELEASE_PREFS_KEY } }).catch(() => null);
    return normalizePrefs(row?.value);
  }

  async hasSmsChannel(db: TenantPrismaClient): Promise<boolean> {
    return (await this.tenantSms.getConnection(db)).mode !== 'NONE';
  }

  /** اجرای کامل (یا تلاش مجدد) برای یک انتشار منتشرشده. هم‌زمانیِ دوم برای همان انتشار در همین پردازش رد می‌شود. */
  async run(releaseId: string, opts: { retry: boolean }): Promise<FanoutSummary | null> {
    if (this.running.has(releaseId)) return null;
    this.running.add(releaseId);
    try {
      const release = await this.controlDb.moduleRelease.findUnique({ where: { id: releaseId }, include: { changes: { orderBy: { sortOrder: 'asc' } } } });
      if (!release || release.status !== 'PUBLISHED') return null;
      const channels = normalizeChannels(release.channels);
      const mod = await this.controlDb.moduleDefinition.findUnique({ where: { code: release.moduleCode }, select: { name: true } });
      const moduleName = mod?.name ?? release.moduleCode;
      const changes = release.changes.map((c) => ({ type: c.type as CleanChange['type'], title: c.title, description: c.description, valueText: c.valueText, deepLink: c.deepLink }));
      const tenants = await this.eligibleTenants(release.moduleCode);
      const summary: FanoutSummary = { tenants: tenants.length, processed: 0, byStatus: {} };
      for (const tenant of tenants) {
        try {
          const results = await this.deliverToTenant(release, moduleName, changes, tenant, channels, opts.retry);
          for (const r of results) summary.byStatus[r.status] = (summary.byStatus[r.status] ?? 0) + 1;
          summary.processed++;
        } catch (e) {
          this.logger.warn(`fan-out ${release.id} tenant ${tenant.id}: ${e instanceof Error ? e.message : e}`);
        }
      }
      return summary;
    } finally {
      this.running.delete(releaseId);
    }
  }

  isRunning(releaseId: string): boolean {
    return this.running.has(releaseId);
  }

  private async deliverToTenant(release: ReleaseRow, moduleName: string, changes: CleanChange[], tenant: TenantRow, channels: ChannelSelection, retry: boolean): Promise<Array<{ channel: string; status: string }>> {
    const db = this.dbOf(tenant);
    const prefs = await this.getPrefs(db);
    const results: Array<{ channel: string; status: string }> = [];
    for (const ch of ['notify', 'ticket', 'sms'] as ReleaseChannel[]) {
      if (!channels[ch]) continue;
      const channel = DELIVERY_CHANNEL[ch];
      const row = await this.claim(release.id, tenant.id, channel, retry);
      if (!row) continue;
      let outcome: Outcome;
      try {
        outcome = prefs[ch] ? await this.execChannel(ch, release, moduleName, changes, tenant, db) : { status: 'SKIPPED', sent: 0, failed: 0, reason: 'OPTED_OUT' };
      } catch (e) {
        outcome = { status: 'FAILED', sent: 0, failed: 1, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
      }
      await this.controlDb.moduleReleaseDelivery.update({
        where: { id: row.id },
        data: { status: outcome.status, sentCount: outcome.sent, failedCount: outcome.failed, reason: outcome.reason ?? null, ticketId: outcome.ticketId ?? undefined, finishedAt: new Date() },
      });
      results.push({ channel, status: outcome.status });
    }
    return results;
  }

  /** ثبت اتمیک «این کانال را من پردازش می‌کنم»؛ null = قبلاً انجام شده/در حال انجام است. */
  async claim(releaseId: string, tenantId: string, channel: string, retry: boolean): Promise<{ id: string } | null> {
    try {
      const row = await this.controlDb.moduleReleaseDelivery.create({ data: { releaseId, tenantId, channel, status: 'PENDING' }, select: { id: true } });
      return row;
    } catch (e) {
      if ((e as { code?: string } | null)?.code !== 'P2002') throw e;
    }
    if (!retry) return null;
    const existing = await this.controlDb.moduleReleaseDelivery.findUnique({ where: { releaseId_tenantId_channel: { releaseId, tenantId, channel } } });
    if (!existing || !isRetryable(existing, new Date())) return null;
    // رقابت دو تلاش مجدد هم‌زمان: فقط برنده‌ی آپدیت مشروط (روی updatedAt قبلی) ادامه می‌دهد
    const upd = await this.controlDb.moduleReleaseDelivery.updateMany({
      where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
      data: { status: 'PENDING', reason: null, finishedAt: null, attempts: { increment: 1 } },
    });
    return upd.count === 1 ? { id: existing.id } : null;
  }

  private execChannel(ch: ReleaseChannel, release: ReleaseRow, moduleName: string, changes: CleanChange[], tenant: TenantRow, db: TenantPrismaClient): Promise<Outcome> {
    if (ch === 'notify') return this.execNotify(release, moduleName, tenant, db);
    if (ch === 'ticket') return this.execTicket(release, moduleName, changes, tenant);
    return this.execSms(release, moduleName, tenant, db);
  }

  // ── اعلان درون‌برنامه (+ پوش بر پایه‌ی ترجیح‌های هر کاربر) ──────────────────────────────
  private async execNotify(release: ReleaseRow, moduleName: string, tenant: TenantRow, db: TenantPrismaClient): Promise<Outcome> {
    const users = await db.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true }, take: 2000 });
    if (!users.length) return { status: 'SKIPPED', sent: 0, failed: 0, reason: 'NO_RECIPIENT' };
    const have = new Set((await db.notification.findMany({ where: { entityType: 'module-release', entityId: release.id, userId: { in: users.map((u) => u.id) } }, select: { userId: true } })).map((n) => n.userId));
    const text = notificationText(moduleName, release);
    for (const u of users) {
      if (have.has(u.id)) continue;
      await this.notifications.notify(db, {
        userId: u.id,
        type: 'module.release',
        title: text.title,
        body: text.body,
        link: releasePath(release.shortCode),
        entityType: 'module-release',
        entityId: release.id,
        category: 'system',
        channels: { push: true, email: false, sms: false },
      });
    }
    // notify() هرگز پرتاب نمی‌کند؛ نتیجه‌ی واقعی را از شمارش ردیف‌های ثبت‌شده می‌خوانیم
    const delivered = await db.notification.findMany({ where: { entityType: 'module-release', entityId: release.id, userId: { in: users.map((u) => u.id) } }, select: { userId: true }, distinct: ['userId'] });
    const sent = delivered.length;
    const failed = users.length - sent;
    return { status: failed === 0 ? 'SENT' : sent === 0 ? 'FAILED' : 'PARTIAL', sent, failed, reason: failed ? 'NOTIFY_INCOMPLETE' : undefined };
  }

  // ── تیکت پشتیبانی خودکار (از طرف سیستم، به نام مالک تننت) ─────────────────────────────
  private async execTicket(release: ReleaseRow, moduleName: string, changes: CleanChange[], tenant: TenantRow, opts: { test?: boolean } = {}): Promise<Outcome> {
    const owner =
      (await this.controlDb.tenantMembership.findFirst({ where: { tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' }, orderBy: { invitedAt: 'asc' }, select: { globalUserId: true } })) ??
      (await this.controlDb.tenantMembership.findFirst({ where: { tenantId: tenant.id, role: 'ADMIN', status: 'ACTIVE' }, orderBy: { invitedAt: 'asc' }, select: { globalUserId: true } }));
    if (!owner) return { status: 'SKIPPED', sent: 0, failed: 0, reason: 'NO_RECIPIENT' };
    const text = ticketText(moduleName, release, changes, releaseLink(release.shortCode));
    const sourceRef = opts.test ? `module-release:${release.id}:test:${Date.now()}` : `module-release:${release.id}`;
    try {
      const t = await this.controlDb.supportTicket.create({
        data: {
          tenantId: tenant.id,
          createdByUserId: owner.globalUserId,
          subject: opts.test ? `[آزمایشی] ${text.subject}`.slice(0, 220) : text.subject,
          // «اعلامیه» است، نه درخواست پشتیبانی: صف کارِ کارشناسان را شلوغ نمی‌کند ولی مشتری می‌تواند پاسخ دهد
          status: 'RESOLVED',
          priority: 'LOW',
          resolvedAt: new Date(),
          category: 'MODULE_RELEASE',
          sourceRef,
          messages: { create: [{ senderType: 'SYSTEM', senderId: null, body: text.body }] },
        },
        select: { id: true },
      });
      return { status: 'SENT', sent: 1, failed: 0, ticketId: t.id };
    } catch (e) {
      if ((e as { code?: string } | null)?.code === 'P2002') {
        const existing = await this.controlDb.supportTicket.findUnique({ where: { tenantId_sourceRef: { tenantId: tenant.id, sourceRef } }, select: { id: true } });
        return { status: 'SENT', sent: 1, failed: 0, ticketId: existing?.id };
      }
      throw e;
    }
  }

  // ── پیامک (فقط مدیران/مالک؛ با انصراف تننت، سقف روزانه و ردکردن تننت بدون پنل) ──────────
  private async execSms(release: ReleaseRow, moduleName: string, tenant: TenantRow, db: TenantPrismaClient, opts: { test?: boolean } = {}): Promise<Outcome> {
    const conn = await this.tenantSms.getConnection(db);
    if (conn.mode === 'NONE') return { status: 'SKIPPED', sent: 0, failed: 0, reason: 'NO_SMS_CHANNEL' };
    if (!(process.env.WEB_PANEL_PUBLIC_URL ?? '').trim()) return { status: 'SKIPPED', sent: 0, failed: 0, reason: 'NO_PUBLIC_URL' };
    let managers = (await getManagerUsers(this.controlDb, db, tenant.id)).filter((m) => m.phone);
    managers = managers.slice(0, opts.test ? 1 : SMS_MAX_RECIPIENTS_PER_TENANT);
    if (!managers.length) return { status: 'SKIPPED', sent: 0, failed: 0, reason: 'NO_RECIPIENT' };

    const day = tehranDay(new Date());
    void db.moduleSetting.deleteMany({ where: { ...CLAIM, key: { startsWith: 'rel:smsday:' }, updatedAt: { lt: new Date(Date.now() - 3 * 86_400_000) } } }).catch(() => undefined);
    const text = buildSmsText(moduleName, release.version, releaseLink(release.shortCode));
    let sent = 0;
    let failed = 0;
    let capped = 0;
    let lastError = '';
    for (const m of managers) {
      const userKey = opts.test ? null : `rel:sms:${release.id}:${m.tenantUserId}`;
      if (userKey && !(await this.claimOnce(db, userKey))) {
        sent++; // قبلاً برای همین کاربر ارسال شده (یا در جریان است)
        continue;
      }
      const slot = await this.claimSlot(db, `rel:smsday:${day}`, SMS_TENANT_DAILY_CAP);
      if (!slot) {
        if (userKey) await this.unclaim(db, userKey);
        capped++;
        continue;
      }
      const result = await this.tenantSms.sendSms({ tenantId: tenant.id, tenantDb: db }, m.phone, opts.test ? `[آزمایشی] ${text}` : text, { purpose: 'module-release', moduleCode: release.moduleCode, actorType: 'SYSTEM' });
      if (result.success) {
        sent++;
      } else {
        failed++;
        lastError = String(result.error ?? 'sms_failed');
        // ارسال شکست‌خورد: claim ها آزاد می‌شوند تا «ارسال مجدد» بتواند دوباره تلاش کند
        if (userKey) await this.unclaim(db, userKey);
        await this.unclaim(db, slot);
      }
    }
    if (failed === 0 && capped === 0) return { status: 'SENT', sent, failed };
    if (sent === 0 && failed === 0) return { status: 'SKIPPED', sent, failed, reason: 'DAILY_CAP' };
    if (sent === 0) return { status: 'FAILED', sent, failed, reason: lastError.slice(0, 200) };
    return { status: 'PARTIAL', sent, failed: failed + capped, reason: failed ? lastError.slice(0, 200) : 'DAILY_CAP' };
  }

  private async claimOnce(db: TenantPrismaClient, key: string): Promise<boolean> {
    try {
      await db.moduleSetting.create({ data: { ...CLAIM, key, value: {} } });
      return true;
    } catch (e) {
      if ((e as { code?: string } | null)?.code === 'P2002') return false;
      throw e;
    }
  }

  private async claimSlot(db: TenantPrismaClient, prefix: string, limit: number): Promise<string | null> {
    for (let n = 0; n < limit; n++) {
      const key = `${prefix}:${n}`;
      if (await this.claimOnce(db, key)) return key;
    }
    return null;
  }

  private async unclaim(db: TenantPrismaClient, key: string): Promise<void> {
    await db.moduleSetting.deleteMany({ where: { ...CLAIM, key } }).catch(() => undefined);
  }

  /** آزمایش روی یک تننت مشخص (فقط به مدیران؛ پیامک فقط یک نفر): ردیف یکتای تحویل را مصرف نمی‌کند ولی TEST ثبت می‌شود تا لینک پیش‌نویس باز شود. */
  async testSend(releaseId: string, tenantId: string, channels: ChannelSelection): Promise<Record<string, Outcome>> {
    const release = await this.controlDb.moduleRelease.findUnique({ where: { id: releaseId }, include: { changes: { orderBy: { sortOrder: 'asc' } } } });
    if (!release) throw new Error('NOT_FOUND');
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true, name: true, dbHost: true, dbPort: true, dbName: true, status: true } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new Error('TENANT_NOT_ACTIVE');
    const db = this.dbOf(tenant);
    const mod = await this.controlDb.moduleDefinition.findUnique({ where: { code: release.moduleCode }, select: { name: true } });
    const moduleName = mod?.name ?? release.moduleCode;
    const changes = release.changes.map((c) => ({ type: c.type as CleanChange['type'], title: c.title, description: c.description, valueText: c.valueText, deepLink: c.deepLink }));
    await this.controlDb.moduleReleaseDelivery.upsert({
      where: { releaseId_tenantId_channel: { releaseId, tenantId, channel: 'TEST' } },
      create: { releaseId, tenantId, channel: 'TEST', status: 'SENT', finishedAt: new Date() },
      update: { status: 'SENT', attempts: { increment: 1 }, finishedAt: new Date() },
    });
    const out: Record<string, Outcome> = {};
    // آزمایش عمداً انصراف تننت را نادیده می‌گیرد؛ فقط به مدیران و یک پیامک می‌رود
    if (channels.notify) {
      const managers = await getManagerUsers(this.controlDb, db, tenant.id);
      const text = notificationText(moduleName, release);
      for (const m of managers) {
        await this.notifications.notify(db, { userId: m.tenantUserId, type: 'module.release', title: `[آزمایشی] ${text.title}`, body: text.body, link: releasePath(release.shortCode), entityType: 'module-release-test', entityId: release.id, category: 'system', channels: { push: true, email: false, sms: false } });
      }
      out.notify = managers.length ? { status: 'SENT', sent: managers.length, failed: 0 } : { status: 'SKIPPED', sent: 0, failed: 0, reason: 'NO_RECIPIENT' };
    }
    if (channels.ticket) out.ticket = await this.execTicket(release, moduleName, changes, tenant, { test: true });
    if (channels.sms) out.sms = await this.execSms(release, moduleName, tenant, db, { test: true });
    return out;
  }
}
