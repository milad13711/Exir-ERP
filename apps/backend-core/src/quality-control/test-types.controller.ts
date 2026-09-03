import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateTestTypeDto } from './dto/create-test-type.dto.js';

@Controller('quality-control/test-types')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('quality-control')
export class TestTypesController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'quality-control');
    return ctx.tenantDb.qualityTestType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  @Post()
  async create(@Body() dto: CreateTestTypeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'quality-control');
    return ctx.tenantDb.qualityTestType.create({
      data: {
        name: dto.name,
        unit: dto.unit,
        acceptableMin: dto.acceptableMin,
        acceptableMax: dto.acceptableMax,
        description: dto.description,
      },
    });
  }
}
