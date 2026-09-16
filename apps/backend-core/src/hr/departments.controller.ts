import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto.js';

const DEPARTMENT_INCLUDE = {
  manager: { select: { id: true, fullName: true } },
  _count: { select: { employees: true } },
} as const;

/** واحد سازمانی — یک مدیر مشخص که ناظر تمام پرونده‌های پرسنلی اعضای همان واحد است (org-chain.util.ts). */
@Controller('hr/departments')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class DepartmentsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'hr');
    return ctx.tenantDb.department.findMany({ include: DEPARTMENT_INCLUDE, orderBy: { name: 'asc' } });
  }

  @Post()
  async create(@Body() dto: CreateDepartmentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'hr');
    const existing = await ctx.tenantDb.department.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('واحدی با این نام از قبل وجود دارد');
    return ctx.tenantDb.department.create({
      data: { name: dto.name, managerId: dto.managerId },
      include: DEPARTMENT_INCLUDE,
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'hr');
    const existing = await ctx.tenantDb.department.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('واحد سازمانی یافت نشد');
    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await ctx.tenantDb.department.findUnique({ where: { name: dto.name } });
      if (nameTaken) throw new ConflictException('واحدی با این نام از قبل وجود دارد');
    }
    return ctx.tenantDb.department.update({
      where: { id },
      data: { name: dto.name, managerId: dto.managerId },
      include: DEPARTMENT_INCLUDE,
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'hr');
    const existing = await ctx.tenantDb.department.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
    if (!existing) throw new NotFoundException('واحد سازمانی یافت نشد');
    if (existing._count.employees > 0) {
      throw new ConflictException('این واحد سازمانی هنوز کارمند دارد — ابتدا کارمندان را به واحد دیگری منتقل کنید');
    }
    await ctx.tenantDb.department.delete({ where: { id } });
    return { success: true };
  }
}
