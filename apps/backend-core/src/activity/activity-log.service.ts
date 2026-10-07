import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { ActorType } from './activity-context.js';
import { currentActor } from './activity-context.js';
import type { ActionType } from './activity-route.util.js';
import { maskPhone, redactSmsPreview, smsPartCount } from './activity-redact.util.js';

export type ActivityRow = {
  userId?: string | null;
  actorType: ActorType;
  moduleCode: string;
  actionType: ActionType;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  ip?: string | null;
  metadata?: Record<string, unknown>;
};

type QueueItem = {
  db: TenantPrismaClient;
  row: ActivityRow;
  /** فقط برای ردیف‌های HTTP: کاربر tenant-محلی هنگام flush از روی GlobalUser.id پیدا می‌شود (نه روی مسیر داغ درخواست). */
  resolve?: { tenantId: string; globalUserId: string };
  /** حذف تکرار با لاگ‌های صریح ماژول‌ها (همان کاربر + همان موجودیت در چند ثانیه‌ی اخیر) */
  dedupe?: boolean;
  at: Date;
};

const FLUSH_INTERVAL_MS = 2_000;
const FLUSH_BATCH = 50;
const MAX_QUEUE = 5_000;
const USER_CACHE_TTL_MS = 10 * 60_000;
const USER_CACHE_MAX = 2_000;
const DEDUPE_WINDOW_MS = 30_000;

