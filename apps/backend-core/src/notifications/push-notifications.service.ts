import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import https from 'node:https';
import webpush from 'web-push';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { SessionEpochService } from '../security/session-epoch.service.js';
import { SecurityEventsService } from '../security/security-events.service.js';
import { guardedLookup } from '../security/ssrf.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import {
  buildPushPayload,
  classifyPushError,
  isAllowedPushEndpoint,
  planDelivery,
  pushTiming,
  pushTopic,
  reasonCountsAsFailure,
  shouldDeleteAfterFailure,
  signAckToken,
  signRotateToken,
  verifyRotateToken,
  type NotificationCategory,
} from './push-logic.js';
import { ackKey, rotateKey } from './push-tokens.js';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  /** هم‌تگ‌ها یکدیگر را جایگزین می‌کنند (مثلاً یک اعلان به‌ازای هر گفتگوی پیام‌رسان). */
  tag?: string;
  icon?: string;
  /** دکمه‌های اعلان (مثلاً «پاسخ سریع»، «انجام شد»). */
  actions?: { action: string; title: string }[];
  requireInteraction?: boolean;
  renotify?: boolean;
  silentIfVisible?: boolean;
  entityType?: string | null;
  entityId?: string | null;
  badgeCount?: number;
};

export type TenantSendOpts = {
  category?: NotificationCategory;
  critical?: boolean;
  /** اعلان درون‌برنامه‌ی متناظر — توکن ack به آن گره می‌خورد. */
  notificationId?: string;
  pushId?: string;
  /** فقط همین دستگاه (ارسال آزمایشی). */
  onlySubscriptionId?: string;
};

export type DeviceResult = {
  subscriptionId: string;
  label: string | null;
  status: 'sent' | 'failed' | 'expired' | 'skipped';
  httpCode: number | null;
  reason: string;
};

export type PushSendSummary = {
  pushId: string;
  total: number;
  sent: number;
  failed: number;
  results: DeviceResult[];
  /** not_configured | no_device | null */
  skipped: string | null;
};

/** agent با lookup محافظ: حتی با DNS-rebinding اتصال به آدرس خصوصی/loopback ممکن نیست (لایه‌ی دوم پس از allowlist). */
const PUSH_AGENT = new https.Agent({ keepAlive: true, maxSockets: 32, lookup: guardedLookup as never });

const SEND_TIMEOUT_MS = 10_000;
const SEND_CONCURRENCY = 8;
const ATTEMPT_RETENTION_DAYS = 14;

export function vapidKeyHash(publicKey: string | null | undefined): string | null {
  return publicKey ? createHash('sha256').update(publicKey).digest('hex').slice(0, 16) : null;
}

