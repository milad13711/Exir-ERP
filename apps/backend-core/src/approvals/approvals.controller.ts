import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ApprovalsService } from './approvals.service.js';
import { DecideApprovalDto } from './dto/decide-approval.dto.js';

/** کارتابل تأیید هر کاربر — مدیران همه‌ی اسناد، سایرین فقط اسناد ارجاع‌شده به خودشان. */
@Controller('approvals')
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(@Ctx() ctx: TenantRequestContext, @Query('status') status?: string) {
    const s = status === 'PENDING' || status === 'APPROVED' || status === 'REJECTED' ? status : undefined;
    return this.approvals.list(ctx, s);
  }

  @Get('pending-count')
  pendingCount(@Ctx() ctx: TenantRequestContext) {
    return this.approvals.pendingCount(ctx);
  }

  @Post(':id/decision')
  decide(@Param('id') id: string, @Body() dto: DecideApprovalDto, @Ctx() ctx: TenantRequestContext) {
    return this.approvals.decide(ctx, id, dto.approved, { withStamp: dto.withStamp, note: dto.note });
  }
}
