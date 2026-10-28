import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { SalesAccountingBackfillService } from './sales-accounting-backfill.service.js';
import { RunAccountingBackfillDto } from './dto/run-accounting-backfill.dto.js';

/** «ثبت اسناد حسابداری فاکتورهای قبلی» — فقط مالک/مدیر؛ فقط وقتی حسابداری نصب است قابل اجراست (پیش‌نمایش همیشه پاسخ می‌دهد). */
@Controller('sales/accounting-backfill')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('sales')
export class SalesAccountingBackfillController {
  constructor(private readonly backfill: SalesAccountingBackfillService) {}

  @Get('preview')
  preview(@Ctx() ctx: TenantRequestContext) {
    return this.backfill.preview(ctx);
  }

  @Get('report')
  async report(@Ctx() ctx: TenantRequestContext) {
    this.backfill.assertManager(ctx);
    return { report: await this.backfill.lastReport(ctx) };
  }

  @Post('run')
  run(@Body() dto: RunAccountingBackfillDto, @Ctx() ctx: TenantRequestContext) {
    return this.backfill.runBatch(ctx, dto);
  }
}
