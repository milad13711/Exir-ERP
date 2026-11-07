import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { SubscriptionSummaryService } from './subscription-summary.service.js';

class RenewalRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  moduleCode?: string;
}

/**
 * مسیر زیر billing/* است عمداً: تننت در وضعیت PENDING_PAYMENT فقط به همین مسیرها دسترسی دارد (JwtAuthGuard)،
 * و دقیقاً همان‌ها باید بدانند چرا قفل‌اند و چه فاکتوری را باید پرداخت کنند.
 */
@Controller('billing')
@UseGuards(JwtAuthGuard)
export class SubscriptionSummaryController {
  constructor(private readonly summary: SubscriptionSummaryService) {}

  @Get('subscription-summary')
  get(@Ctx() ctx: TenantRequestContext) {
    const admin = ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
    return this.summary.forTenant(ctx.tenantId, { viewer: admin ? 'ADMIN' : 'MEMBER' });
  }

  @Post('renewal-requests')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  request(@Body() dto: RenewalRequestDto, @Ctx() ctx: TenantRequestContext) {
    return this.summary.requestRenewal(ctx.tenantId, dto.moduleCode);
  }
}
