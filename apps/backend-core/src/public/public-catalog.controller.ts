import { Controller, Get } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

/**
 * Marketing-safe reads for the signup wizard and login-page showcase — only
 * the fields a prospective customer should see. IndustryTemplate's
 * roles/chartOfAccounts/orgChart/productCategories are deliberately never
 * exposed here (that's the actual authored content, not a sales pitch).
 */
@Controller('public/catalog')
export class PublicCatalogController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get('industry-templates')
  async industryTemplates() {
    const templates = await this.controlDb.industryTemplate.findMany({
      orderBy: { name: 'asc' },
      select: { code: true, name: true, description: true, suggestedThemeColor: true, defaultModules: true },
    });
    return templates;
  }

  @Get('plans')
  async plans() {
    return this.controlDb.plan.findMany({
      where: { isPubliclySold: true },
      orderBy: { priceMonthly: 'asc' },
      select: { code: true, name: true, priceMonthly: true, priceYearly: true, userLimit: true },
    });
  }

  @Get('modules')
  async modules() {
    return this.controlDb.moduleDefinition.findMany({
      orderBy: { priceMonthly: 'asc' },
      select: {
        code: true,
        name: true,
        description: true,
        category: true,
        priceMonthly: true,
        isCore: true,
        features: true,
        dependsOn: true,
      },
    });
  }
}
