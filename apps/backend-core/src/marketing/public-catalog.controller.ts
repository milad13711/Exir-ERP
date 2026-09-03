import { BadRequestException, Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { QuotePlanDto } from './dto/quote-plan.dto.js';
import { CreatePublicLeadDto } from './dto/create-public-lead.dto.js';

/**
 * Unauthenticated, public-safe catalog for the marketing site (industry
 * showcase + plan configurator) — no pricing logic duplicated client-side,
 * so a quote here is exactly what the real invoice will charge once wired
 * to self-service signup. Only fields safe to show a stranger are selected;
 * never the full admin catalog shape (e.g. IndustryTemplate.roles/chartOfAccounts
 * stay internal).
 */
@Controller('public/catalog')
export class PublicCatalogController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get('plans')
  listPlans() {
    return this.controlDb.plan.findMany({
      where: { isPubliclySold: true },
      select: { code: true, name: true, priceMonthly: true, priceYearly: true, userLimit: true },
      orderBy: { priceMonthly: 'asc' },
    });
  }

  @Get('modules')
  listModules() {
    return this.controlDb.moduleDefinition.findMany({
      select: { code: true, name: true, description: true, category: true, priceMonthly: true, isCore: true, dependsOn: true, features: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Get('industry-templates')
  listIndustryTemplates() {
    return this.controlDb.industryTemplate.findMany({
      select: { code: true, name: true, description: true, suggestedThemeColor: true, defaultModules: true },
      orderBy: { name: 'asc' },
    });
  }

  @Post('quote')
  async quote(@Body() dto: QuotePlanDto) {
    const plan = await this.controlDb.plan.findUnique({ where: { code: dto.planCode } });
    if (!plan || !plan.isPubliclySold) throw new NotFoundException('پلن یافت نشد');

    const uniqueCodes = [...new Set(dto.moduleCodes)];
    const modules = await this.controlDb.moduleDefinition.findMany({ where: { code: { in: uniqueCodes } } });
    const byCode = new Map(modules.map((m) => [m.code, m]));
    const missing = uniqueCodes.filter((c) => !byCode.has(c));
    if (missing.length > 0) throw new BadRequestException(`کد ماژول نامعتبر: ${missing.join('، ')}`);

    // Every selected module's own dependencies must be selected too, or the
    // quote (and the invoice it becomes) silently under-counts what's needed
    // to actually use the module.
    for (const m of modules) {
      const missingDeps = m.dependsOn.filter((dep) => !uniqueCodes.includes(dep) && !byCode.get(dep)?.isCore);
      if (missingDeps.length > 0) {
        throw new BadRequestException(`ماژول «${m.name}» به این ماژول‌ها نیاز دارد: ${missingDeps.join('، ')}`);
      }
    }

    const billableModules = modules.filter((m) => !m.isCore && m.priceMonthly > 0);
    const isYearly = dto.billingCycle === 'yearly';

    const planPrice = isYearly ? (plan.priceYearly ?? plan.priceMonthly * 12) : plan.priceMonthly;
    const moduleLines = billableModules.map((m) => ({
      code: m.code,
      name: m.name,
      price: isYearly ? m.priceMonthly * 12 : m.priceMonthly,
    }));
    const total = planPrice + moduleLines.reduce((sum, l) => sum + l.price, 0);

    return {
      billingCycle: dto.billingCycle,
      plan: { code: plan.code, name: plan.name, price: planPrice, userLimit: plan.userLimit },
      moduleLines,
      total,
    };
  }

  /**
   * The marketing site's plan-configurator CTA — no self-service checkout
   * exists yet (no payment gateway wired in), so "sign up" today means a
   * sales lead the internal team follows up on and manually provisions
   * (see AdminInternalController's existing lead pipeline, /leads in the
   * admin panel). Deliberately unowned (ownerAdminId null) until a team
   * member picks it up via the existing assign endpoint.
   */
  @Post('lead')
  createLead(@Body() dto: CreatePublicLeadDto) {
    return this.controlDb.internalLead.create({
      data: {
        name: dto.name,
        company: dto.company,
        phone: dto.phone,
        email: dto.email,
        value: dto.estimatedValue,
        notes: dto.configurationSummary,
        requestedPlanCode: dto.requestedPlanCode,
        requestedIndustryTemplateCode: dto.requestedIndustryTemplateCode,
      },
    });
  }
}
