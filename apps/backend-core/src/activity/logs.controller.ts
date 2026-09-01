import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

const MAX_PAGE_SIZE = 100;

function parsePaging(pageParam: string | undefined, pageSizeParam: string | undefined) {
  const page = Math.max(1, Number(pageParam) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSizeParam) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function parseDateRange(from: string | undefined, to: string | undefined) {
  const gte = from ? new Date(from) : undefined;
  const lte = to ? new Date(to) : undefined;
  return gte || lte ? { gte, lte } : undefined;
}

/**
 * Tenant-facing view of what the "لاگ فعالیت‌ها و خطاها" settings screen
 * shows — separate from /activity (the dashboard's small recent-activity
 * widget) so that page's response shape can stay simple and unpaginated.
 */
@Controller('logs')
@UseGuards(JwtAuthGuard)
export class LogsController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get('activity')
  async activity(
    @Query('module') module: string | undefined,
    @Query('userId') userId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') pageParam: string | undefined,
    @Query('pageSize') pageSizeParam: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    const { page, pageSize, skip } = parsePaging(pageParam, pageSizeParam);
    const where = {
      userId: userId || undefined,
      action: module ? { startsWith: `${module}.` } : undefined,
      createdAt: parseDateRange(from, to),
    };

    const [items, total] = await Promise.all([
      ctx.tenantDb.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { user: { select: { name: true } } },
      }),
      ctx.tenantDb.activityLog.count({ where }),
    ]);

    return {
      items: items.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        metadata: log.metadata,
        userName: log.user?.name ?? null,
        createdAt: log.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  @Get('activity/modules')
  async activityModules(@Ctx() ctx: TenantRequestContext) {
    const rows = await ctx.tenantDb.$queryRaw<Array<{ module: string }>>`
      SELECT DISTINCT split_part(action, '.', 1) AS module FROM activity_logs ORDER BY module
    `;
    return rows.map((r) => r.module);
  }

  @Get('errors')
  async errors(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') pageParam: string | undefined,
    @Query('pageSize') pageSizeParam: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    const { page, pageSize, skip } = parsePaging(pageParam, pageSizeParam);
    const where = { tenantId: ctx.tenantId, createdAt: parseDateRange(from, to) };

    const [items, total] = await Promise.all([
      this.controlDb.errorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.controlDb.errorLog.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}
