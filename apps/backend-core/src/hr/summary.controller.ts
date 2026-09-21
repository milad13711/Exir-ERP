import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';

function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

@Controller('hr/summary')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class HrSummaryController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async summary(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'hr');
    const today = startOfDay();
    const [totalEmployees, presentToday, pendingLeaveCount, monthlyPayrollTotal] = await Promise.all([
      ctx.tenantDb.employee.count({ where: { status: 'ACTIVE' } }),
      ctx.tenantDb.attendanceRecord.count({ where: { date: today, status: 'PRESENT' } }),
      ctx.tenantDb.leaveRequest.count({ where: { status: 'PENDING' } }),
      ctx.tenantDb.employee.aggregate({ where: { status: 'ACTIVE' }, _sum: { baseSalary: true } }),
    ]);

    return {
      totalEmployees,
      presentToday,
      pendingLeaveCount,
      monthlyPayrollTotal: monthlyPayrollTotal._sum.baseSalary ?? 0,
    };
  }
}
