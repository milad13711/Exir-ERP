import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ReassignReferralDto, ReferDocumentDto, RespondReferralDto } from './dto/referral.dto.js';
import { ReferralsService } from './referrals.service.js';

/**
 * ارجاع عمومی سند. دسترسی هر مسیر داخل سرویس سنجیده می‌شود (دید سند + حق ارجاع)؛ ماژول خاصی لازم نیست
 * چون گیرنده ممکن است ماژول مبدأ را در منو نداشته باشد.
 */
@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Post()
  refer(@Body() dto: ReferDocumentDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.refer(ctx, dto);
  }

  @Get('inbox')
  inbox(@Query('view') view: string | undefined, @Query('entityType') entityType: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.inbox(ctx, view ?? 'active', entityType);
  }

  @Get('counts')
  counts(@Ctx() ctx: TenantRequestContext) {
    return this.referrals.counts(ctx);
  }

  @Get('mine-ids')
  mineIds(@Query('entityType') entityType: string, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.myEntityIds(ctx, entityType);
  }

  @Get('assignees')
  assignees(@Query('entityType') entityType: string, @Query('ids') ids: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.assignees(ctx, entityType, (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  }

  @Get('entity/:entityType/:entityId')
  forEntity(@Param('entityType') entityType: string, @Param('entityId') entityId: string, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.forEntity(ctx, entityType, entityId);
  }

  @Post(':id/accept')
  accept(@Param('id') id: string, @Body() dto: RespondReferralDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.respond(ctx, id, 'accept', dto?.note);
  }

  @Post(':id/return')
  returnIt(@Param('id') id: string, @Body() dto: RespondReferralDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.respond(ctx, id, 'return', dto?.note);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() dto: RespondReferralDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.respond(ctx, id, 'complete', dto?.note);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: RespondReferralDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.respond(ctx, id, 'cancel', dto?.note);
  }

  @Post(':id/revoke')
  revoke(@Param('id') id: string, @Body() dto: RespondReferralDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.respond(ctx, id, 'revoke', dto?.note);
  }

  @Post(':id/reassign')
  reassign(@Param('id') id: string, @Body() dto: ReassignReferralDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.reassign(ctx, id, dto);
  }
}
