import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateWorkCenterDto } from './dto/create-work-center.dto.js';

@Controller('production/work-centers')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('production')
export class WorkCentersController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'production');
    return ctx.tenantDb.workCenter.findMany({ orderBy: { sequenceOrder: 'asc' } });
  }

  @Post()
  async create(@Body() dto: CreateWorkCenterDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'production');
    return ctx.tenantDb.workCenter.create({
      data: { name: dto.name, sequenceOrder: dto.sequenceOrder ?? 0 },
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: CreateWorkCenterDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'production');
    const existing = await ctx.tenantDb.workCenter.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('ایستگاه تولید یافت نشد');
    return ctx.tenantDb.workCenter.update({
      where: { id },
      data: { name: dto.name, sequenceOrder: dto.sequenceOrder ?? existing.sequenceOrder },
    });
  }
}
