import { BadRequestException, Body, Controller, Get, NotFoundException, Put, Post, Query, UseGuards } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { assertInScope } from '../permissions/scope.util.js';
import { VoipProviderRegistryService } from './voip-provider-registry.service.js';
import { CallLogService } from './call-log.service.js';
import { phonesMatch } from './phone-match.js';
import { SaveProviderConfigDto } from './dto/save-provider-config.dto.js';
import { SaveExtensionDto } from './dto/save-extension.dto.js';
import { OriginateCallDto } from './dto/originate-call.dto.js';

@Controller('voip')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('voip')
export class VoipController {
  constructor(
    private readonly registry: VoipProviderRegistryService,
    private readonly callLog: CallLogService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('providers')
  listProviders() {
    return this.registry.getAll().map((p) => ({
      code: p.code,
      name: p.name,
      configFields: p.configFields,
      supportsOriginate: Boolean(p.originateCall),
    }));
  }

  /** وضعیت کلیِ تلفن برای هر کاربرِ ماژول (بدون جزئیات اتصال): آیا ارائه‌دهنده‌ی فعال تنظیم شده؟ دکمه‌ی تلفن هدر با همین پنهان می‌شود. */
  @Get('status')
  async status(@Ctx() ctx: TenantRequestContext) {
    const config = await ctx.tenantDb.voipProviderConfig.findFirst({ where: { isActive: true }, select: { id: true } });
    return { configured: !!config };
  }

  @Get('config')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async getConfig(@Ctx() ctx: TenantRequestContext) {
    const config = await ctx.tenantDb.voipProviderConfig.findFirst({ where: { isActive: true } });
    if (!config) return null;
    return { providerCode: config.providerCode, config: config.config, webhookSecret: config.webhookSecret };
  }

  @Put('config')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async saveConfig(@Body() dto: SaveProviderConfigDto, @Ctx() ctx: TenantRequestContext) {
    if (!this.registry.get(dto.providerCode)) throw new BadRequestException('سرویس VoIP انتخاب‌شده یافت نشد');

    const existing = await ctx.tenantDb.voipProviderConfig.findFirst({ where: { isActive: true } });
    if (existing) {
      return ctx.tenantDb.voipProviderConfig.update({
        where: { id: existing.id },
        data: { providerCode: dto.providerCode, config: dto.config as never },
      });
    }
    return ctx.tenantDb.voipProviderConfig.create({
      data: { providerCode: dto.providerCode, config: dto.config as never, webhookSecret: randomBytes(24).toString('hex') },
    });
  }

  /** Never includes sipUsername/sipPassword — this list is visible to every VoIP-module user, not just admins, and a SIP password is a real credential. */
  @Get('extensions')
  async listExtensions(@Ctx() ctx: TenantRequestContext) {
    return ctx.tenantDb.voipExtension.findMany({
      select: { id: true, extension: true, user: { select: { id: true, name: true } } },
    });
  }

  /** Only the caller's own SIP credentials — for showing on-screen so they can punch them into their IP phone. */
  @Get('extensions/me')
  async getMyExtension(@Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) throw new BadRequestException('کاربر تننت‌محور یافت نشد');
    return ctx.tenantDb.voipExtension.findUnique({ where: { userId } });
  }

