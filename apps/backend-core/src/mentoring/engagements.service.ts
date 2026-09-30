import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { CreateEngagementDto } from './dto/create-engagement.dto.js';
import type { UpdateEngagementDto } from './dto/update-engagement.dto.js';

const ENGAGEMENT_INCLUDE = {
  contact: { select: { id: true, name: true, phone: true, company: true } },
  advisor: { select: { id: true, name: true } },
  contract: { select: { id: true, contractNo: true, title: true } },
  project: { select: { id: true, projectNo: true, name: true } },
} as const;

@Injectable()
export class EngagementsService {
  list(ctx: TenantRequestContext, filters: { status?: string; contactId?: string; advisorUserId?: string }) {
    return ctx.tenantDb.mentoringEngagement.findMany({
      where: {
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.contactId ? { contactId: filters.contactId } : {}),
        ...(filters.advisorUserId ? { advisorUserId: filters.advisorUserId } : {}),
      },
      include: ENGAGEMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const engagement = await ctx.tenantDb.mentoringEngagement.findUnique({
      where: { id },
      include: {
        ...ENGAGEMENT_INCLUDE,
        sessions: { orderBy: { scheduledAt: 'desc' }, include: { survey: { select: { rating: true, note: true, sentAt: true, submittedAt: true } } } },
        goals: { include: { checkIns: { orderBy: { recordedAt: 'desc' } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!engagement) throw new NotFoundException('این همکاری یافت نشد');
    return engagement;
  }

  private assertPricingFields(dto: { pricingModel: string; hourlyRate?: number; packageSessionsCount?: number; packagePrice?: number; subscriptionMonthlyPrice?: number }) {
    if (dto.pricingModel === 'HOURLY' && dto.hourlyRate == null) {
      throw new BadRequestException('برای مدل ساعتی، نرخ ساعتی الزامی است');
    }
    if (dto.pricingModel === 'PACKAGE' && (dto.packageSessionsCount == null || dto.packagePrice == null)) {
      throw new BadRequestException('برای مدل بسته‌ای، تعداد جلسه و قیمت بسته الزامی است');
    }
    if (dto.pricingModel === 'SUBSCRIPTION' && dto.subscriptionMonthlyPrice == null) {
      throw new BadRequestException('برای مدل اشتراکی، مبلغ ماهانه الزامی است');
    }
  }

  async create(ctx: TenantRequestContext, dto: CreateEngagementDto) {
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.contactId } });
    await ctx.tenantDb.user.findUniqueOrThrow({ where: { id: dto.advisorUserId } });
    this.assertPricingFields(dto);
    const createdByUserId = await resolveTenantUserId(ctx);

    return ctx.tenantDb.mentoringEngagement.create({
      data: {
        contactId: dto.contactId,
        advisorUserId: dto.advisorUserId,
        title: dto.title,
        pricingModel: dto.pricingModel,
        hourlyRate: dto.hourlyRate,
        packageSessionsCount: dto.packageSessionsCount,
        packagePrice: dto.packagePrice,
        subscriptionMonthlyPrice: dto.subscriptionMonthlyPrice,
        contractId: dto.contractId,
        projectId: dto.projectId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        notes: dto.notes,
        createdByUserId,
      },
      include: ENGAGEMENT_INCLUDE,
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateEngagementDto) {
    const existing = await ctx.tenantDb.mentoringEngagement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این همکاری یافت نشد');

    const merged = {
      pricingModel: dto.pricingModel ?? existing.pricingModel,
      hourlyRate: dto.hourlyRate ?? existing.hourlyRate ?? undefined,
      packageSessionsCount: dto.packageSessionsCount ?? existing.packageSessionsCount ?? undefined,
      packagePrice: dto.packagePrice ?? existing.packagePrice ?? undefined,
      subscriptionMonthlyPrice: dto.subscriptionMonthlyPrice ?? existing.subscriptionMonthlyPrice ?? undefined,
    };
    this.assertPricingFields(merged);

    return ctx.tenantDb.mentoringEngagement.update({
      where: { id },
      data: {
        advisorUserId: dto.advisorUserId,
        title: dto.title,
        pricingModel: dto.pricingModel,
        hourlyRate: dto.hourlyRate,
        packageSessionsCount: dto.packageSessionsCount,
        packagePrice: dto.packagePrice,
        subscriptionMonthlyPrice: dto.subscriptionMonthlyPrice,
        status: dto.status,
        contractId: dto.contractId,
        projectId: dto.projectId,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        notes: dto.notes,
      },
      include: ENGAGEMENT_INCLUDE,
    });
  }
}
