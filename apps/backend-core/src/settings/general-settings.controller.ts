import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { UpdateGeneralSettingsDto } from './dto/update-general-settings.dto.js';
import { UpdateCompanyStampDto } from './dto/update-company-stamp.dto.js';
import { CompanyStampService } from './company-stamp.service.js';

const MODULE_CODE = 'general';

/**
 * Org-wide settings shown at Settings → General. Org name lives on the
 * canonical Tenant row (Control Plane); logo/timezone have no dedicated
 * column so they ride on the generic per-tenant ModuleSetting store every
 * module already uses for its own config (moduleCode "general" here).
 */
@Controller('settings/general')
@UseGuards(JwtAuthGuard)
export class GeneralSettingsController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly stamp: CompanyStampService,
  ) {}

  @Get()
  async get(@Ctx() ctx: TenantRequestContext) {
    const [tenant, settings] = await Promise.all([
      this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
      ctx.tenantDb.moduleSetting.findMany({ where: { moduleCode: MODULE_CODE } }),
    ]);
    const byKey = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    // مهر و امضای رسمی فقط برای مالک یا کاربری که مالک ارجاع داده نمایش داده می‌شود — نه هر کاربر دیگری که این تنظیمات را می‌بیند.
    let signatureImage: string | null = null;
    let stampImage: string | null = null;
    let canManageStamp = false;
    try {
      await this.stamp.assertCanUse(ctx);
      canManageStamp = ctx.auth.role === 'OWNER';
      const stampValue = await this.stamp.getStamp(ctx);
      signatureImage = stampValue.signatureImage ?? null;
      stampImage = stampValue.stampImage ?? null;
    } catch {
      // بدون دسترسی — فیلدهای مهر/امضا خالی می‌مانند
    }

    return {
      orgName: tenant.name,
      logoUrl: (byKey.logoUrl as string | undefined) ?? null,
      timezone: (byKey.timezone as string | undefined) ?? 'Asia/Tehran',
      address: (byKey.address as string | undefined) ?? null,
      economicCode: (byKey.economicCode as string | undefined) ?? null,
      nationalId: (byKey.nationalId as string | undefined) ?? null,
      registrationNumber: (byKey.registrationNumber as string | undefined) ?? null,
      phone: (byKey.phone as string | undefined) ?? null,
      signatureImage,
      stampImage,
      canManageStamp,
    };
  }

  @Put('stamp')
  @UseGuards(RolesGuard)
  @Roles('OWNER')
  async updateStamp(@Body() dto: UpdateCompanyStampDto, @Ctx() ctx: TenantRequestContext) {
    return this.stamp.setStamp(ctx, dto);
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async update(@Body() dto: UpdateGeneralSettingsDto, @Ctx() ctx: TenantRequestContext) {
    if (dto.orgName) {
      await this.controlDb.tenant.update({ where: { id: ctx.tenantId }, data: { name: dto.orgName } });
    }
    const fields = {
      logoUrl: dto.logoUrl,
      timezone: dto.timezone,
      address: dto.address,
      economicCode: dto.economicCode,
      nationalId: dto.nationalId,
      registrationNumber: dto.registrationNumber,
      phone: dto.phone,
    };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      await ctx.tenantDb.moduleSetting.upsert({
        where: { moduleCode_key: { moduleCode: MODULE_CODE, key } },
        create: { moduleCode: MODULE_CODE, key, value },
        update: { value },
      });
    }
    return this.get(ctx);
  }
}
