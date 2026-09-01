import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { CreateCurrencyDto } from './dto/create-currency.dto.js';
import { UpdateCurrencyDto } from './dto/update-currency.dto.js';

/**
 * نرخ‌های ارز — تومان ارز پایه‌ی ضمنی است و ردیفی اینجا ندارد. نرخ‌ها فعلاً
 * دستی‌اند و مسئول به‌روز نگه‌داشتنشان کاربر است؛ اتصال به API نرخ لحظه‌ای
 * ماژول جداگانه‌ی بعدی خواهد بود.
 */
@Controller('settings/currencies')
@UseGuards(JwtAuthGuard)
export class CurrenciesController {
  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    return ctx.tenantDb.currency.findMany({ orderBy: { code: 'asc' } });
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async create(@Body() dto: CreateCurrencyDto, @Ctx() ctx: TenantRequestContext) {
    const code = dto.code.trim().toUpperCase();
    const existing = await ctx.tenantDb.currency.findUnique({ where: { code } });
    if (existing) throw new ConflictException('این ارز قبلاً ثبت شده است');
    return ctx.tenantDb.currency.create({
      data: { code, name: dto.name, symbol: dto.symbol, rate: dto.rate, isActive: dto.isActive ?? true },
    });
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async update(@Param('id') id: string, @Body() dto: UpdateCurrencyDto, @Ctx() ctx: TenantRequestContext) {
    const existing = await ctx.tenantDb.currency.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('ارز یافت نشد');
    return ctx.tenantDb.currency.update({
      where: { id },
      data: { name: dto.name, symbol: dto.symbol, rate: dto.rate, isActive: dto.isActive },
    });
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const existing = await ctx.tenantDb.currency.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('ارز یافت نشد');
    const inUse = await ctx.tenantDb.product.findFirst({ where: { currencyId: id } });
    if (inUse) throw new ConflictException('این ارز روی کالاهایی استفاده شده و قابل حذف نیست — می‌توانید غیرفعالش کنید');
    await ctx.tenantDb.currency.delete({ where: { id } });
    return { success: true };
  }
}