  @Put('extensions/me')
  async saveMyExtension(@Body() dto: SaveExtensionDto, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) throw new BadRequestException('کاربر تننت‌محور یافت نشد');
    return ctx.tenantDb.voipExtension.upsert({
      where: { userId },
      create: { userId, extension: dto.extension, sipUsername: dto.sipUsername, sipPassword: dto.sipPassword },
      update: { extension: dto.extension, sipUsername: dto.sipUsername, sipPassword: dto.sipPassword },
    });
  }

  /**
   * Click-to-call: the logged-in user must have their own extension set
   * (that's what the PBX rings/bridges to) — the adapter itself decides
   * whether it can even originate a call at all.
   */
  @Post('originate')
  async originate(@Body() dto: OriginateCallDto, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    const myExtension = userId ? await ctx.tenantDb.voipExtension.findUnique({ where: { userId } }) : null;
    // sipUsername همان داخلی واقعی متصل‌شده در تنظیمات اتصال تلفن IP است —
    // extension قدیمی فقط برای مچ‌کردن وب‌هوک تماس ورودی نگه داشته شده و
    // در رابط کاربری فعلی هرگز ست نمی‌شود، پس نباید اینجا شرط باشد.
    const fromExtension = myExtension?.sipUsername || myExtension?.extension;
    if (!fromExtension) throw new BadRequestException('ابتدا تلفن IP خودتان را در تنظیمات وصل کنید');

    const providerConfig = await ctx.tenantDb.voipProviderConfig.findFirst({ where: { isActive: true } });
    if (!providerConfig) throw new NotFoundException('سرویس VoIP برای این محیط کاری تنظیم نشده است');
    const adapter = this.registry.get(providerConfig.providerCode);
    if (!adapter?.originateCall) throw new BadRequestException('این سرویس VoIP از تماس مستقیم پشتیبانی نمی‌کند');

    const result = await adapter.originateCall(providerConfig.config as Record<string, unknown>, fromExtension, dto.toNumber);
    if (!result.success) throw new BadRequestException(result.error);

    const contact = await this.findContactByIdOrPhone(ctx, dto.contactId, dto.toNumber);
    await this.callLog.recordOutbound(ctx.tenantDb, {
      fromExtension,
      toNumber: dto.toNumber,
      providerCallId: result.callId,
      userId: userId!,
      contactId: contact?.id ?? null,
      contactName: contact?.name ?? null,
    });

    return { success: true };
  }

  private async findContactByIdOrPhone(ctx: TenantRequestContext, contactId: string | undefined, phone: string) {
    if (contactId) {
      return ctx.tenantDb.crmContact.findUnique({ where: { id: contactId }, select: { id: true, name: true } });
    }
    const contacts = await ctx.tenantDb.crmContact.findMany({
      where: { phone: { not: null } },
      select: { id: true, name: true, phone: true },
    });
    return contacts.find((c) => c.phone && phonesMatch(c.phone, phone)) ?? null;
  }

  /** تاریخچه‌ی تماس — برای صفحه‌ی «تاریخچه تماس‌ها» (همه‌ی تننت) یا برای تب تماس‌های یک مخاطب خاص در پروفایلش. */
  @Get('calls')
  async listCalls(
    @Query('contactId') contactId: string | undefined,
    @Query('mine') mine: string | undefined,
    @Query('limit') limit: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    // مالک/مدیر: تاریخچه‌ی همه‌ی تماس‌ها. سایر کاربران: فقط تماس‌های خودشان؛ یا تماس‌های یک مخاطب که طبق
    // ماتریس دسترسی CRM اجازه‌ی دیدنش را دارند (تب تماس‌ها در پروفایل مخاطب).
    const manager = ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
    let where: { contactId?: string; userId?: string };
    if (manager) {
      where = { contactId, userId: mine === 'true' ? ((await resolveTenantUserId(ctx)) ?? undefined) : undefined };
    } else if (contactId) {
      const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
      await assertInScope(ctx.tenantDb.crmContact, scope, { id: contactId }, { message: 'مخاطب یافت نشد' });
      where = { contactId };
    } else {
      where = { userId: (await resolveTenantUserId(ctx)) ?? '__none__' };
    }
    return ctx.tenantDb.callLog.findMany({
      where,
      include: { contact: { select: { id: true, name: true, company: true } }, user: { select: { id: true, name: true } } },
      orderBy: { startedAt: 'desc' },
      take: limit ? Math.min(Number(limit), 200) : 100,
    });
  }
}
