import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

/** Bootstrap endpoint the frontend calls once after login to fill the header/shell. */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(private readonly controlDb: ControlPrismaService) {}

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
      tenant: { name: tenant.name, slug: tenant.slug },
    };
  }
}
