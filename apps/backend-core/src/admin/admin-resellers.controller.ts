import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ResellersService } from '../referral-marketing/resellers.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

const TEAMS = ['SUPER_ADMIN', 'SUPPORT', 'BILLING'] as const;

/**
 * مدیریت نمایندگان ثبت‌شده در تننت رجیستری پلتفرم از پنل ادمین: توقف نمایش روی نقشه،
 * پایان همکاری و صورتحساب مانده‌ی تسویه — همان منطق ماژول رفرال، بدون ورود به تننت.
 */
@Controller('admin/resellers')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
export class AdminResellersController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly resellers: ResellersService,
  ) {}

  private async registryCtx(): Promise<TenantRequestContext> {
    const slug = process.env.RESELLER_REGISTRY_TENANT_SLUG ?? 'eta';
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new NotFoundException('تننت رجیستری پلتفرم پیدا نشد');
    const tenantDb = this.tenantPrisma.forTenant(tenant);
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  @Get()
  @AdminTeams(...TEAMS)
  async list() {
    const ctx = await this.registryCtx();
    const profiles = await ctx.tenantDb.resellerProfile.findMany({
      include: { contact: { select: { name: true, company: true, phone: true } }, user: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      profiles.map(async (p) => {
        const b = await this.resellers.balance(ctx, p.id);
        return {
          id: p.id,
          name: p.contact.company || p.contact.name,
          phone: p.contact.phone,
          city: p.city,
          productCode: p.productCode,
          isVerified: p.isVerified,
          hiddenFromMap: p.hiddenFromMap,
          cooperationStatus: p.cooperationStatus,
          endReason: p.endReason,
          hasAccess: !!p.user,
          totalCommission: b.totalCommission,
          amountDue: b.amountDue,
        };
      }),
    );
  }

  @Post(':id/map-visibility')
  @AdminTeams(...TEAMS)
  async mapVisibility(@Param('id') id: string, @Body() dto: { hidden: boolean }) {
    await this.resellers.setMapVisibility(await this.registryCtx(), id, !!dto.hidden);
    return { success: true };
  }

  @Post(':id/end')
  @AdminTeams(...TEAMS)
  end(@Param('id') id: string, @Body() dto: { reason?: string }) {
    return this.registryCtx().then((ctx) => this.resellers.endCooperation(ctx, id, (dto?.reason ?? 'پایان همکاری توسط مدیریت').trim()));
  }

  @Get(':id/settlements')
  @AdminTeams(...TEAMS)
  settlements(@Param('id') id: string) {
    return this.registryCtx().then((ctx) => this.resellers.listSettlements(ctx, id));
  }

  @Post(':id/settlements')
  @AdminTeams(...TEAMS)
  createSettlement(@Param('id') id: string, @Body() dto: { note?: string }) {
    return this.registryCtx().then((ctx) => this.resellers.generateSettlement(ctx, id, dto?.note));
  }

  @Post('settlements/:settlementId/settle')
  @AdminTeams(...TEAMS)
  settle(@Param('settlementId') settlementId: string) {
    return this.registryCtx().then((ctx) => this.resellers.settle(ctx, settlementId));
  }
}
