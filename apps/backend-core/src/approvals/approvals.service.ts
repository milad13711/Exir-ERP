import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { TenantRequestContext } from '../common/request-context.js';

export type ApprovalDecisionOptions = { stampApplied: boolean; note?: string; requestedByUserId?: string | null; requestSummary?: string | null };

export type ApprovalDetail = { fields: Array<{ label: string; value: string }> };

/** هر ماژولی که سندش با تأیید مدیر پیش می‌رود، برای entityType خودش یکی از این‌ها را ثبت می‌کند. */
export type ApprovalHandler = {
  approve(ctx: TenantRequestContext, entityId: string, opts: ApprovalDecisionOptions): Promise<void>;
  reject(ctx: TenantRequestContext, entityId: string, opts: ApprovalDecisionOptions): Promise<void>;
  /** جزئیات سند برای نمایش در کارتابل — مدیر قبل از تصمیم همه‌ی اطلاعات را می‌بیند */
  describe?(ctx: TenantRequestContext, entityId: string): Promise<ApprovalDetail>;
};

export type ApprovalRequestInput = {
  moduleCode: string;
  entityType: string;
  entityId: string;
  title: string;
  summary?: string;
  link?: string;
  isOfficial?: boolean;
  requestedByUserId?: string;
  /** تأییدکننده‌ی مشخص (غیرمدیر)؛ خالی یعنی مدیران. */
  assigneeUserId?: string;
};

@Injectable()
export class ApprovalsService {
  private readonly handlers = new Map<string, ApprovalHandler>();

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  registerHandler(entityType: string, handler: ApprovalHandler): void {
    this.handlers.set(entityType, handler);
  }

