import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { QuotationsService } from './quotations.service.js';
import { CreateQuotationDto } from './dto/create-quotation.dto.js';
import { UpdateQuotationDto } from './dto/update-quotation.dto.js';

@Controller('sales/quotations')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('sales')
export class QuotationsController {
  constructor(
    private readonly quotations: QuotationsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    return this.quotations.list(ctx, scope);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    return this.quotations.detail(ctx, id, scope);
  }

  @Post()
  async create(@Body() dto: CreateQuotationDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'sales');
    return this.quotations.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateQuotationDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    return this.quotations.update(ctx, id, dto, scope);
  }

  @Post(':id/send')
  async send(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    return this.quotations.send(ctx, id, scope);
  }

  @Post(':id/accept')
  async accept(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    return this.quotations.respond(ctx, id, true, scope);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    return this.quotations.respond(ctx, id, false, scope);
  }

  @Post(':id/convert')
  async convert(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'sales');
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    return this.quotations.convertToInvoice(ctx, id, scope);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'sales');
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    return this.quotations.remove(ctx, id, scope);
  }
}
