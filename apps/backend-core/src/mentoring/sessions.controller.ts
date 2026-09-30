import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { SessionsService } from './sessions.service.js';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { UpdateSessionDto } from './dto/update-session.dto.js';
import { CompleteSessionDto } from './dto/complete-session.dto.js';
import { CancelSessionDto } from './dto/cancel-session.dto.js';
import { CreateSessionInvoiceDto } from './dto/create-session-invoice.dto.js';
import { UpdateMentoringSmsSettingsDto } from './dto/update-mentoring-sms-settings.dto.js';
import { CreateOpportunityDto } from './dto/create-opportunity.dto.js';

@Controller('mentoring/sessions')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('mentoring')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('upcoming')
  async upcoming(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'mentoring');
    return this.sessions.upcomingThisWeek(ctx);
  }

  @Get()
  async list(
    @Query('engagementId') engagementId: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertViewAll(ctx, 'mentoring');
    return this.sessions.list(ctx, {
      engagementId,
      contactId,
      status,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'mentoring');
    return this.sessions.detail(ctx, id);
  }

  @Get('settings/sms')
  async getSmsSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'mentoring');
    return this.sessions.getSmsSettings(ctx);
  }

  @Patch('settings/sms')
  async setSmsSettings(@Body() dto: UpdateMentoringSmsSettingsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'mentoring');
    return this.sessions.setSmsSettings(ctx, dto);
  }

  @Get(':id/suggested-amount')
  async suggestedAmount(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'mentoring');
    return { amount: await this.sessions.suggestedAmount(ctx, id) };
  }

  @Post()
  async create(@Body() dto: CreateSessionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'mentoring');
    return this.sessions.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSessionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'mentoring');
    return this.sessions.update(ctx, id, dto);
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string, @Body() dto: CompleteSessionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'mentoring');
    const publicWebUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    return this.sessions.complete(ctx, id, dto.minutesNote, publicWebUrl, ctx.tenantSlug);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() dto: CancelSessionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'mentoring');
    return this.sessions.cancel(ctx, id, dto.reason);
  }

  @Post(':id/no-show')
  async noShow(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'mentoring');
    return this.sessions.noShow(ctx, id);
  }

  @Post(':id/invoice')
  async createInvoice(@Param('id') id: string, @Body() dto: CreateSessionInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'mentoring');
    return this.sessions.createInvoice(ctx, id, dto);
  }

  /** ساخت فرصت فروش در CRM برای پیگیری بعد از جلسه‌ی تکمیل‌شده. */
  @Post(':id/create-opportunity')
  async createOpportunity(@Param('id') id: string, @Body() dto: CreateOpportunityDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'mentoring');
    await this.permissions.assertCreate(ctx, 'crm');
    return this.sessions.createOpportunity(ctx, id, dto);
  }
}
