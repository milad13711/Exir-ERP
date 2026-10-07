import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { DailyReportSubmissionService, parseCutoff } from './daily-report-submissions.service.js';
import { MODULE_LABELS } from './activity-route.util.js';

const MAX_PAGE_SIZE = 100;
const TEHRAN_OFFSET = '+03:30';
export const LOGS_PERMISSION_CODE = 'logs';

function parsePaging(pageParam: string | undefined, pageSizeParam: string | undefined) {
  const page = Math.max(1, Number(pageParam) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSizeParam) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

/** yyyy-mm-dd (میلادی، همان خروجی انتخابگر تاریخ) → ابتدای روز تهران؛ `to` تا انتهای همان روز (شامل). */
export function parseDateRange(from: string | undefined, to: string | undefined) {
  const start = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00${TEHRAN_OFFSET}`) : new Date(v));
  const end = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(new Date(`${v}T00:00:00${TEHRAN_OFFSET}`).getTime() + 86_400_000 - 1) : new Date(v));
  const gte = from ? start(from) : undefined;
  const lte = to ? end(to) : undefined;
  if ((gte && Number.isNaN(gte.getTime())) || (lte && Number.isNaN(lte.getTime()))) throw new BadRequestException('بازه‌ی تاریخ نامعتبر است');
  return gte || lte ? { gte, lte } : undefined;
}

export type LogScope = { all: true } | { all: false; userId: string | null };

const ACTOR_TYPES = new Set(['MANUAL', 'AUTOMATIC', 'SYSTEM']);

/** ساخت where لاگ فعالیت از فیلترها + محدودسازی دسترسی (در سرور؛ هرگز از کلاینت). */
export function buildActivityWhere(
  scope: LogScope,
  f: { module?: string; userId?: string; actorType?: string; actionType?: string; q?: string; from?: string; to?: string },
) {
  const and: object[] = [];
  if (!scope.all) and.push({ userId: scope.userId ?? '__none__' });
  else if (f.userId) and.push({ userId: f.userId });
  if (f.module) and.push({ OR: [{ moduleCode: f.module }, { moduleCode: null, action: { startsWith: `${f.module}.` } }] });
  if (f.actorType && ACTOR_TYPES.has(f.actorType)) and.push({ actorType: f.actorType });
  if (f.actionType) and.push({ actionType: f.actionType });
  const q = f.q?.trim();
  if (q) {
    and.push({ OR: [{ summary: { contains: q, mode: 'insensitive' } }, { action: { contains: q, mode: 'insensitive' } }, { entityId: q }] });
  }
  const createdAt = parseDateRange(f.from, f.to);
  if (createdAt) and.push({ createdAt });
  return and.length ? { AND: and } : {};
}

function present(log: {
  id: string; action: string; actorType: string; moduleCode: string | null; actionType: string | null; summary: string | null; entityType: string; entityId: string | null;
  userId: string | null; ip: string | null; metadata: unknown; createdAt: Date; user?: { name: string } | null;
}) {
  return {
    id: log.id,
    action: log.action,
    actorType: log.actorType,
    moduleCode: log.moduleCode ?? log.action.split('.')[0],
    actionType: log.actionType,
    summary: log.summary,
    entityType: log.entityType,
    entityId: log.entityId,
    userId: log.userId,
    userName: log.user?.name ?? null,
    ip: log.ip,
    metadata: log.metadata,
    createdAt: log.createdAt,
  };
}

/**
 * نمای تننت از «لاگ‌ها». مدل دسترسی (سخت‌گیرانه، سمت سرور):
 *  - OWNER/ADMIN: فعالیت همه (شامل اقدام‌های خودکار/سیستمی بدون کاربر)
 *  - کاربر دارای «مشاهده‌ی همه» روی مجوز `logs` در ماتریس نقش‌ها: همه
 *  - بقیه: فقط ردیف‌های خودشان (چه در فهرست، چه در خلاصه، چه با شناسه)
 * خطاهای سیستم فقط مدیران.
 */
@Controller('logs')
@UseGuards(JwtAuthGuard)
export class LogsController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly permissions: PermissionsService,
    private readonly submissions: DailyReportSubmissionService,
  ) {}

  private isManager(ctx: TenantRequestContext): boolean {
    return ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
  }

  async resolveScope(ctx: TenantRequestContext): Promise<LogScope> {
    if (this.isManager(ctx)) return { all: true };
    const matrix = await this.permissions.getEffective(ctx, LOGS_PERMISSION_CODE);
    if (matrix.canViewAll) return { all: true };
    return { all: false, userId: await resolveTenantUserId(ctx).catch(() => null) };
  }

  @Get('activity')
  async activity(
    @Query('module') module: string | undefined,
    @Query('userId') userId: string | undefined,
    @Query('actorType') actorType: string | undefined,
    @Query('actionType') actionType: string | undefined,
    @Query('q') q: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') pageParam: string | undefined,
    @Query('pageSize') pageSizeParam: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    const scope = await this.resolveScope(ctx);
    const { page, pageSize, skip } = parsePaging(pageParam, pageSizeParam);
    const where = buildActivityWhere(scope, { module, userId, actorType, actionType, q, from, to });

    const [items, total] = await Promise.all([
      ctx.tenantDb.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize, include: { user: { select: { name: true } } } }),
      ctx.tenantDb.activityLog.count({ where }),
    ]);
    return { items: items.map(present), total, page, pageSize, scope: scope.all ? 'ALL' : 'OWN' };
  }

  @Get('activity/modules')
  async activityModules(@Ctx() ctx: TenantRequestContext) {
    const scope = await this.resolveScope(ctx);
    const rows = scope.all
      ? await ctx.tenantDb.$queryRaw<Array<{ module: string }>>`
          SELECT DISTINCT COALESCE("moduleCode", split_part(action, '.', 1)) AS module FROM activity_logs ORDER BY module`
      : await ctx.tenantDb.$queryRaw<Array<{ module: string }>>`
          SELECT DISTINCT COALESCE("moduleCode", split_part(action, '.', 1)) AS module FROM activity_logs WHERE "userId" = ${scope.userId ?? '__none__'} ORDER BY module`;
    return rows.map((r) => r.module).filter(Boolean);
  }

  /** فهرست افراد برای فیلتر «شخص»: مدیر/دارای مشاهده‌ی همه → همه‌ی کاربران؛ بقیه فقط خودشان. */
  @Get('activity/users')
  async activityUsers(@Ctx() ctx: TenantRequestContext) {
    const scope = await this.resolveScope(ctx);
    return ctx.tenantDb.user.findMany({
      where: scope.all ? {} : { id: scope.userId ?? '__none__' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
  }

  /** خلاصه‌ی روزانه‌ی هر فرد: تعداد به تفکیک ماژول/نوع عمل، دستی/خودکار، اولین و آخرین فعالیت. */
  @Get('activity/daily-summary')
  async dailySummary(@Query('date') date: string | undefined, @Query('userId') userId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.resolveScope(ctx);
    const ymd = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
    const range = parseDateRange(ymd, ymd)!;
    const base = buildActivityWhere(scope, { userId, from: ymd, to: ymd });
    const where = { AND: [base, { userId: { not: null } }] };

    const [byUser, byModule, byAction] = await Promise.all([
      ctx.tenantDb.activityLog.groupBy({ by: ['userId', 'actorType'], where, _count: { _all: true }, _min: { createdAt: true }, _max: { createdAt: true } }),
      ctx.tenantDb.activityLog.groupBy({ by: ['userId', 'moduleCode'], where, _count: { _all: true } }),
      ctx.tenantDb.activityLog.groupBy({ by: ['userId', 'actionType'], where, _count: { _all: true } }),
    ]);

    type Person = { userId: string; total: number; manual: number; automatic: number; firstAt: Date | null; lastAt: Date | null; modules: Record<string, number>; actions: Record<string, number> };
    const people = new Map<string, Person>();
    const get = (id: string): Person => {
      let p = people.get(id);
      if (!p) {
        p = { userId: id, total: 0, manual: 0, automatic: 0, firstAt: null, lastAt: null, modules: {}, actions: {} };
        people.set(id, p);
      }
      return p;
    };
    for (const g of byUser) {
      const p = get(g.userId!);
      p.total += g._count._all;
      if (g.actorType === 'MANUAL') p.manual += g._count._all;
      else p.automatic += g._count._all;
      if (g._min.createdAt && (!p.firstAt || g._min.createdAt < p.firstAt)) p.firstAt = g._min.createdAt;
      if (g._max.createdAt && (!p.lastAt || g._max.createdAt > p.lastAt)) p.lastAt = g._max.createdAt;
    }
    for (const g of byModule) {
      const p = get(g.userId!);
      const k = g.moduleCode ?? 'other';
      p.modules[k] = (p.modules[k] ?? 0) + g._count._all;
    }
    for (const g of byAction) {
      const p = get(g.userId!);
      const k = g.actionType ?? 'other';
      p.actions[k] = (p.actions[k] ?? 0) + g._count._all;
    }

    const users = people.size ? await ctx.tenantDb.user.findMany({ where: { id: { in: [...people.keys()] } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      date: ymd,
      from: range.gte,
      to: range.lte,
      people: [...people.values()]
        .map((p) => ({ ...p, userName: names.get(p.userId) ?? '—', moduleLabels: Object.fromEntries(Object.keys(p.modules).map((m) => [m, MODULE_LABELS[m] ?? m])) }))
        .sort((a, b) => b.total - a.total),
    };
  }

  @Get('activity/:id')
  async activityById(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.resolveScope(ctx);
    const where = buildActivityWhere(scope, {});
    const log = await ctx.tenantDb.activityLog.findFirst({ where: { AND: [where, { id }] }, include: { user: { select: { name: true } } } });
    if (!log) throw new NotFoundException('رکورد لاگ یافت نشد');
    return present(log);
  }

  // ── ساعت ثبت گزارش کار روزانه به‌ازای هر فرد ────────────────────────────

  @Get('daily-reports')
  async dailyReports(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('userId') userId: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    const scope = await this.resolveScope(ctx);
    const userIds = scope.all ? (userId ? [userId] : undefined) : [scope.userId ?? '__none__'];
    return this.submissions.compute(ctx.tenantDb, { from, to, userIds });
  }

  @Get('daily-reports/settings')
  async getSettings(@Ctx() ctx: TenantRequestContext) {
    return { cutoff: await this.submissions.getCutoff(ctx.tenantDb) };
  }

  /** ساعت «به‌موقع» (به وقت تهران) — فقط مدیران. */
  @Put('daily-reports/settings')
  async putSettings(@Body() body: { hour?: number; minute?: number; time?: string }, @Ctx() ctx: TenantRequestContext) {
    if (!this.isManager(ctx)) throw new ForbiddenException('فقط مدیران می‌توانند این تنظیم را تغییر دهند');
    const cutoff = parseCutoff(body.time ?? { hour: body.hour, minute: body.minute });
    return { cutoff: await this.submissions.setCutoff(ctx.tenantDb, cutoff) };
  }

  @Get('errors')
  async errors(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') pageParam: string | undefined,
    @Query('pageSize') pageSizeParam: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    if (!this.isManager(ctx)) throw new ForbiddenException('فقط مدیران به خطاهای سیستم دسترسی دارند');
    const { page, pageSize, skip } = parsePaging(pageParam, pageSizeParam);
    const where = { tenantId: ctx.tenantId, createdAt: parseDateRange(from, to) };
    const [items, total] = await Promise.all([
      this.controlDb.errorLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      this.controlDb.errorLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
