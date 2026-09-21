import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { ModulePricingSyncService } from '../public/module-pricing-sync.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { UpsertModuleDto } from './dto/upsert-module.dto.js';
import { UpsertPlanDto } from './dto/upsert-plan.dto.js';
import { UpsertIndustryTemplateDto } from './dto/upsert-industry-template.dto.js';
import { SaveIndustryTemplateFromTenantDto } from './dto/save-industry-template-from-tenant.dto.js';

/**
 * Pricing and feature-list editing for what tenants see in the module store
 * and billing screens — previously only settable by hand-editing the seed
 * script. Read (GET) is open to any admin team; only SUPER_ADMIN/BILLING
 * can change prices or add/remove modules and plans.
 */
@Controller('admin/catalog')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
export class AdminCatalogController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly pricing: ModulePricingSyncService,
  ) {}

  @Get('modules')
  @AdminTeams('SUPER_ADMIN', 'BILLING', 'SUPPORT', 'ENGINEERING')
  listModules() {
    return this.controlDb.moduleDefinition.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** همگام‌سازی دستی قیمت‌ها از روی قیمت دلاری و نرخ روز. */
  @Post('modules/sync-prices')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  syncPrices() {
    return this.pricing.syncAll();
  }

  @Post('modules')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  async upsertModule(@Body() dto: UpsertModuleDto) {
    const saved = await this.controlDb.moduleDefinition.upsert({
      where: { code: dto.code },
      create: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        priceMonthly: dto.priceMonthly ?? 0,
        priceYearly: dto.priceYearly,
        licenseUsd: dto.licenseUsd ?? 0,
        isCore: dto.isCore ?? false,
        features: dto.features ?? [],
        version: dto.version ?? '1.0.0',
        dependsOn: dto.dependsOn ?? [],
        demoDescription: dto.demoDescription,
        demoValueProps: dto.demoValueProps ?? [],
        demoScreenshot1Url: dto.demoScreenshot1Url,
        demoScreenshot2Url: dto.demoScreenshot2Url,
      },
      update: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
        ...(dto.priceMonthly !== undefined ? { priceMonthly: dto.priceMonthly } : {}),
        priceYearly: dto.priceYearly,
        ...(dto.licenseUsd !== undefined ? { licenseUsd: dto.licenseUsd } : {}),
        isCore: dto.isCore ?? false,
        features: dto.features ?? [],
        version: dto.version ?? '1.0.0',
        dependsOn: dto.dependsOn ?? [],
        demoDescription: dto.demoDescription,
        demoValueProps: dto.demoValueProps ?? [],
        demoScreenshot1Url: dto.demoScreenshot1Url,
        demoScreenshot2Url: dto.demoScreenshot2Url,
      },
    });
    // قیمت تومانی از روی قیمت دلاری و نرخ روز همگام می‌شود (اگر licenseUsd تعریف شده باشد)
    if (saved.licenseUsd > 0) await this.pricing.syncAll();
    return this.controlDb.moduleDefinition.findUniqueOrThrow({ where: { code: saved.code } });
  }

  /** Slim shape for the tenant-creation picker. Full detail is GET :code. */
  @Get('industry-templates')
  @AdminTeams('SUPER_ADMIN', 'BILLING', 'SUPPORT', 'ENGINEERING')
  listIndustryTemplates() {
    return this.controlDb.industryTemplate.findMany({
      select: { id: true, code: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('industry-templates/:code')
  @AdminTeams('SUPER_ADMIN', 'BILLING', 'SUPPORT', 'ENGINEERING')
  async getIndustryTemplate(@Param('code') code: string) {
    const template = await this.controlDb.industryTemplate.findUnique({ where: { code } });
    if (!template) throw new NotFoundException('قالب صنف یافت نشد');
    return template;
  }

  @Post('industry-templates')
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING')
  upsertIndustryTemplate(@Body() dto: UpsertIndustryTemplateDto) {
    return this.controlDb.industryTemplate.upsert({
      where: { code: dto.code },
      create: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        roles: dto.roles as object[],
        chartOfAccounts: dto.chartOfAccounts as object[],
        productCategories: dto.productCategories,
        orgChart: dto.orgChart as object[],
        suggestedThemeColor: dto.suggestedThemeColor,
        defaultModules: dto.defaultModules ?? [],
      },
      update: {
        name: dto.name,
        description: dto.description,
        roles: dto.roles as object[],
        chartOfAccounts: dto.chartOfAccounts as object[],
        productCategories: dto.productCategories,
        orgChart: dto.orgChart as object[],
        suggestedThemeColor: dto.suggestedThemeColor,
        defaultModules: dto.defaultModules ?? [],
      },
    });
  }

  /**
   * Bootstraps a new industry template from an already-configured tenant,
   * instead of hand-writing roles/chart-of-accounts JSON from scratch: the
   * tenant's own custom (non-system) roles, non-system chart-of-accounts
   * rows, distinct product categories, theme color, and currently active
   * modules become the template's defaults. orgChart has no live equivalent
   * in the tenant DB (it's descriptive-only), so it starts empty — edit it
   * by hand afterwards via the update endpoint above.
   */
  @Post('industry-templates/from-tenant/:tenantId')
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING')
  async saveIndustryTemplateFromTenant(
    @Param('tenantId') tenantId: string,
    @Body() dto: SaveIndustryTemplateFromTenantDto,
  ) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('تننت یافت نشد');

    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });

    const [roles, accounts, products, activeModules] = await Promise.all([
      tenantDb.role.findMany({
        where: { isSystem: false },
        include: { permissions: { include: { permission: true } }, modulePermissions: true },
      }),
      tenantDb.account.findMany({
        where: { isSystem: false },
        select: { code: true, name: true, type: true, isCashAccount: true },
        orderBy: { code: 'asc' },
      }),
      tenantDb.product.findMany({ select: { category: true }, distinct: ['category'] }),
      this.controlDb.tenantModule.findMany({
        where: { tenantId, status: { in: ['INSTALLED', 'TRIAL'] } },
        include: { module: true },
      }),
    ]);

    const rolesJson = roles.map((r) => ({
      name: r.name,
      permissionCodes: r.permissions.map((rp) => rp.permission.code),
      modulePermissions: Object.fromEntries(
        r.modulePermissions.map((mp) => [
          mp.moduleCode,
          { canViewAll: mp.canViewAll, canViewOwn: mp.canViewOwn, canCreate: mp.canCreate, canEdit: mp.canEdit, canDelete: mp.canDelete },
        ]),
      ),
    }));

    return this.controlDb.industryTemplate.upsert({
      where: { code: dto.code },
      create: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        roles: rolesJson,
        chartOfAccounts: accounts,
        productCategories: products.map((p) => p.category).filter((c): c is string => !!c),
        orgChart: [],
        suggestedThemeColor: tenant.themeColor ?? undefined,
        defaultModules: activeModules.map((m) => m.module.code),
      },
      update: {
        name: dto.name,
        description: dto.description,
        roles: rolesJson,
        chartOfAccounts: accounts,
        productCategories: products.map((p) => p.category).filter((c): c is string => !!c),
        suggestedThemeColor: tenant.themeColor ?? undefined,
        defaultModules: activeModules.map((m) => m.module.code),
      },
    });
  }

  @Get('plans')
  @AdminTeams('SUPER_ADMIN', 'BILLING', 'SUPPORT', 'ENGINEERING')
  listPlans() {
    return this.controlDb.plan.findMany({ orderBy: { priceMonthly: 'asc' } });
  }

  @Post('plans')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  async upsertPlan(@Body() dto: UpsertPlanDto) {
    return this.controlDb.plan.upsert({
      where: { code: dto.code },
      create: {
        code: dto.code,
        name: dto.name,
        priceMonthly: dto.priceMonthly,
        priceYearly: dto.priceYearly,
        userLimit: dto.userLimit,
        isPubliclySold: dto.isPubliclySold ?? true,
      },
      update: {
        name: dto.name,
        priceMonthly: dto.priceMonthly,
        priceYearly: dto.priceYearly,
        userLimit: dto.userLimit,
        isPubliclySold: dto.isPubliclySold ?? true,
      },
    });
  }
}
