import { BadRequestException, Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { UpdateRequestSmsSettingsDto } from './dto/request-sms-settings.dto.js';
import { HrRequestSmsService } from './request-sms.service.js';
import {
  HR_REQUEST_TYPES,
  HR_REQUEST_TYPE_LABELS,
  HR_SMS_DEFAULT_TEMPLATES,
  HR_SMS_EVENTS,
  HR_SMS_EVENT_LABELS,
  HR_SMS_PLACEHOLDERS,
  HR_SMS_PLACEHOLDER_LABELS,
  type HrRequestSmsSettings,
} from './request-sms.js';

/** تنظیمات پیامک تصمیم درخواست‌های منابع انسانی + گزارش پیامک‌های ارسال‌شده‌ی هر درخواست. */
@Controller('hr/request-sms')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class RequestSmsController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly sms: HrRequestSmsService,
  ) {}

  @Get('settings')
  async getSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'hr');
    return {
      settings: await this.sms.getSettings(ctx.tenantDb),
      placeholders: HR_SMS_PLACEHOLDERS.map((key) => ({ key, label: HR_SMS_PLACEHOLDER_LABELS[key] })),
      events: HR_SMS_EVENTS.map((key) => ({ key, label: HR_SMS_EVENT_LABELS[key] })),
      types: HR_REQUEST_TYPES.map((key) => ({ key, label: HR_REQUEST_TYPE_LABELS[key] })),
      defaultTemplates: HR_SMS_DEFAULT_TEMPLATES,
    };
  }

  @Put('settings')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async setSettings(@Body() dto: UpdateRequestSmsSettingsDto, @Ctx() ctx: TenantRequestContext) {
    const { settings, error } = await this.sms.setSettings(ctx.tenantDb, dto as Partial<HrRequestSmsSettings>);
    if (error) throw new BadRequestException(error);
    return { settings };
  }

  /** پیامک‌های ارسال‌شده برای یک درخواست — فقط با «مشاهده‌ی همه» (مدیر منابع انسانی). متن پیامک ذخیره نمی‌شود. */
  @Get('log/:type/:id')
  async log(@Param('type') type: string, @Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'hr');
    return this.sms.listLog(ctx.tenantDb, type, id);
  }
}
