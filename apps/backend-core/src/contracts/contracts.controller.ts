import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ContractsService } from './contracts.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { TerminateContractDto } from './dto/terminate-contract.dto.js';
import { RenewContractDto } from './dto/renew-contract.dto.js';

@Controller('contracts')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('contracts')
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(
    @Query('type') type: string | undefined,
    @Query('status') status: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertView(ctx, 'contracts');
    return this.contracts.list(ctx, { type, status, contactId });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'contracts');
    return this.contracts.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateContractDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'contracts');
    return this.contracts.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateContractDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.update(ctx, id, dto);
  }

  @Post(':id/sign')
  async sign(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.sign(ctx, id);
  }

  @Post(':id/terminate')
  async terminate(@Param('id') id: string, @Body() dto: TerminateContractDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'contracts');
    return this.contracts.terminate(ctx, id, dto.reason);
  }

  @Post(':id/renew')
  async renew(@Param('id') id: string, @Body() dto: RenewContractDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.renew(ctx, id, dto.newEndDate);
  }
}