function resolveSubject(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  return /^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/i.test(v) ? v : 'mailto:support@exir.co';
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Web Push — برای کارکنان پنل ادمین (AdminPushSubscription) و کاربران تننت (PushSubscription، چنددستگاهی).
 * هر دستگاه جدا و با try/catch ارسال می‌شود (شکست یکی، بقیه را متوقف نمی‌کند و هیچ‌وقت به فراخواننده پرتاب نمی‌شود)،
 * با timeout/TTL/urgency، حذف فوری اشتراک ۴۰۴/۴۱۰ و حذف پس از N شکست پیاپی، و ثبت هر تلاش (PushAttempt) برای عیب‌یابی.
 * متغیرهای محیطی: VAPID_PUBLIC_KEY، VAPID_PRIVATE_KEY، VAPID_SUBJECT (mailto:… یا https://…).
 */
@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger('PushNotificationsService');
  private readonly configured: boolean;

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly epoch: SessionEpochService,
    private readonly events: SecurityEventsService,
  ) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    let ok = Boolean(publicKey && privateKey);
    if (ok) {
      try {
        webpush.setVapidDetails(resolveSubject(process.env.VAPID_SUBJECT), publicKey!, privateKey!);
      } catch (err) {
        ok = false;
        this.logger.error(`VAPID keys invalid — push disabled: ${err instanceof Error ? err.message : err}`);
      }
    }
    this.configured = ok;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  currentKeyHash(): string | null {
    return vapidKeyHash(this.getPublicKey());
  }

  // ── admin (control-plane) ────────────────────────────────────────────────
  async sendToAdmin(adminUserId: string, payload: PushPayload): Promise<void> {
    if (!this.configured) return;
    const subs = await this.controlDb.adminPushSubscription.findMany({ where: { adminUserId } });
    await mapLimit(subs, SEND_CONCURRENCY, async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, buildPushPayload({ ...payload, category: 'system' }).json, {
          TTL: 6 * 3600,
          urgency: 'high',
          timeout: SEND_TIMEOUT_MS,
        });
      } catch (err) {
        const kind = classifyPushError(err);
        if (kind.deleteNow) await this.controlDb.adminPushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        else this.logger.warn(`Admin push failed (${kind.reason}): ${err instanceof Error ? err.message : err}`);
      }
    });
  }

  async sendToTeam(team: 'SUPPORT' | 'SUPER_ADMIN' | 'BILLING' | 'ENGINEERING', payload: PushPayload): Promise<void> {
    if (!this.configured) return;
    const admins = await this.controlDb.adminUser.findMany({ where: { team, isActive: true }, select: { id: true } });
    await Promise.all(admins.map((a) => this.sendToAdmin(a.id, payload).catch(() => undefined)));
  }

  // ── tenant users ─────────────────────────────────────────────────────────
  /** شناسه‌ی تننت برای توکن‌ها (نام دیتابیس)؛ ناشناس → null و ack/rotate برای آن ارسال غیرفعال می‌ماند. */
  tenantKeyOf(tenantDb: TenantPrismaClient): string | null {
    return this.tenantPrisma.dbNameOf(tenantDb);
  }

  /**
   * صدور توکن چرخش (یک‌بارمصرف، ۴۵ روزه‌ی لغزنده): nonce تازه روی ردیف اشتراک ذخیره می‌شود و توکن قبلی باطل می‌شود؛
   * به نسخه‌ی مؤثر نشست عضو (epoch + tokenVersion تننت/عضو) گره می‌خورد، پس «خروج اجباری»/تعلیق آن را باطل می‌کند.
   */
  async issueRotateToken(tenantDb: TenantPrismaClient, subscriptionId: string, userId: string, tenantId: string, globalUserId: string): Promise<string | null> {
    try {
      const key = rotateKey();
      const t = this.tenantKeyOf(tenantDb);
      if (!key || !t) return null;
      const [tenant, membership] = await Promise.all([
        this.controlDb.tenant.findUnique({ where: { id: tenantId }, select: { tokenVersion: true } }),
        this.controlDb.tenantMembership.findUnique({ where: { tenantId_globalUserId: { tenantId, globalUserId } }, select: { tokenVersion: true, status: true } }),
      ]);
      if (!tenant || membership?.status !== 'ACTIVE') return null;
      const k = randomBytes(16).toString('base64url');
      await tenantDb.pushSubscription.update({ where: { id: subscriptionId }, data: { rotateNonce: k } });
      return signRotateToken({ s: subscriptionId, u: userId, t, k, v: await this.epoch.effective(tenant.tokenVersion, membership.tokenVersion) }, key);
    } catch (err) {
      this.logger.warn(`issueRotateToken failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** برای ارسال‌هایی که از notify() نمی‌گذرند (پیام‌رسان): ترجیح دسته + ساعات سکوت کاربر. خطا ⇒ مجاز (بهتر است اعلان برسد). */
  async allowsPush(tenantDb: TenantPrismaClient, userId: string, category: NotificationCategory, critical = false): Promise<boolean> {
    try {
      const pref = await tenantDb.notificationPreference.findUnique({ where: { userId } });
      return planDelivery(pref, { category, critical }).push;
    } catch {
      return true;
    }
  }

  /** هرگز پرتاب نمی‌کند. خلاصه‌ی نتیجه‌ی هر دستگاه را برمی‌گرداند. */
  async sendToTenantUser(tenantDb: TenantPrismaClient, userId: string, payload: PushPayload, opts: TenantSendOpts = {}): Promise<PushSendSummary> {
    const pushId = opts.pushId ?? opts.notificationId ?? randomUUID();
    const summary: PushSendSummary = { pushId, total: 0, sent: 0, failed: 0, results: [], skipped: null };
    if (!this.configured) return { ...summary, skipped: 'not_configured' };
    try {
      const subs = await tenantDb.pushSubscription.findMany({ where: { userId, ...(opts.onlySubscriptionId ? { id: opts.onlySubscriptionId } : {}) } });
      summary.total = subs.length;
      if (subs.length === 0) return { ...summary, skipped: 'no_device' };

      const category = opts.category ?? 'system';
      const critical = opts.critical ?? false;
      const { urgency, ttl } = pushTiming(category, critical);
      const tenantKey = this.tenantKeyOf(tenantDb);
      const aKey = ackKey();
      const ackToken = tenantKey && aKey ? signAckToken({ n: opts.notificationId ?? pushId, u: userId, t: tenantKey }, aKey) : undefined;
      const { json } = buildPushPayload({
        ...payload,
        category,
        ackToken,
        requireInteraction: payload.requireInteraction ?? critical,
      });
      const topic = pushTopic(payload.tag);
      const currentHash = this.currentKeyHash();

      summary.results = await mapLimit(subs, SEND_CONCURRENCY, async (sub): Promise<DeviceResult> => {
        const base = { subscriptionId: sub.id, label: sub.label };
        // ردیف‌های قدیمی/دست‌کاری‌شده با endpoint غیرمجاز هرگز تماس گرفته نمی‌شوند (ضد SSRF) و پاک می‌شوند
        if (!isAllowedPushEndpoint(sub.endpoint)) {
          await tenantDb.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          return { ...base, status: 'skipped', httpCode: null, reason: 'endpoint_not_allowed' };
        }
        // اشتراکی که با کلید VAPID دیگری ساخته شده هرگز نمی‌رسد (۴۰۳) — بدون تلاش رد می‌شود تا کاربر «اصلاح خودکار» بزند
        if (sub.vapidKeyHash && currentHash && sub.vapidKeyHash !== currentHash) {
          return { ...base, status: 'skipped', httpCode: null, reason: 'vapid_mismatch' };
        }
        try {
          const res = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, json, {
            TTL: ttl,
            urgency,
            timeout: SEND_TIMEOUT_MS,
            agent: PUSH_AGENT,
            ...(topic ? { topic } : {}),
          });
          return { ...base, status: 'sent', httpCode: res.statusCode ?? 201, reason: 'ok' };
        } catch (err) {
          const kind = classifyPushError(err);
          if (!kind.deleteNow) this.logger.warn(`Tenant push failed for ${sub.id} (${kind.reason}): ${err instanceof Error ? err.message : err}`);
          return { ...base, status: kind.status, httpCode: kind.httpCode, reason: kind.reason };
        }
      });
      summary.sent = summary.results.filter((r) => r.status === 'sent').length;
      summary.failed = summary.results.filter((r) => r.status === 'failed' || r.status === 'expired').length;
      await this.recordOutcome(tenantDb, userId, subs, summary.results, { pushId, notificationId: opts.notificationId, category });
    } catch (err) {
      this.logger.warn(`sendToTenantUser failed for ${userId}: ${err instanceof Error ? err.message : err}`);
    }
    return summary;
  }

  /** ثبت PushAttempt، به‌روزرسانی آمار اشتراک و حذف اشتراک‌های مرده — همه best-effort. */
  private async recordOutcome(
    tenantDb: TenantPrismaClient,
    userId: string,
    subs: { id: string; failureCount: number }[],
    results: DeviceResult[],
    meta: { pushId: string; notificationId?: string; category: string },
  ): Promise<void> {
    const now = new Date();
    try {
      await tenantDb.pushAttempt.createMany({
        data: results.map((r) => ({
          userId,
          subscriptionId: r.subscriptionId,
          pushId: meta.pushId,
          notificationId: meta.notificationId ?? null,
          category: meta.category,
          channel: 'push',
          status: r.status,
          httpCode: r.httpCode,
          reason: r.reason,
        })),
      });
    } catch (err) {
      this.logger.warn(`push attempt log failed: ${err instanceof Error ? err.message : err}`);
    }
    for (const r of results) {
      const prev = subs.find((s) => s.id === r.subscriptionId)?.failureCount ?? 0;
      try {
        if (r.status === 'sent') {
          await tenantDb.pushSubscription.update({ where: { id: r.subscriptionId }, data: { lastSuccessAt: now, failureCount: 0 } });
        } else if (r.status === 'failed' || r.status === 'expired') {
          if (shouldDeleteAfterFailure({ status: r.status === 'expired' ? 'expired' : 'failed', reason: r.reason, httpCode: r.httpCode, deleteNow: r.status === 'expired' || r.reason === 'endpoint_blocked', countsAsFailure: reasonCountsAsFailure(r.reason) }, prev)) {
            await tenantDb.pushSubscription.delete({ where: { id: r.subscriptionId } });
          } else if (reasonCountsAsFailure(r.reason)) {
            await tenantDb.pushSubscription.update({ where: { id: r.subscriptionId }, data: { lastFailureAt: now, failureCount: { increment: 1 } } });
          }
        }
      } catch {
        // اشتراک همزمان حذف شده یا DB موقتاً در دسترس نیست — مهم نیست
      }
    }
    // نگهداری محدود: ردیف‌های قدیمی هر چند ارسال یک‌بار پاک می‌شوند
    if (Math.random() < 0.02) {
      await tenantDb.pushAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - ATTEMPT_RETENTION_DAYS * 86400_000) } } }).catch(() => undefined);
    }
  }

  /**
   * چرخش اشتراک از سرویس‌ورکر (بدون JWT). فقط endpoint مجاز، عضویت ACTIVE، کاربر ACTIVE، نسخه‌ی نشست برابر و nonce جاری
   * (توکن قبلی پس از هر چرخش باطل می‌شود). موفق ⇒ توکن بعدی؛ هر شکست ⇒ null (بدون اوراکل). هر چرخش رویداد امنیتی ثبت می‌کند.
   */
  async rotateByToken(token: unknown, endpoint: unknown, p256dh: unknown, auth: unknown, ip?: string): Promise<string | null> {
    try {
      const key = rotateKey();
      if (!key) return null;
      const claims = verifyRotateToken(token, key);
      if (!claims) return null;
      if (!isAllowedPushEndpoint(endpoint)) {
        this.events.record({ type: 'PUSH_ENDPOINT_REJECTED', severity: 'WARNING', message: 'rotate با endpoint غیرمجاز رد شد', ip, dedupeKey: claims.s });
        return null;
      }
      if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string' || !p256dh || !auth || p256dh.length > 256 || auth.length > 128) return null;
      const tenant = await this.controlDb.tenant.findFirst({ where: { dbName: claims.t } });
      if (!tenant || tenant.status !== 'ACTIVE') return null;
      const db = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
      const existing = await db.pushSubscription.findFirst({ where: { id: claims.s, userId: claims.u } });
      if (!existing?.rotateNonce) return null; // دستگاه حذف شده / هنوز توکن یک‌بارمصرف صادر نشده
      const a = Buffer.from(existing.rotateNonce);
      const b = Buffer.from(claims.k);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        this.events.record({ type: 'PUSH_ENDPOINT_REJECTED', severity: 'WARNING', message: 'rotate با توکن باطل/تکراری رد شد (احتمال سرقت توکن)', ip, tenantId: tenant.id, dedupeKey: claims.s });
        return null;
      }
      const user = await db.user.findUnique({ where: { id: claims.u }, select: { status: true, globalUserId: true } });
      if (!user || user.status !== 'ACTIVE') return null;
      const membership = await this.controlDb.tenantMembership.findUnique({ where: { tenantId_globalUserId: { tenantId: tenant.id, globalUserId: user.globalUserId } }, select: { status: true, tokenVersion: true } });
      if (membership?.status !== 'ACTIVE') return null;
      if ((await this.epoch.effective(tenant.tokenVersion, membership.tokenVersion)) !== claims.v) return null;

      const nextNonce = randomBytes(16).toString('base64url');
      // claim اتمیک روی nonce: دو rotate هم‌زمان با یک توکن فقط یکی موفق می‌شود
      const claimed = await db.pushSubscription.updateMany({ where: { id: existing.id, rotateNonce: claims.k }, data: { rotateNonce: nextNonce } });
      if (claimed.count !== 1) return null;
      await db.pushSubscription.deleteMany({ where: { endpoint, NOT: { id: existing.id } } });
      await db.pushSubscription.update({
        where: { id: existing.id },
        data: { endpoint, p256dh, auth, failureCount: 0, lastSeenAt: new Date(), lastRotateAt: new Date(), vapidKeyHash: this.currentKeyHash() },
      });
      this.events.record({ type: 'PUSH_ENDPOINT_ROTATED', severity: 'INFO', message: `اشتراک پوش دستگاه ${existing.id} چرخانده شد`, ip, tenantId: tenant.id, actor: claims.u });
      return signRotateToken({ s: existing.id, u: claims.u, t: claims.t, k: nextNonce, v: claims.v }, key);
    } catch (err) {
      this.logger.warn(`rotate failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
