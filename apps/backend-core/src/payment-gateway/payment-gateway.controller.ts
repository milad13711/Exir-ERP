import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PaymentGatewaySettingsService, type UpdatePaymentGatewaySettingsDto } from './payment-gateway-settings.service.js';

@Controller('payment-gateway')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('payment-gateway')
export class PaymentGatewayController {
  constructor(private readonly settings: PaymentGatewaySettingsService) {}

  @Get('settings')
  async getSettings(@Ctx() ctx: TenantRequestContext) {
    return this.settings.getView(ctx);
  }

  @Put('settings')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async updateSettings(@Body() dto: UpdatePaymentGatewaySettingsDto, @Ctx() ctx: TenantRequestContext) {
    return this.settings.update(ctx, dto);
  }
}
