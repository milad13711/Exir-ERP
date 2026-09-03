import { BadRequestException, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { ModuleDefinition, TenantModule } from '../../generated/control-client/index.js';

/**
 * The in-app module store: every tenant sees the full catalog with their own
 * install status layered on top. OWNER/ADMIN members can install/uninstall
 * a module themselves (self-service) — prerequisites (dependsOn) are
 * enforced on install, and a module can't be uninstalled while another
 * active module still depends on it.
 */
@Controller('modules')
@UseGuards(JwtAuthGuard)
export class ModulesCatalogController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    const [catalog, installed] = await Promise.all([
      this.controlDb.moduleDefinition.findMany({ orderBy: { createdAt: 'asc' } }),
      this.controlDb.tenantModule.findMany({ where: { tenantId: ctx.tenantId } }),
    ]);
    const installedByModuleId = new Map(installed.map((m) => [m.moduleId, m]));
    return catalog.map((m) => ({
      ...m,
      installStatus: installedByModuleId.get(m.id)?.status ?? null,
    }));
  }

  @Post(':code/install')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async install(@Param('code') code: string, @Ctx() ctx: TenantRequestContext) {
    const [catalog, installed] = await Promise.all([
      this.controlDb.moduleDefinition.findMany(),
      this.controlDb.tenantModule.findMany({ where: { tenantId: ctx.tenantId } }),
    ]);
    const byCode = new Map(catalog.map((m) => [m.code, m]));
    const module = byCode.get(code);
    if (!module) throw new NotFoundException('ماژول یافت نشد');

    const installedByModuleId = new Map(installed.map((m) => [m.moduleId, m]));
    const isActive = (m: ModuleDefinition) => {
      const install = installedByModuleId.get(m.id);
      return install ? install.status === 'INSTALLED' || install.status === 'TRIAL' : m.isCore;
    };

    const missingDeps = module.dependsOn
      .map((depCode) => byCode.get(depCode))
      .filter((dep): dep is ModuleDefinition => !!dep && !isActive(dep));
    if (missingDeps.length > 0) {
      throw new BadRequestException(
        `ابتدا این ماژول‌ها را فعال کنید: ${missingDeps.map((d) => d.name).join('، ')}`,
      );
    }

    // A row already existing here means the tenant has installed this
    // module before (even if they later switched it off) — re-activating
    // is just flipping status back on, not a new purchase, so it must NOT
    // invoice again. Only a genuinely first-time install charges.
    const hadModuleBefore = installedByModuleId.has(module.id);

    const tenantModule = await this.controlDb.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: ctx.tenantId, moduleId: module.id } },
      create: { tenantId: ctx.tenantId, moduleId: module.id, status: 'INSTALLED' },
      update: { status: 'INSTALLED' },
    });

    if (module.priceMonthly > 0 && !hadModuleBefore) {
      await this.controlDb.invoice.create({
        data: {
          tenantId: ctx.tenantId,
          amount: module.priceMonthly,
          status: 'PENDING',
          dueAt: new Date(),
        },
      });
    }

    await this.controlDb.auditLog.create({
      data: {
        actorType: 'global_user',
        actorId: ctx.auth.sub,
        tenantId: ctx.tenantId,
        action: 'module.installed',
        entityType: 'ModuleDefinition',
        entityId: module.id,
        metadata: { code: module.code },
      },
    });

    return { ...module, installStatus: tenantModule.status };
  }

  @Post(':code/uninstall')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async uninstall(@Param('code') code: string, @Ctx() ctx: TenantRequestContext) {
    const [catalog, installed] = await Promise.all([
      this.controlDb.moduleDefinition.findMany(),
      this.controlDb.tenantModule.findMany({ where: { tenantId: ctx.tenantId } }),
    ]);
    const byCode = new Map(catalog.map((m) => [m.code, m]));
    const module = byCode.get(code);
    if (!module) throw new NotFoundException('ماژول یافت نشد');

    const installedByModuleId = new Map<string, TenantModule>(installed.map((m) => [m.moduleId, m]));
    const isActive = (m: ModuleDefinition) => {
      const install = installedByModuleId.get(m.id);
      return install ? install.status === 'INSTALLED' || install.status === 'TRIAL' : m.isCore;
    };

    const blockedBy = catalog.filter(
      (m) => m.code !== module.code && m.dependsOn.includes(module.code) && isActive(m),
    );
    if (blockedBy.length > 0) {
      throw new BadRequestException(
        `این ماژول پیش‌نیاز ماژول‌های فعال دیگری است، ابتدا آن‌ها را غیرفعال کنید: ${blockedBy.map((d) => d.name).join('، ')}`,
      );
    }

    const tenantModule = await this.controlDb.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: ctx.tenantId, moduleId: module.id } },
      create: { tenantId: ctx.tenantId, moduleId: module.id, status: 'DISABLED' },
      update: { status: 'DISABLED' },
    });

    await this.controlDb.auditLog.create({
      data: {
        actorType: 'global_user',
        actorId: ctx.auth.sub,
        tenantId: ctx.tenantId,
        action: 'module.uninstalled',
        entityType: 'ModuleDefinition',
        entityId: module.id,
        metadata: { code: module.code },
      },
    });

    return { ...module, installStatus: tenantModule.status };
  }
}
