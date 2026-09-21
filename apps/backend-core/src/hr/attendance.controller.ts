import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { MarkAttendanceDto } from './dto/mark-attendance.dto.js';

function startOfDay(iso: string): Date {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d;
}

@Controller('hr/attendance')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class AttendanceController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Query('date') dateParam: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'hr');
    const date = startOfDay(dateParam ?? new Date().toISOString());

    const [employees, records] = await Promise.all([
      ctx.tenantDb.employee.findMany({ where: { status: 'ACTIVE' }, orderBy: { fullName: 'asc' } }),
      ctx.tenantDb.attendanceRecord.findMany({ where: { date } }),
    ]);

    const byEmployee = new Map(records.map((r) => [r.employeeId, r]));
    return employees.map((employee) => ({
      employee,
      record: byEmployee.get(employee.id) ?? null,
    }));
  }

  @Post()
  async mark(@Body() dto: MarkAttendanceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'hr');
    if (dto.checkIn && dto.checkOut && new Date(dto.checkOut) < new Date(dto.checkIn)) {
      throw new BadRequestException('زمان خروج نمی‌تواند قبل از زمان ورود باشد');
    }
    const date = startOfDay(dto.date);
    const record = await ctx.tenantDb.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: dto.employeeId, date } },
      create: {
        employeeId: dto.employeeId,
        date,
        status: dto.status,
        checkIn: dto.checkIn ? new Date(dto.checkIn) : undefined,
        checkOut: dto.checkOut ? new Date(dto.checkOut) : undefined,
      },
      update: {
        status: dto.status,
        ...(dto.checkIn ? { checkIn: new Date(dto.checkIn) } : {}),
        ...(dto.checkOut ? { checkOut: new Date(dto.checkOut) } : {}),
      },
    });
    return record;
  }
}
