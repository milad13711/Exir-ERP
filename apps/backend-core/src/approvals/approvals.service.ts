import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { TenantRequestContext } from '../common/request-context.js';

export type ApprovalDecisionOptions = { stampApplied: boolean; note?: string };

/** هر ماژولی که سندش با تأیید مدیر پیش می‌رود، برای entityType خودش یکی از این‌ها را ثبت می‌کند. */
export type ApprovalHandler = {
  approve(ctx: TenantRequestContext, entityId: string, opts: ApprovalDecisionOptions): Promise<void>;
  reject(ctx: TenantRequestContext, entityId: string, opts: ApprovalDecisionOptions): Promise<void>;
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
        assigneeUserId: input.assigneeUserId,
      },
    });

    const recipients = input.assigneeUserId
      ? [{ tenantUserId: input.assigneeUserId }]
      : await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId);
    for (const m of recipients) {
      await this.notifications
        .notify(ctx.tenantDb, {
          userId: m.tenantUserId,
          type: 'APPROVAL_REQUEST',
          title: `در انتظار تأیید شما: ${input.title}`,
          body: input.summary,
          link: '/approvals',
        })
        .catch(() => undefined);
    }
    return created;
  }

  /** وقتی سند از مسیر خود ماژول (نه کارتابل) تأیید/رد شد، درخواست متناظر هم بسته می‌شود. */
  async closeForEntity(ctx: TenantRequestContext, entityType: string, entityId: string, status: 'APPROVED' | 'REJECTED', stampApplied = false) {
    const decidedByUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    await ctx.tenantDb.approvalRequest.updateMany({
      where: { entityType, entityId, status: 'PENDING' },
      data: { status, decidedAt: new Date(), decidedByUserId, stampApplied },
    });
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
    if (approved) await handler.approve(ctx, request.entityId, { stampApplied, note: opts.note });
    else await handler.reject(ctx, request.entityId, { stampApplied: false, note: opts.note });

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
