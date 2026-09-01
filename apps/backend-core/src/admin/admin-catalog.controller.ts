import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { UpsertModuleDto } from './dto/upsert-module.dto.js';
import { UpsertPlanDto } from './dto/upsert-plan.dto.js';

/**
 * Pricing and feature-list editing for what tenants see in the module store
 * and billing screens — previously only settable by hand-editing the seed
 * script. Read (GET) is open to any admin team; only SUPER_ADMIN/BILLING
 * can change prices or add/remove modules and plans.
 */
@Controller('admin/catalog')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
export class AdminCatalogController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get('modules')
  @AdminTeams('SUPER_ADMIN', 'BILLING', 'SUPPORT', 'ENGINEERING')
  listModules() {
    return this.controlDb.moduleDefinition.findMany({ orderBy: { createdAt: 'asc' } });
  }

  @Post('modules')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  async upsertModule(@Body() dto: UpsertModuleDto) {
    return this.controlDb.moduleDefinition.upsert({
      where: { code: dto.code },
      create: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        priceMonthly: dto.priceMonthly,
        isCore: dto.isCore ?? false,
        features: dto.features ?? [],
        version: dto.version ?? '1.0.0',
        dependsOn: dto.dependsOn ?? [],
      },
      update: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
        priceMonthly: dto.priceMonthly,
        isCore: dto.isCore ?? false,
        features: dto.features ?? [],
        version: dto.version ?? '1.0.0',
        dependsOn: dto.dependsOn ?? [],
      },
    });
  }

  /**
   * Read-only for now — authoring/editing industry templates from the admin
   * panel is out of scope (they're seeded via prisma/control/seed.ts).
   * Exists so tenant creation can offer a template picker.
   */
  @Get('industry-templates')
  @AdminTeams('SUPER_ADMIN', 'BILLING', 'SUPPORT', 'ENGINEERING')
  listIndustryTemplates() {
    return this.controlDb.industryTemplate.findMany({
      select: { id: true, code: true, name: true, description: true },
      orderBy: { name: 'asc' },
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
        userLimit: dto.userLimit,
        isPubliclySold: dto.isPubliclySold ?? true,
      },
      update: {
        name: dto.name,
        priceMonthly: dto.priceMonthly,
        userLimit: dto.userLimit,
        isPubliclySold: dto.isPubliclySold ?? true,
      },
    });
  }
}
