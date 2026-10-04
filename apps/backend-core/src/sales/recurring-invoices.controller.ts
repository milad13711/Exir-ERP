import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { RecurringInvoicesService } from './recurring-invoices.service.js';
import { CreateRecurringInvoiceDto } from './dto/create-recurring-invoice.dto.js';
import { UpdateRecurringInvoiceDto } from './dto/update-recurring-invoice.dto.js';

@Controller('sales/recurring-invoices')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('sales')
export class RecurringInvoicesController {
  constructor(
    private readonly recurring: RecurringInvoicesService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'sales');
    return this.recurring.list(ctx);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'sales');
    return this.recurring.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateRecurringInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'sales');
    return this.recurring.create(ctx, dto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateRecurringInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    await this.permissions.assertViewAll(ctx, 'sales'); // قالب‌های دوره‌ای مالکِ مشخصی ندارند — فقط با «مشاهده‌ی همه»
    return this.recurring.update(ctx, id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'sales');
    await this.permissions.assertViewAll(ctx, 'sales');
    return this.recurring.remove(ctx, id);
  }
}
