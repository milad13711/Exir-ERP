import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ReferralsService } from '../referrals/referrals.service.js';
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
  constructor(
    private readonly notifications: NotificationsService,
    private readonly referrals: ReferralsService,
  ) {}

  // ── دسته‌بندی‌ها ───────────────────────────────────────────────────────

  async listCategories(ctx: TenantRequestContext) {
    return ctx.tenantDb.reportCategory.findMany({ orderBy: { name: 'asc' } });
  }

  async createCategory(ctx: TenantRequestContext, dto: CreateReportCategoryDto) {
    return ctx.tenantDb.reportCategory.create({ data: { name: dto.name.trim() } });
  }

  async renameCategory(ctx: TenantRequestContext, id: string, dto: CreateReportCategoryDto) {
    const category = await ctx.tenantDb.reportCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('این دسته‌بندی یافت نشد');
    const name = dto.name.trim();
    const clash = await ctx.tenantDb.reportCategory.findUnique({ where: { name } });
    if (clash && clash.id !== id) throw new ConflictException('دسته‌بندی دیگری با این نام وجود دارد');
    return ctx.tenantDb.reportCategory.update({ where: { id }, data: { name } });
  }

  async deleteCategory(ctx: TenantRequestContext, id: string) {
    const category = await ctx.tenantDb.reportCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('این دسته‌بندی یافت نشد');
    await ctx.tenantDb.reportCategory.delete({ where: { id } });
    return { ok: true };
  }

  // ── گزارش‌ها ───────────────────────────────────────────────────────────

  /**
   * `scope` = خروجی reportScope() (کنترلر همیشه می‌فرستد). فقط فراخوانی‌های داخلیِ سرور (مثل چک‌لیست روزانه)
   * بدون scope کار می‌کنند.
   */
  async list(
    ctx: TenantRequestContext,
    filters: { categoryId?: string; isArchived?: boolean; isKnowledge?: boolean; referredToMe?: boolean },
    scope: Record<string, unknown> = {},
  ) {
    const userId = filters.referredToMe ? await resolveTenantUserId(ctx).catch(() => undefined) : undefined;
    return ctx.tenantDb.report.findMany({
      where: {
        ...scope,
        categoryId: filters.categoryId,
        isArchived: filters.isArchived,
        isKnowledge: filters.isKnowledge,
        ...(filters.referredToMe && userId ? { referrals: { some: { toUserId: userId } } } : {}),
      },
      include: REPORT_INCLUDE,
      orderBy: { reportNo: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string, scope: Record<string, unknown> = {}) {
    const report = await ctx.tenantDb.report.findFirst({ where: { id, ...scope }, include: REPORT_INCLUDE });
    if (!report) throw new NotFoundException('این گزارش یافت نشد');
    return report;
  }

  /** `authorUserId` فقط برای تجمیع خودکار (مثلاً مدیر برای زیردست گزارش روزانه می‌سازد) — نویسنده همان صاحب چک‌لیست است. */
  async create(ctx: TenantRequestContext, dto: CreateReportDto, authorUserId?: string) {
    const createdByUserId = authorUserId ?? (await resolveTenantUserId(ctx).catch(() => undefined));
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

  async update(ctx: TenantRequestContext, id: string, dto: UpdateReportDto, scope: Record<string, unknown> = {}) {
    await this.detail(ctx, id, scope);
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

  async remove(ctx: TenantRequestContext, id: string, scope: Record<string, unknown> = {}) {
    await this.detail(ctx, id, scope);
    await ctx.tenantDb.report.delete({ where: { id } });
    return { ok: true };
  }

  async setArchived(ctx: TenantRequestContext, id: string, isArchived: boolean, scope: Record<string, unknown> = {}) {
    await this.detail(ctx, id, scope);
    return ctx.tenantDb.report.update({ where: { id }, data: { isArchived }, include: REPORT_INCLUDE });
  }

  async setKnowledge(ctx: TenantRequestContext, id: string, isKnowledge: boolean, scope: Record<string, unknown> = {}) {
    await this.detail(ctx, id, scope);
    return ctx.tenantDb.report.update({ where: { id }, data: { isKnowledge }, include: REPORT_INCLUDE });
  }

  /** ارجاع به یک یا چند نفر — قابل تکرار روی همان گزارش (ویرایش و ارسال مجدد). */
  async refer(ctx: TenantRequestContext, id: string, dto: ReferReportDto, scope: Record<string, unknown> = {}) {
    const report = await this.detail(ctx, id, scope);
    const targets = await ctx.tenantDb.user.findMany({ where: { id: { in: dto.toUserIds } }, select: { id: true } });
    if (targets.length !== new Set(dto.toUserIds).size) throw new NotFoundException('یکی از گیرندگان یافت نشد');
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

    // ارجاع عمومی (صندوق «ارجاع‌های من»، دسترسی مشاهده‌ی همین گزارش حتی بدون دسترسی ماژول، اعلان با لینک مستقیم).
    // اعلان همین‌جا از مسیر عمومی می‌رود (دسته‌ی «تأییدها/ارجاع»، عنوان روشن، لینک به خودِ گزارش).
    for (const toUserId of new Set(dto.toUserIds)) {
      if (toUserId === fromUserId) continue;
      await this.referrals.refer(
        ctx,
        { entityType: 'Report', entityId: id, toUserId, note: dto.note, additional: true },
        { emailCc: dto.emailCc, trusted: true, renotify: true },
      );
    }

    return this.detail(ctx, id, scope);
  }

  /** پاراف فقط توسط گیرنده‌ی همین ارجاع (یا مدیر)؛ گزارش هم باید در دامنه‌ی دید کاربر باشد. */
  async paraphReferral(ctx: TenantRequestContext, reportId: string, referralId: string, scope: Record<string, unknown> = {}) {
    await this.detail(ctx, reportId, scope);
    const referral = await ctx.tenantDb.reportReferral.findUnique({ where: { id: referralId } });
    if (!referral || referral.reportId !== reportId) throw new NotFoundException('این ارجاع یافت نشد');
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      const me = await resolveTenantUserId(ctx).catch(() => null);
      if (!me || referral.toUserId !== me) throw new ForbiddenException('فقط گیرنده‌ی این ارجاع می‌تواند پاراف کند');
    }
    await ctx.tenantDb.reportReferral.update({
      where: { id: referralId },
      data: { paraphed: true, paraphedAt: new Date() },
    });
    // پاراف = پایان کارِ ارجاع؛ ارجاع عمومی متناظر هم «انجام‌شده» می‌شود (دسترسی صریح لغو و از صندوق خارج می‌شود).
    await this.referrals.completeActiveFor(ctx, 'Report', reportId, referral.toUserId, 'پاراف شد');
    return this.detail(ctx, reportId, scope);
  }
}
