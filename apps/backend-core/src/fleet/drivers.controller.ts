import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { DriversService } from './drivers.service.js';
import { CreateDriverDto } from './dto/create-driver.dto.js';
import { UpdateDriverDto } from './dto/update-driver.dto.js';

@Controller('fleet/drivers')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('fleet')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Query('isActive') isActive: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'fleet');
    return this.drivers.list(ctx, { isActive: isActive === undefined ? undefined : isActive === 'true' });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'fleet');
    return this.drivers.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateDriverDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'fleet');
    return this.drivers.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDriverDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'fleet');
    return this.drivers.update(ctx, id, dto);
  }

  @Delete(':id')
  async deactivate(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'fleet');
    return this.drivers.deactivate(ctx, id);
  }
}
