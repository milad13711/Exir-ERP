import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { UpdateBrandingDto } from './dto/update-branding.dto.js';
import { SwitchTenantDto } from './dto/switch-tenant.dto.js';

/** Bootstrap endpoint the frontend calls once after login to fill the header/shell. */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async me(@Ctx() ctx: TenantRequestContext) {
    const [globalUser, tenant, tenantUser] = await Promise.all([
      this.controlDb.globalUser.findUniqueOrThrow({ where: { id: ctx.auth.sub } }),
      this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
      ctx.tenantDb.user.findUnique({
        where: { globalUserId: ctx.auth.sub },
        include: { roles: { include: { role: true } } },
      }),
    ]);

    return {
      user: {
        name: globalUser.name,
        phone: globalUser.phone,
        roleTitle: tenantUser?.roles[0]?.role.name ?? null,
        membershipRole: ctx.auth.role,
      },
      tenant: { name: tenant.name, slug: tenant.slug, themeColor: tenant.themeColor },
    };
  }

  /** فهرست محیط‌های کاری دیگری که همین کاربر عضو فعال آن‌هاست — برای سوییچر داخل هدر. */
  @Get('tenants')
  async myTenants(@Ctx() ctx: TenantRequestContext) {
    return this.auth.listMyTenants(ctx.auth.sub);
  }

  @Post('switch-tenant')
  async switchTenant(@Body() dto: SwitchTenantDto, @Ctx() ctx: TenantRequestContext) {
    return this.auth.switchTenant(ctx.auth.sub, dto.tenantSlug);
  }

  @Patch('branding')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async updateBranding(@Body() dto: UpdateBrandingDto, @Ctx() ctx: TenantRequestContext) {
    const tenant = await this.controlDb.tenant.update({
      where: { id: ctx.tenantId },
      data: { themeColor: dto.themeColor },
    });
    return { themeColor: tenant.themeColor };
  }
}
