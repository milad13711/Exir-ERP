import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ServiceTypesService } from './service-types.service.js';
import { CreateServiceTypeDto } from './dto/create-service-type.dto.js';
import { UpdateServiceTypeDto } from './dto/update-service-type.dto.js';

@Controller('booking/service-types')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('booking')
export class ServiceTypesController {
  constructor(
    private readonly serviceTypes: ServiceTypesService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Query('includeInactive') includeInactive: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'booking');
    return this.serviceTypes.list(ctx, includeInactive === 'true');
  }

  @Post()
  async create(@Body() dto: CreateServiceTypeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'booking');
    return this.serviceTypes.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateServiceTypeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'booking');
    return this.serviceTypes.update(ctx, id, dto);
  }

  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'booking');
    return this.serviceTypes.deactivate(ctx, id);
  }
}
