import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { CreatePersonnelActionDto } from './dto/create-personnel-action.dto.js';

async function findEmployeeOrThrow(ctx: TenantRequestContext, employeeId: string) {
  const employee = await ctx.tenantDb.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundException('این کارمند یافت نشد');
  return employee;
}

@Controller('hr/rewards')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class PersonnelRewardsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Query('employeeId') employeeId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'hr');
    return ctx.tenantDb.personnelReward.findMany({
      where: employeeId ? { employeeId } : {},
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } }, createdBy: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });
  }

  @Post()
  async create(@Body() dto: CreatePersonnelActionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // رکوردهای مالی/پرسنلی مالک مشخص ندارند — فقط با «مشاهده‌ی همه»
    await findEmployeeOrThrow(ctx, dto.employeeId);
    const createdByUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    return ctx.tenantDb.personnelReward.create({
      data: {
        employeeId: dto.employeeId,
        title: dto.title,
        description: dto.description,
        amount: dto.amount,
        date: dto.date ? new Date(dto.date) : new Date(),
        createdByUserId,
      },
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // رکوردهای مالی/پرسنلی مالک مشخص ندارند — فقط با «مشاهده‌ی همه»
    const row = await ctx.tenantDb.personnelReward.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('این پاداش یافت نشد');
    await ctx.tenantDb.personnelReward.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('hr/penalties')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class PersonnelPenaltiesController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Query('employeeId') employeeId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'hr');
    return ctx.tenantDb.personnelPenalty.findMany({
      where: employeeId ? { employeeId } : {},
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } }, createdBy: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });
  }

  @Post()
  async create(@Body() dto: CreatePersonnelActionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // رکوردهای مالی/پرسنلی مالک مشخص ندارند — فقط با «مشاهده‌ی همه»
    await findEmployeeOrThrow(ctx, dto.employeeId);
    const createdByUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    return ctx.tenantDb.personnelPenalty.create({
      data: {
        employeeId: dto.employeeId,
        title: dto.title,
        description: dto.description,
        amount: dto.amount,
        date: dto.date ? new Date(dto.date) : new Date(),
        createdByUserId,
      },
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // رکوردهای مالی/پرسنلی مالک مشخص ندارند — فقط با «مشاهده‌ی همه»
    const row = await ctx.tenantDb.personnelPenalty.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('این جریمه یافت نشد');
    await ctx.tenantDb.personnelPenalty.delete({ where: { id } });
    return { ok: true };
  }
}
