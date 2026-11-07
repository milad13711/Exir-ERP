import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { HumanOnly } from '../common/decorators/human-only.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { BaseCurrencyService, CURRENCY_MODULE_CODE } from './base-currency.service.js';
import { ExecuteBaseCurrencyDto, PreviewBaseCurrencyDto, ReverseBaseCurrencyDto, ReverseConfirmationDto } from './dto/base-currency.dto.js';

/**
 * تغییر ارز پایه‌ی سیستم (ریال ⇄ تومان ⇄ ...). فقط مالک، فقط نشست انسانی، فقط با ماژول «تبدیل ارز» فعال.
 * همه‌ی POSTها خودکار در لاگ فعالیت (AuditInterceptor) ثبت می‌شوند؛ رکورد عملیات هم همه‌ی جزئیات را دارد.
 */
@Controller('settings/base-currency')
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard)
@RequireModule(CURRENCY_MODULE_CODE)
@Roles('OWNER')
@HumanOnly()
export class BaseCurrencyController {
  constructor(private readonly service: BaseCurrencyService) {}

  @Get()
  state(@Ctx() ctx: TenantRequestContext) {
    return this.service.getState(ctx);
  }

  @Post('preview')
  preview(@Body() dto: PreviewBaseCurrencyDto, @Ctx() ctx: TenantRequestContext) {
    return this.service.preview(ctx, dto);
  }

  /** ارسال کد تأیید پیامکی به شماره‌ی ثبت‌شده‌ی خود مالک */
  @Post('confirmation')
  confirmation(@Body() dto: PreviewBaseCurrencyDto, @Ctx() ctx: TenantRequestContext) {
    return this.service.requestConfirmation(ctx, { dto });
  }

  /** کد تأیید برای بازگشت یک عملیات (به همان طرح بسته می‌شود) */
  @Post('conversions/:id/confirmation')
  reverseConfirmation(@Param('id') id: string, @Body() dto: ReverseConfirmationDto, @Ctx() ctx: TenantRequestContext) {
    return this.service.requestConfirmation(ctx, { reverseOfId: id, roundingMode: dto.roundingMode });
  }

  @Post('execute')
  execute(@Body() dto: ExecuteBaseCurrencyDto, @Ctx() ctx: TenantRequestContext) {
    return this.service.execute(ctx, dto);
  }

  @Get('conversions')
  history(@Ctx() ctx: TenantRequestContext) {
    return this.service.history(ctx);
  }

  @Get('conversions/:id')
  detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.service.detail(ctx, id);
  }

  @Post('conversions/:id/reverse')
  reverse(@Param('id') id: string, @Body() dto: ReverseBaseCurrencyDto, @Ctx() ctx: TenantRequestContext) {
    return this.service.reverse(ctx, id, dto);
  }
}
