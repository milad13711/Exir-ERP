import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly permissions: PermissionsService,
  ) {}

  /** خلاصه‌ی داشبورد — هر بخش فقط اگر کاربر مجوز مشاهده‌ی ماژول مربوطه را دارد پر می‌شود (بقیه خالی/صفر). */
  @Get('summary')
  async summary(@Ctx() ctx: TenantRequestContext) {
    const [data, acl] = await Promise.all([this.dashboard.summary(ctx), this.permissions.effectiveMatrix(ctx)]);
    if (acl.manager) return data;
    const can = (code: string) => !!acl.modules[code] && (acl.modules[code].canViewAll || acl.modules[code].canViewOwn);
    return {
      ...data,
      cashBalance: can('accounting') ? data.cashBalance : 0,
      checksDueSoon: can('accounting') ? data.checksDueSoon : { total: 0, count: 0, items: [] },
      monthInvoiceCount: can('sales') ? data.monthInvoiceCount : 0,
      overdueReceivables: can('sales') ? data.overdueReceivables : { total: 0, count: 0, items: [] },
      salesTrend: can('sales') ? data.salesTrend : data.salesTrend.map((p) => ({ ...p, value: 0 })),
      customerFollowUps: can('sales') || can('crm') ? data.customerFollowUps : [],
      lowStockCount: can('warehouse') ? data.lowStockCount : 0,
      producibleCapacity: can('production') || can('warehouse') ? data.producibleCapacity : [],
      productionTrend: can('production') ? data.productionTrend : data.productionTrend.map((p) => ({ ...p, value: 0, valueLastYear: 0 })),
    };
  }
}
