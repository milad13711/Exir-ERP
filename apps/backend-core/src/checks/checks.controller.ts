import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ChecksService } from './checks.service.js';
import { CreateCheckDto } from './dto/create-check.dto.js';
import { UpdateCheckReminderDto } from './dto/update-check-reminder.dto.js';
import { EndorseCheckDto } from './dto/endorse-check.dto.js';

@Controller('checks')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('checks')
export class ChecksController {
  constructor(
    private readonly checks: ChecksService,
    private readonly permissions: PermissionsService,
  ) {}

  /** چک‌ها هم به فروش (دریافتی) و هم خرید (صادرشده) مربوط می‌شوند — دسترسی مشاهده با هرکدام از این دو ماژول کافی است. */
  private async assertViewEither(ctx: TenantRequestContext): Promise<void> {
    const [sales, purchasing] = await Promise.all([
      this.permissions.getEffective(ctx, 'sales'),
      this.permissions.getEffective(ctx, 'purchasing'),
    ]);
    if (!sales.canViewAll && !sales.canViewOwn && !purchasing.canViewAll && !purchasing.canViewOwn) {
      throw new ForbiddenException('اجازه‌ی مشاهده‌ی چک‌ها را ندارید');
    }
  }

  @Get()
  async list(
    @Query('direction') direction: 'RECEIVED' | 'ISSUED' | undefined,
    @Query('status') status: string | undefined,
    @Query('dueSoonDays') dueSoonDays: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.assertViewEither(ctx);
    return this.checks.list(ctx, {
      direction,
      status,
      dueSoonDays: dueSoonDays ? Number(dueSoonDays) : undefined,
    });
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

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.assertViewEither(ctx);
    return this.checks.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateCheckDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, dto.direction === 'RECEIVED' ? 'sales' : 'purchasing');
    return this.checks.create(ctx, dto);
  }

  @Post(':id/deposit')
  async markDeposited(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.checks.markDeposited(ctx, id);
  }

  @Post(':id/clear')
  async markCleared(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.checks.markCleared(ctx, id);
  }

  @Post(':id/bounce')
  async markBounced(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.checks.markBounced(ctx, id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.checks.cancel(ctx, id);
  }

  @Post(':id/endorse')
  async endorse(@Param('id') id: string, @Body() dto: EndorseCheckDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.checks.endorse(ctx, id, dto.toContactId);
  }

  @Put(':id/reminder-days')
  async updateReminderDays(
    @Param('id') id: string,
    @Body() dto: UpdateCheckReminderDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.checks.updateReminderDays(ctx, id, dto.reminderDaysBefore);
  }
}
