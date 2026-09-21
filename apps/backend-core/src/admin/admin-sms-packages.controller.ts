import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { CreateSmsPackageDto } from './dto/create-sms-package.dto.js';
import { AdjustSmsWalletDto } from './dto/adjust-sms-wallet.dto.js';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { UpdateSmsPackageDto } from './dto/update-sms-package.dto.js';

/** قیمت‌گذاری بسته‌های پیامکی پنل سیستمی (۵۰۰ / ۱۰۰۰ / ۵۰۰۰) — فقط مدیران پلتفرم. */
@Controller('admin/sms-packages')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
export class AdminSmsPackagesController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get()
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  list() {
    return this.controlDb.smsPackage.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Put(':code')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  update(@Param('code') code: string, @Body() dto: UpdateSmsPackageDto) {
    return this.controlDb.smsPackage.update({
      where: { code },
      data: { priceToman: dto.priceToman, isActive: dto.isActive, credits: dto.credits },
    });
  }

  @Post()
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  async create(@Body() dto: CreateSmsPackageDto) {
    const last = await this.controlDb.smsPackage.findFirst({ orderBy: { sortOrder: 'desc' } });
    return this.controlDb.smsPackage.create({
      data: { code: `SMS_${dto.credits}_${Date.now().toString(36)}`, credits: dto.credits, priceToman: dto.priceToman, sortOrder: (last?.sortOrder ?? 0) + 1 },
    });
  }

  @Delete(':code')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  async remove(@Param('code') code: string) {
    await this.controlDb.smsPackage.delete({ where: { code } });
    return { success: true };
  }

  /** موجودی پیامک پنل سیستمی یک تننت (بسته‌های خریداری‌شده) */
  @Get('tenants/:tenantId/wallet')
  @AdminTeams('SUPER_ADMIN', 'BILLING', 'SUPPORT')
  async wallet(@Param('tenantId') tenantId: string) {
    const w = await this.controlDb.tenantSmsWallet.findUnique({ where: { tenantId } });
    return { tenantId, credits: w?.credits ?? 0 };
  }

  /** تنظیم/اصلاح دستی موجودی پیامک تننت (شارژ هدیه، اصلاح خطا) — با ثبت در لاگ ممیزی */
  @Put('tenants/:tenantId/wallet')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  async adjustWallet(@Param('tenantId') tenantId: string, @Body() dto: AdjustSmsWalletDto, @AdminCtx() ctx: AdminRequestContext) {
    if (dto.credits === undefined && dto.delta === undefined) throw new BadRequestException('مقدار دقیق یا افزایش/کاهش را وارد کنید');
    const current = (await this.controlDb.tenantSmsWallet.findUnique({ where: { tenantId } }))?.credits ?? 0;
    const next = Math.max(0, dto.credits ?? current + (dto.delta ?? 0));
    const wallet = await this.controlDb.tenantSmsWallet.upsert({ where: { tenantId }, create: { tenantId, credits: next }, update: { credits: next } });
    await this.controlDb.auditLog.create({
      data: { actorType: 'admin_user', actorId: ctx.auth.sub, tenantId, action: 'sms_wallet.adjusted', entityType: 'TenantSmsWallet', entityId: tenantId, metadata: { before: current, after: next, note: dto.note ?? null } as never },
    });
    return { tenantId, credits: wallet.credits };
  }
}