  /** یک درخواست تأیید در کارتابل مدیر می‌سازد و برای همه‌ی مدیران اعلان می‌فرستد (تکراری برای همان سند ساخته نمی‌شود). */
  async request(ctx: TenantRequestContext, input: ApprovalRequestInput) {
    // شکست زودهنگام: سندی که کسی نتواند از کارتابل تأییدش کند، نباید اصلاً وارد کارتابل شود.
    if (!this.handlers.has(input.entityType)) {
      throw new Error(`برای entityType «${input.entityType}» پردازشگر تأیید ثبت نشده است — registerHandler را در onModuleInit ماژول صدا بزنید`);
    }
    const existing = await ctx.tenantDb.approvalRequest.findFirst({
      where: { entityType: input.entityType, entityId: input.entityId, status: 'PENDING' },
    });
    if (existing) return existing;

    // مدیر تأییدکننده‌ی نهایی ثبت‌شده برای این ماژول (تنظیمات → مدیر تاییدکننده‌ی ماژول‌ها)
    const moduleApprover = input.assigneeUserId
      ? null
      : await ctx.tenantDb.moduleApprover.findUnique({ where: { moduleCode: input.moduleCode } });
    const assigneeUserId = input.assigneeUserId ?? moduleApprover?.userId;

    const created = await ctx.tenantDb.approvalRequest.create({
      data: {
        moduleCode: input.moduleCode,
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
        summary: input.summary,
        link: input.link,
        isOfficial: input.isOfficial ?? false,
        requestedByUserId: input.requestedByUserId,
        assigneeUserId,
      },
    });

    // تأییدکننده‌ی مشخص + مدیران بالادستی (مالک/ادمین) هر دو اعلان می‌گیرند
    const managers = await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId);
    const recipients = assigneeUserId
      ? [{ tenantUserId: assigneeUserId }, ...managers.filter((m) => m.tenantUserId !== assigneeUserId)]
      : managers;
    for (const m of recipients) {
      await this.notifications
        .notify(ctx.tenantDb, {
          userId: m.tenantUserId,
          type: 'APPROVAL_REQUEST',
          title: `در انتظار تأیید شما: ${input.title}`,
          body: input.summary,
          link: `/approvals?open=${created.id}`,
        })
        .catch(() => undefined);
    }
    return created;
  }

  /**
   * عمل حساس (ابطال سند مالی، حذف قطعی): مدیر مستقیم اجرا می‌کند، غیرمدیر فقط درخواست می‌سازد
   * و پس از تأیید مدیر در کارتابل اجرا می‌شود. خروجی می‌گوید کدام اتفاق افتاد.
   */
  async runOrRequest<T>(ctx: TenantRequestContext, input: ApprovalRequestInput, action: () => Promise<T>): Promise<{ executed: true; result: T } | { executed: false; pendingApproval: true }> {
    if (this.isManager(ctx)) return { executed: true, result: await action() };
    const requestedByUserId = (await resolveTenantUserId(ctx).catch(() => null)) ?? undefined;
    await this.request(ctx, { ...input, requestedByUserId });
    return { executed: false, pendingApproval: true };
  }

  /** وقتی سند از مسیر خود ماژول (نه کارتابل) تأیید/رد شد، درخواست متناظر هم بسته می‌شود. */
  async closeForEntity(ctx: TenantRequestContext, entityType: string, entityId: string, status: 'APPROVED' | 'REJECTED', stampApplied = false) {
    const decidedByUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    await ctx.tenantDb.approvalRequest.updateMany({
      where: { entityType, entityId, status: 'PENDING' },
      data: { status, decidedAt: new Date(), decidedByUserId, stampApplied },
    });
  }

  async listModuleApprovers(ctx: TenantRequestContext) {
    return ctx.tenantDb.moduleApprover.findMany({ include: { user: { select: { id: true, name: true } } } });
  }

  /** userId خالی = حذف تأییدکننده‌ی اختصاصی؛ اسناد ماژول دوباره فقط برای مدیران نمایش داده می‌شود. */
  async setModuleApprover(ctx: TenantRequestContext, moduleCode: string, userId: string | null) {
    if (!this.isManager(ctx)) throw new ForbiddenException('فقط مالک یا مدیر می‌تواند مدیر تأییدکننده را تعیین کند');
    if (!userId) {
      await ctx.tenantDb.moduleApprover.deleteMany({ where: { moduleCode } });
      return { moduleCode, userId: null };
    }
    await ctx.tenantDb.user.findUniqueOrThrow({ where: { id: userId } });
    await ctx.tenantDb.moduleApprover.upsert({ where: { moduleCode }, create: { moduleCode, userId }, update: { userId } });
    return { moduleCode, userId };
  }

  private isManager(ctx: TenantRequestContext): boolean {
    return ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
  }

  /** کارتابل هر کاربر: مدیران همه‌ی درخواست‌ها، سایرین فقط آنچه به خودشان ارجاع شده. */
  private async scopeWhere(ctx: TenantRequestContext): Promise<Record<string, unknown>> {
    if (this.isManager(ctx)) return {};
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    return { assigneeUserId: userId ?? '__none__' };
  }

  async list(ctx: TenantRequestContext, status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const scope = await this.scopeWhere(ctx);
    return ctx.tenantDb.approvalRequest.findMany({
      where: { ...scope, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async pendingCount(ctx: TenantRequestContext): Promise<{ count: number }> {
    const scope = await this.scopeWhere(ctx);
    return { count: await ctx.tenantDb.approvalRequest.count({ where: { ...scope, status: 'PENDING' } }) };
  }

  /** جزئیات کامل درخواست + سند مرتبط؛ همان کنترل دسترسیِ فهرست کارتابل. */
  async detail(ctx: TenantRequestContext, id: string) {
    const request = await ctx.tenantDb.approvalRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('این درخواست یافت نشد');
    if (!this.isManager(ctx)) {
      const me = await resolveTenantUserId(ctx).catch(() => null);
      if (!me || request.assigneeUserId !== me) throw new ForbiddenException('این سند برای شما ارجاع نشده است');
    }
    const handler = this.handlers.get(request.entityType);
    let detail: ApprovalDetail = { fields: [] };
    if (handler?.describe) {
      detail = await handler.describe(ctx, request.entityId).catch(() => ({ fields: [{ label: 'توضیح', value: 'سند مرتبط در دسترس نیست (ممکن است حذف شده باشد)' }] }));
    }
    return { request, detail };
  }

  async decide(ctx: TenantRequestContext, id: string, approved: boolean, opts: { withStamp?: boolean; note?: string }) {
    const request = await ctx.tenantDb.approvalRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('این درخواست یافت نشد');
    if (!this.isManager(ctx)) {
      const me = await resolveTenantUserId(ctx).catch(() => null);
      if (!me || request.assigneeUserId !== me) throw new ForbiddenException('این سند برای تأیید شما ارجاع نشده است');
    }
    if (request.status !== 'PENDING') throw new BadRequestException('درباره‌ی این درخواست قبلاً تصمیم‌گیری شده است');
    if (opts.withStamp && !request.isOfficial) throw new BadRequestException('این سند رسمی نیست و مهر و امضا ندارد');

    const handler = this.handlers.get(request.entityType);
    if (!handler) throw new BadRequestException('برای این نوع سند پردازشگر تأیید تعریف نشده است');

    const stampApplied = approved && !!opts.withStamp;
    // تأییدکننده‌ی تعیین‌شده (غیرمدیر) فقط برای همین سند از طرف مدیر عمل می‌کند؛
    // اجرای handler با نقش مدیر است، ولی هیچ اندپوینت دیگری باز نمی‌شود.
    const actingCtx: TenantRequestContext = this.isManager(ctx) ? ctx : { ...ctx, auth: { ...ctx.auth, role: 'ADMIN' } };
    const handlerOpts = { stampApplied, note: opts.note, requestedByUserId: request.requestedByUserId, requestSummary: request.summary };
    if (approved) await handler.approve(actingCtx, request.entityId, handlerOpts);
    else await handler.reject(actingCtx, request.entityId, { ...handlerOpts, stampApplied: false });

    const decidedByUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    return ctx.tenantDb.approvalRequest.update({
      where: { id },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED',
        decidedAt: new Date(),
        decidedByUserId,
        stampApplied,
        decisionNote: opts.note,
      },
    });
  }
}
