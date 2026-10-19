import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { OperationsService } from './operations.service.js';

/**
 * داشبورد عملیات — فقط‌خواندنیِ تجمیع روی ماژول وظایف. دامنه‌ی دید همان وظایف است:
 * مدیر همه را می‌بیند، بقیه فقط نمای شخصی از بار کاری خودشان.
 */
@Controller('operations')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('operations')
export class OperationsController {
  constructor(private readonly ops: OperationsService) {}

  @Get('overview')
  overview(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.ops.overview(ctx, from, to);
  }

  /** فقط شمارنده‌ها — سبک، برای ویجت داشبورد. */
  @Get('counters')
  counters(@Ctx() ctx: TenantRequestContext) {
    return this.ops.counters(ctx);
  }

  @Get('workload')
  workload(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('sort') sort: string | undefined,
    @Query('dir') dir: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    return this.ops.workload(ctx, { from, to, sort, dir });
  }

  @Get('attention')
  attention(@Query('unseenHours') unseenHours: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.ops.attention(ctx, unseenHours);
  }

  @Get('activity')
  activity(@Query('cursor') cursor: string | undefined, @Query('limit') limit: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.ops.activity(ctx, cursor, limit);
  }

  @Get('trend')
  trend(@Query('days') days: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.ops.trend(ctx, days);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async exportCsv(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    const csv = await this.ops.exportCsv(ctx, from, to);
    res.setHeader('Content-Disposition', 'attachment; filename="operations-tasks.csv"');
    res.send(csv);
  }
}
