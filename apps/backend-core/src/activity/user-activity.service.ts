import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { RateLimitStore } from '../security/rate-limit.js';
import { ActivityTimelineService } from './activity-timeline.service.js';
import type { ArchiveAccess } from './user-activity-access.js';
import {
  RETENTION_KEY,
  RETENTION_MODULE,
  buildTimelineCsv,
  moduleLabel,
  parseRetentionDays,
  type TimelineFilters,
  type TimelineItem,
} from './user-activity.logic.js';

const EXPORT_CAP = 5_000;
const EXPORT_PAGE = 500;
const EXPORT_PER_10_MIN = 5;
const DAY_MS = 86_400_000;

@Injectable()
export class UserActivityService {
  private readonly exportLimiter = new RateLimitStore(10_000);

  constructor(
    private readonly timeline: ActivityTimelineService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  list(ctx: TenantRequestContext, access: ArchiveAccess, userId: string, f: TimelineFilters, opts: { cursor?: string; limit?: number }) {
    return this.timeline.query(ctx, access, userId, f, opts);
  }

  /** CSV بیرون‌دادنی: فقط مدیر/HR، سقف ردیف، نرخ‌محدود، بدون فرمول اجرایی. */
  async exportCsv(ctx: TenantRequestContext, access: ArchiveAccess, userId: string, f: TimelineFilters): Promise<string> {
    if (!access.canExport) throw new ForbiddenException('اجازه‌ی خروجی گرفتن از آرشیو فعالیت را ندارید');
    const key = `activity-export:${access.viewerId ?? ctx.auth.sub}`;
    const verdict = this.exportLimiter.hit(key, EXPORT_PER_10_MIN, 600);
    if (!verdict.allowed) throw new HttpException('تعداد درخواست‌های خروجی زیاد است؛ چند دقیقه بعد دوباره تلاش کنید', HttpStatus.TOO_MANY_REQUESTS);

    const rows: TimelineItem[] = [];
    let cursor: string | undefined;
    while (rows.length < EXPORT_CAP) {
      const page = await this.timeline.query(ctx, access, userId, f, { cursor, limit: EXPORT_PAGE, maxLimit: EXPORT_PAGE });
      rows.push(...page.items);
      if (!page.nextCursor || page.items.length === 0) break;
      cursor = page.nextCursor;
    }
    return buildTimelineCsv(rows.slice(0, EXPORT_CAP), { includeNetwork: access.canSeeNetwork });
  }

  async summary(ctx: TenantRequestContext, access: ArchiveAccess, userId: string) {
    const db = ctx.tenantDb;
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const since365 = new Date(now.getTime() - 365 * DAY_MS);

    const [daily, byModule365, lastActive, lastLoginLog, loginRows, offboarding] = await Promise.all([
      db.$queryRaw<Array<{ d: string; n: number }>>`
        SELECT to_char(("createdAt" AT TIME ZONE 'Asia/Tehran'), 'YYYY-MM-DD') AS d, count(*)::int AS n
        FROM activity_logs WHERE "userId" = ${userId} AND "createdAt" >= ${since30}
        GROUP BY 1 ORDER BY 1`,
      db.activityLog.groupBy({ by: ['moduleCode'], where: { userId, createdAt: { gte: since365 } }, _count: { _all: true } }),
      db.activityLog.findFirst({ where: { userId, actorType: 'MANUAL' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      db.activityLog.findFirst({ where: { userId, action: 'auth.login' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      access.canSeeNetwork
        ? db.activityLog.findMany({ where: { userId, action: 'auth.login' }, orderBy: { createdAt: 'desc' }, take: 10, select: { createdAt: true, ip: true, metadata: true } })
        : Promise.resolve([]),
      db.userOffboardingRun.findFirst({
        where: { fromUserId: userId },
        orderBy: { createdAt: 'desc' },
        select: { mode: true, createdAt: true, performedByName: true, toUserName: true, reason: true },
      }),
    ]);

    // آخرین ورود: بیشینه‌ی ثبت ورودِ تننت و lastLoginAt کنترل‌پلین (برای ورودهای پیش از فعال‌شدن این قابلیت)
    let lastLoginAt = lastLoginLog?.createdAt ?? null;
    const gid = access.target?.globalUserId;
    if (gid && !gid.startsWith('deleted:')) {
      const g = await this.controlDb.globalUser.findUnique({ where: { id: gid }, select: { lastLoginAt: true } }).catch(() => null);
      if (g?.lastLoginAt && (!lastLoginAt || g.lastLoginAt > lastLoginAt)) lastLoginAt = g.lastLoginAt;
    }

    // سری روزانه‌ی کامل ۳۰ روز (روزهای بدون فعالیت صفر)
    const counts = new Map(daily.map((r) => [r.d, r.n]));
    const days: Array<{ date: string; count: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * DAY_MS + 12_600_000).toISOString().slice(0, 10);
      days.push({ date, count: counts.get(date) ?? 0 });
    }
    const count30 = days.reduce((a, d) => a + d.count, 0);

    const deleted = !!access.tombstone || (access.target ? access.target.globalUserId.startsWith('deleted:') : false);
    const inactive = access.target ? access.target.status === 'DISABLED' : true;
    return {
      subject: {
        id: userId,
        name: access.target?.name ?? access.tombstone?.name ?? 'کاربر حذف‌شده',
        deleted,
        inactive,
        offboarding: offboarding
          ? {
              mode: offboarding.mode,
              at: offboarding.createdAt,
              performedByName: offboarding.performedByName,
              toUserName: offboarding.toUserName,
              ...(access.level === 'admin' ? { reason: offboarding.reason } : {}),
            }
          : null,
      },
      viewer: { level: access.level, canExport: access.canExport, canSeeNetwork: access.canSeeNetwork },
      lastLoginAt,
      lastActiveAt: lastActive?.createdAt ?? null,
      count30d: count30,
      daily: days,
      modules: byModule365
        .filter((m) => !!m.moduleCode)
        .map((m) => ({ code: m.moduleCode as string, label: moduleLabel(m.moduleCode as string), count: m._count._all }))
        .sort((a, b) => b.count - a.count),
      devices: loginRows.map((r) => ({
        at: r.createdAt,
        ip: r.ip,
        device: typeof (r.metadata as { device?: unknown } | null)?.device === 'string' ? ((r.metadata as { device: string }).device) : null,
      })),
    };
  }

  // ── سیاست نگهداشت (فقط مدیر) ───────────────────────────────────────────

  async getRetention(ctx: TenantRequestContext) {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: RETENTION_MODULE, key: RETENTION_KEY } } });
    return { retentionDays: parseRetentionDays(row?.value) };
  }

  async setRetention(ctx: TenantRequestContext, days: number | null) {
    const value = days === null || days === 0 ? '0' : String(days);
    if (days !== null && days !== 0 && (!Number.isInteger(days) || days < 30 || days > 3650)) throw new BadRequestException('مدت نگهداشت باید بین ۳۰ تا ۳۶۵۰ روز باشد (یا ۰ برای همیشه)');
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: RETENTION_MODULE, key: RETENTION_KEY } },
      create: { moduleCode: RETENTION_MODULE, key: RETENTION_KEY, value },
      update: { value },
    });
    return { retentionDays: parseRetentionDays(value) };
  }
}
