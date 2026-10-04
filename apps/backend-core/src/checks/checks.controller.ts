import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { assertInScope } from '../permissions/scope.util.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ChecksService } from './checks.service.js';
import { CreateCheckDto } from './dto/create-check.dto.js';
import { UpdateCheckReminderDto } from './dto/update-check-reminder.dto.js';
import { EndorseCheckDto } from './dto/endorse-check.dto.js';
import { UpdateChecksSmsSettingsDto } from './dto/update-checks-sms-settings.dto.js';

@Controller('checks')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('checks')
export class ChecksController {
  constructor(
    private readonly checks: ChecksService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * چک‌ها هم به فروش (دریافتی) و هم خرید (صادرشده) مربوط می‌شوند: چک دریافتی تابع دسترسی ماژول فروش و چک صادرشده
   * تابع ماژول خرید است — «مشاهده‌ی همه» همه‌ی چک‌های آن جهت، «فقط خودم» فقط چک‌های ثبت‌شده‌ی خودش. بدون هیچ‌کدام → ۴۰۳.
   */
  private async checkScope(ctx: TenantRequestContext): Promise<Record<string, unknown>> {
    const [sales, purchasing] = await Promise.all([
      this.permissions.getEffective(ctx, 'sales'),
      this.permissions.getEffective(ctx, 'purchasing'),
    ]);
    if (sales.canViewAll && purchasing.canViewAll) return {};
    const me = !(sales.canViewAll && purchasing.canViewAll) ? await resolveTenantUserId(ctx) : null;
    const branches: Record<string, unknown>[] = [];
    if (sales.canViewAll) branches.push({ direction: 'RECEIVED' });
    else if (sales.canViewOwn) branches.push({ direction: 'RECEIVED', createdByUserId: me });
    if (purchasing.canViewAll) branches.push({ direction: 'ISSUED' });
    else if (purchasing.canViewOwn) branches.push({ direction: 'ISSUED', createdByUserId: me });
    if (branches.length === 0) throw new ForbiddenException('اجازه‌ی مشاهده‌ی چک‌ها را ندارید');
    return { OR: branches };
  }

  private async assertCheckInScope(ctx: TenantRequestContext, id: string) {
    await assertInScope(ctx.tenantDb.check, await this.checkScope(ctx), { id }, { message: 'چک یافت نشد' });
  }

  @Get()
  async list(
    @Query('direction') direction: 'RECEIVED' | 'ISSUED' | undefined,
    @Query('status') status: string | undefined,
    @Query('dueSoonDays') dueSoonDays: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    const scope = await this.checkScope(ctx);
    return this.checks.list(
      ctx,
      { direction, status, dueSoonDays: dueSoonDays ? Number(dueSoonDays) : undefined, contactId },
      scope,
    );
  }

  @Get('settings/reminder-channels')
  async getReminderChannels(@Ctx() ctx: TenantRequestContext) {
    return this.checks.getReminderChannels(ctx.tenantDb);
  }

  @Put('settings/reminder-channels')
  async setReminderChannels(
    @Body() body: { sms?: boolean; notification?: boolean },
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'sales');
    const current = await this.checks.getReminderChannels(ctx.tenantDb);
    const updated = { sms: body.sms ?? current.sms, notification: body.notification ?? current.notification };
    await this.checks.setReminderChannels(ctx, updated);
    return updated;
  }

  @Get('settings/sms')
  async getSmsSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'sales');
    return this.checks.getSmsSettings(ctx);
  }

  @Put('settings/sms')
  async setSmsSettings(@Body() dto: UpdateChecksSmsSettingsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.checks.setSmsSettings(ctx, dto);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.checks.detail(ctx, id, await this.checkScope(ctx));
  }

  @Post()
  async create(@Body() dto: CreateCheckDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, dto.direction === 'RECEIVED' ? 'sales' : 'purchasing');
    return this.checks.create(ctx, dto);
  }

  @Post(':id/deposit')
  async markDeposited(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    await this.assertCheckInScope(ctx, id);
    return this.checks.markDeposited(ctx, id);
  }

  @Post(':id/clear')
  async markCleared(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    await this.assertCheckInScope(ctx, id);
    return this.checks.markCleared(ctx, id);
  }

  @Post(':id/bounce')
  async markBounced(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    await this.assertCheckInScope(ctx, id);
    return this.checks.markBounced(ctx, id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    await this.assertCheckInScope(ctx, id);
    return this.checks.cancel(ctx, id);
  }

  @Post(':id/endorse')
  async endorse(@Param('id') id: string, @Body() dto: EndorseCheckDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    await this.assertCheckInScope(ctx, id);
    return this.checks.endorse(ctx, id, dto.toContactId);
  }

  @Put(':id/reminder-days')
  async updateReminderDays(
    @Param('id') id: string,
    @Body() dto: UpdateCheckReminderDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'sales');
    await this.assertCheckInScope(ctx, id);
    return this.checks.updateReminderDays(ctx, id, dto.reminderDaysBefore);
  }
}
