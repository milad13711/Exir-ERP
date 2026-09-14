import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { CreateReportDto } from './dto/create-report.dto.js';
import type { UpdateReportDto } from './dto/update-report.dto.js';
import type { ReferReportDto } from './dto/refer-report.dto.js';
import type { CreateReportCategoryDto } from './dto/create-category.dto.js';

const REPORT_INCLUDE = {
  category: true,
  createdBy: { select: { id: true, name: true } },
  referrals: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      fromUser: { select: { id: true, name: true } },
      toUser: { select: { id: true, name: true } },
    },
  },
};

@Injectable()
export class ReportsService {
  constructor(private readonly notifications: NotificationsService) {}

  // ── دسته‌بندی‌ها ───────────────────────────────────────────────────────

  async listCategories(ctx: TenantRequestContext) {
    return ctx.tenantDb.reportCategory.findMany({ orderBy: { name: 'asc' } });
  }

  async createCategory(ctx: TenantRequestContext, dto: CreateReportCategoryDto) {
    return ctx.tenantDb.reportCategory.create({ data: { name: dto.name.trim() } });
  }

  async deleteCategory(ctx: TenantRequestContext, id: string) {
    const category = await ctx.tenantDb.reportCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('این دسته‌بندی یافت نشد');
    await ctx.tenantDb.reportCategory.delete({ where: { id } });
    return { ok: true };
  }

  // ── گزارش‌ها ───────────────────────────────────────────────────────────

  async list(
    ctx: TenantRequestContext,
    filters: { categoryId?: string; isArchived?: boolean; isKnowledge?: boolean; referredToMe?: boolean },
  ) {
    const userId = filters.referredToMe ? await resolveTenantUserId(ctx).catch(() => undefined) : undefined;
    return ctx.tenantDb.report.findMany({
      where: {
        categoryId: filters.categoryId,
        isArchived: filters.isArchived,
        isKnowledge: filters.isKnowledge,
        ...(filters.referredToMe && userId ? { referrals: { some: { toUserId: userId } } } : {}),
      },
      include: REPORT_INCLUDE,
      orderBy: { reportNo: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const report = await ctx.tenantDb.report.findUnique({ where: { id }, include: REPORT_INCLUDE });
    if (!report) throw new NotFoundException('این گزارش یافت نشد');
    return report;
  }

  async create(ctx: TenantRequestContext, dto: CreateReportDto) {
    const createdByUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    const report = await ctx.tenantDb.report.create({
      data: {
        title: dto.title.trim(),
        body: dto.body,
        categoryId: dto.categoryId,
        executionAt: dto.executionAt ? new Date(dto.executionAt) : undefined,
        createdByUserId,
      },
      include: REPORT_INCLUDE,
    });
    return report;
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateReportDto) {
    await this.detail(ctx, id);
    return ctx.tenantDb.report.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        body: dto.body,
        categoryId: dto.categoryId,
        executionAt: dto.executionAt ? new Date(dto.executionAt) : undefined,
      },
      include: REPORT_INCLUDE,
    });
  }

  async remove(ctx: TenantRequestContext, id: string) {
    await this.detail(ctx, id);
    await ctx.tenantDb.report.delete({ where: { id } });
    return { ok: true };
  }

  async setArchived(ctx: TenantRequestContext, id: string, isArchived: boolean) {
    await this.detail(ctx, id);
    return ctx.tenantDb.report.update({ where: { id }, data: { isArchived }, include: REPORT_INCLUDE });
  }

  async setKnowledge(ctx: TenantRequestContext, id: string, isKnowledge: boolean) {
    await this.detail(ctx, id);
    return ctx.tenantDb.report.update({ where: { id }, data: { isKnowledge }, include: REPORT_INCLUDE });
  }

  /** ارجاع به یک یا چند نفر — قابل تکرار روی همان گزارش (ویرایش و ارسال مجدد). */
  async refer(ctx: TenantRequestContext, id: string, dto: ReferReportDto) {
    const report = await this.detail(ctx, id);
    const fromUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    const emailCcValue = dto.emailCc?.length ? dto.emailCc.join(',') : undefined;

    await ctx.tenantDb.reportReferral.createMany({
      data: dto.toUserIds.map((toUserId) => ({
        reportId: id,
        fromUserId,
        toUserId,
        note: dto.note,
        emailCc: emailCcValue,
      })),
    });

    for (const toUserId of dto.toUserIds) {
      await this.notifications.notify(ctx.tenantDb, {
        userId: toUserId,
        type: 'report.referred',
        title: `گزارش شماره ${report.reportNo} برای شما ارجاع شد`,
        body: report.title,
        link: `/reports?id=${id}`,
        emailCc: dto.emailCc,
      });
    }

    return this.detail(ctx, id);
  }

  async paraphReferral(ctx: TenantRequestContext, reportId: string, referralId: string) {
    const referral = await ctx.tenantDb.reportReferral.findUnique({ where: { id: referralId } });
    if (!referral || referral.reportId !== reportId) throw new NotFoundException('این ارجاع یافت نشد');
    await ctx.tenantDb.reportReferral.update({
      where: { id: referralId },
      data: { paraphed: true, paraphedAt: new Date() },
    });
    return this.detail(ctx, reportId);
  }
}