export type SystemLogInput = {
  action: string;
  moduleCode: string;
  summary: string;
  actionType?: ActionType;
  entityType?: string;
  entityId?: string | null;
  /** AUTOMATIC: خودکارِ مبتنی‌بر قانون/کرون/تایمر؛ SYSTEM: رویداد داخلی سیستم */
  actorType?: Exclude<ActorType, 'MANUAL'>;
  /** کاربری که کار برایش/به نام او انجام شده (مثلاً صاحب گزارش روزانه) */
  userId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * ماژول/منبع فراخوان از روی stack: مسیر .../src/<ماژول>/<نام>.service.ts (یا dist/...) — تا همه‌ی فراخوانی‌های
 * پیامک (بیش از ۳۰ نقطه) بدون ویرایش یکی‌یکی برچسب ماژول بگیرند. فقط یک heuristic برای برچسب‌گذاری است.
 */
export function inferOriginFromStack(stack: string | undefined): { dir: string; file: string } | null {
  if (!stack) return null;
  for (const line of stack.split('\n')) {
    const m = /[\\/](?:src|dist)[\\/]([a-z0-9-]+)[\\/]([a-z0-9.-]+?)\.(?:ts|js)/i.exec(line);
    if (!m) continue;
    const [, dir, file] = m;
    if (['sms', 'activity', 'common', 'prisma'].includes(dir)) continue;
    return { dir, file: file.replace(/\.service$/, '') };
  }
  return null;
}

export type SmsLogInput = {
  phone: string;
  message: string;
  success: boolean;
  error?: string;
  /** کانال/پنل: TENANT_OWN | TENANT_SYSTEM | TENANT_LEGACY | NONE */
  channel?: string;
  /** هدف ارسال (مثلاً invoice-reminder، automation) — جایگزین متن پیامک در لاگ */
  purpose?: string;
  moduleCode?: string;
  /** اجبار نوع کنشگر (مثلاً اتوماسیون که داخل درخواست کاربر اجرا می‌شود) */
  actorType?: ActorType;
  /** stack فراخوان (پیش از await گرفته می‌شود) برای تشخیص ماژول */
  stack?: string;
};

/**
 * ثبت لاگ فعالیت — صف‌شده و دسته‌ای: هرگز درخواست اصلی را کند یا خراب نمی‌کند.
 * همه‌ی خطاها قورت داده می‌شوند (فقط هشدار کم‌تکرار در لاگ سرور).
 */
@Injectable()
export class ActivityLogService implements OnModuleDestroy {
  private readonly logger = new Logger('ActivityLog');
  private queue: QueueItem[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private lastWarnAt = 0;
  private readonly userCache = new Map<string, { id: string | null; exp: number }>();

  /** ردیف HTTP (دستی) — بدون هیچ کوئری روی مسیر درخواست. */
  enqueueHttp(db: TenantPrismaClient, who: { tenantId: string; globalUserId: string; viaApiKey: boolean }, row: ActivityRow): void {
    this.push({
      db,
      row: { ...row, userId: undefined, actorType: who.viaApiKey ? 'AUTOMATIC' : row.actorType, metadata: { ...row.metadata, src: 'http', ...(who.viaApiKey ? { via: 'api-key' } : {}) } },
      resolve: who.viaApiKey ? undefined : { tenantId: who.tenantId, globalUserId: who.globalUserId },
      dedupe: true,
      at: new Date(),
    });
  }

  /** ثبت اقدام خودکار/سیستمی — فراخوانی در یک خط، بدون await لازم. */
  logSystem(db: TenantPrismaClient, input: SystemLogInput): void {
    try {
      this.push({
        db,
        row: {
          userId: input.userId ?? null,
          actorType: input.actorType ?? 'AUTOMATIC',
          moduleCode: input.moduleCode,
          actionType: input.actionType ?? 'other',
          action: input.action,
          entityType: input.entityType ?? 'system',
          entityId: input.entityId ?? null,
          summary: input.summary.slice(0, 300),
          metadata: { ...input.metadata, src: 'system' },
        },
        at: new Date(),
      });
    } catch {
      /* never throws */
    }
  }

  /**
   * ثبت یک ارسال پیامک: گیرنده ماسک، فقط پیش‌نمایش ردکت‌شده/برچسب هدف (هرگز متن کامل، کد یا لینک توکن‌دار)،
   * طول و تعداد بخش. کنشگر: کاربر درخواست جاری (دستی) یا سیستم/خودکار (کرون، اتوماسیون، درخواست عمومی).
   */
  logSms(db: TenantPrismaClient, input: SmsLogInput, tenantId?: string): void {
    try {
      const actor = currentActor();
      const manualUser = actor?.actorType === 'MANUAL' && actor.globalUserId && !actor.viaApiKey ? actor : undefined;
      const actorType: ActorType = input.actorType ?? (manualUser ? 'MANUAL' : actor ? actor.actorType : 'SYSTEM');
      const origin = inferOriginFromStack(input.stack ?? new Error().stack);
      const moduleCode = input.moduleCode ?? actor?.moduleCode ?? origin?.dir ?? 'sms';
      const preview = redactSmsPreview(input.message);
      const parts = smsPartCount(input.message);
      const purpose = input.purpose ?? origin?.file ?? actor?.origin ?? (manualUser ? 'manual' : 'system');
      const row: ActivityRow = {
        userId: null,
        actorType,
        moduleCode,
        actionType: 'send',
        action: input.success ? 'sms.sent' : 'sms.failed',
        entityType: 'sms',
        entityId: null,
        summary: `${input.success ? 'ارسال پیامک' : 'ارسال ناموفق پیامک'} به ${maskPhone(input.phone)}${input.purpose ? ` (${input.purpose})` : ''}`,
        metadata: {
          src: 'sms',
          recipient: maskPhone(input.phone),
          purpose,
          success: input.success,
          length: input.message.length,
          parts,
          channel: input.channel ?? null,
          preview,
          ...(input.success ? {} : { error: (input.error ?? '').slice(0, 200) }),
        },
      };
      this.push({
        db,
        row,
        resolve: manualUser && (tenantId ?? manualUser.tenantId) ? { tenantId: (tenantId ?? manualUser.tenantId)!, globalUserId: manualUser.globalUserId! } : undefined,
        at: new Date(),
      });
    } catch {
      /* never throws */
    }
  }

  private push(item: QueueItem): void {
    if (this.queue.length >= MAX_QUEUE) this.queue.shift(); // حافظه‌ی بی‌انتها نداریم؛ قدیمی‌ترین قربانی می‌شود
    this.queue.push(item);
    if (this.queue.length >= FLUSH_BATCH) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, FLUSH_INTERVAL_MS);
      this.timer.unref?.();
    }
  }

  /** برای تست و خاموشی: همه‌ی صف را می‌نویسد. */
  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
      if (this.queue.length === 0) return;
    }
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    await this.flushing;
  }

  private async doFlush(): Promise<void> {
    const items = this.queue;
    this.queue = [];
    if (items.length === 0) return;

    const byDb = new Map<TenantPrismaClient, QueueItem[]>();
    for (const it of items) {
      const list = byDb.get(it.db) ?? [];
      list.push(it);
      byDb.set(it.db, list);
    }

    for (const [db, list] of byDb) {
      try {
        await this.writeGroup(db, list);
      } catch (err) {
        this.warn(`activity log write failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async writeGroup(db: TenantPrismaClient, list: QueueItem[]): Promise<void> {
    // ۱) تبدیل GlobalUser.id → User.id (کش؛ فقط برای کلیدهای ندیده یک کوئری)
    const now = Date.now();
    const missing = new Map<string, { tenantId: string; globalUserId: string }>();
    for (const it of list) {
      if (!it.resolve) continue;
      const key = `${it.resolve.tenantId}:${it.resolve.globalUserId}`;
      const cached = this.userCache.get(key);
      if (!cached || cached.exp < now) missing.set(key, it.resolve);
    }
    if (missing.size > 0) {
      const users = await db.user.findMany({
        where: { globalUserId: { in: [...missing.values()].map((m) => m.globalUserId) } },
        select: { id: true, globalUserId: true },
      });
      const byGlobal = new Map(users.map((u) => [u.globalUserId, u.id]));
      if (this.userCache.size > USER_CACHE_MAX) this.userCache.clear();
      for (const [key, m] of missing) this.userCache.set(key, { id: byGlobal.get(m.globalUserId) ?? null, exp: now + USER_CACHE_TTL_MS });
    }

    const rows = list.map((it) => {
      const userId = it.resolve ? (this.userCache.get(`${it.resolve.tenantId}:${it.resolve.globalUserId}`)?.id ?? null) : (it.row.userId ?? null);
      return { it, userId };
    });

    // ۲) حذف تکرار با لاگ‌های صریح ماژول‌ها (فقط ردیف‌های HTTP دارای entityId)
    const candidates = rows.filter((r) => r.it.dedupe && r.userId && r.it.row.entityId);
    let duplicates = new Set<string>();
    if (candidates.length > 0) {
      const since = new Date(Math.min(...candidates.map((c) => c.it.at.getTime())) - DEDUPE_WINDOW_MS);
      const existing = await db.activityLog.findMany({
        where: {
          userId: { in: [...new Set(candidates.map((c) => c.userId!))] },
          entityId: { in: [...new Set(candidates.map((c) => c.it.row.entityId!))] },
          createdAt: { gte: since },
        },
        select: { userId: true, entityId: true, metadata: true },
      });
      duplicates = new Set(
        existing.filter((e) => (e.metadata as { src?: string } | null)?.src !== 'http').map((e) => `${e.userId}:${e.entityId}`),
      );
    }

    const data = rows
      .filter((r) => !(r.it.dedupe && r.userId && r.it.row.entityId && duplicates.has(`${r.userId}:${r.it.row.entityId}`)))
      .map(({ it, userId }) => ({
        userId,
        actorType: it.row.actorType,
        moduleCode: it.row.moduleCode,
        actionType: it.row.actionType,
        action: it.row.action,
        entityType: it.row.entityType,
        entityId: it.row.entityId ?? null,
        summary: it.row.summary,
        ip: it.row.ip ?? null,
        metadata: (it.row.metadata ?? {}) as object,
        createdAt: it.at,
      }));
    if (data.length === 0) return;
    try {
      await db.activityLog.createMany({ data });
    } catch {
      // یک ردیف خراب (مثلاً کاربر حذف‌شده) نباید کل دسته را بسوزاند — تک‌به‌تک، با userId خالی برای ردیف مشکل‌دار
      for (const d of data) {
        await db.activityLog.create({ data: d }).catch(() => db.activityLog.create({ data: { ...d, userId: null } }).catch(() => undefined));
      }
    }
  }

  private warn(msg: string): void {
    const now = Date.now();
    if (now - this.lastWarnAt < 60_000) return;
    this.lastWarnAt = now;
    this.logger.warn(msg);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.flush().catch(() => undefined);
  }
}
