import { Body, Controller, ForbiddenException, Get, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { parseChangesQuery } from './sync-changes.js';
import { SyncPolicyService } from './sync-policy.service.js';
import { SyncService } from './sync.service.js';

function assertManager(ctx: TenantRequestContext): void {
  if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') throw new ForbiddenException('فقط مالک یا مدیر');
}

/**
 * نقاط پایانی همگام‌سازی آفلاین. ارسال دسته‌ای (batch) عمداً وجود ندارد: کلاینت هر درخواست صف را جداگانه و از همان
 * خط لوله‌ی عادی (گارد/اعتبارسنجی/ممیزی/Idempotency) بازپخش می‌کند تا هیچ مسیر دورزننده‌ی مجوزی ساخته نشود.
 */
@Controller('sync')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('offline-sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly policies: SyncPolicyService,
  ) {}

  @Get('bootstrap')
  bootstrap(@Ctx() ctx: TenantRequestContext) {
    return this.sync.bootstrap(ctx);
  }

  @Get('changes')
  changes(@Query() query: Record<string, unknown>, @Ctx() ctx: TenantRequestContext) {
    return this.sync.changes(ctx, parseChangesQuery(query));
  }

  @Get('policy')
  policy(@Ctx() ctx: TenantRequestContext) {
    return this.policies.get(ctx);
  }

  @Put('policy')
  async setPolicy(@Body() body: unknown, @Ctx() ctx: TenantRequestContext) {
    assertManager(ctx);
    return this.policies.put(ctx, body);
  }

  @Get('status')
  async status(@Ctx() ctx: TenantRequestContext) {
    assertManager(ctx);
    return this.sync.status(ctx);
  }
}
