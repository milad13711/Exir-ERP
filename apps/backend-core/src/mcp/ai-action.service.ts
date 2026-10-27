import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { AiApprovalGateway } from './ai-approval.gateway.js';
import type { McpTool } from './mcp-tool.types.js';

const MAX_PENDING_PER_TOOL = 20;
const MAX_PENDING_PER_KEY = 100;
const AI_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED'];

/**
 * The approval half of the MCP mutation gate — see mcp.controller.ts for
 * where a CREATE/UPDATE/DELETE tool call turns into a pending row here
 * instead of running immediately. Read tools never touch this file at all.
 */
@Injectable()
export class AiActionService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly notifications: NotificationsService,
    private readonly gateway: AiApprovalGateway,
  ) {}

  async requestApproval(ctx: TenantRequestContext, tool: McpTool, args: Record<string, unknown>): Promise<{ id: string; summary: string }> {
    const summary = tool.summarize ? tool.summarize(args) : tool.name;
    const keyId = ctx.auth.type === 'api_key' ? ctx.auth.sub : null;
    // سقف درخواست‌های معلق: جلوی سیل درخواست (که درخواست‌های واقعی را زیر خود پنهان می‌کند) را می‌گیرد.
    let pendingBefore = 0;
    if (keyId) {
      const [perTool, total] = await Promise.all([
        ctx.tenantDb.aiActionRequest.count({ where: { requestedByKeyId: keyId, status: 'PENDING', toolName: tool.name } }),
        ctx.tenantDb.aiActionRequest.count({ where: { requestedByKeyId: keyId, status: 'PENDING' } }),
      ]);
      if (perTool >= MAX_PENDING_PER_TOOL) throw new Error(`تعداد درخواست‌های بررسی‌نشده‌ی این ابزار به سقف ${MAX_PENDING_PER_TOOL} رسیده است؛ اول درخواست‌های قبلی در پنل تأیید یا رد شوند`);
      if (total >= MAX_PENDING_PER_KEY) throw new Error(`تعداد کل درخواست‌های بررسی‌نشده‌ی این کلید به سقف ${MAX_PENDING_PER_KEY} رسیده است`);
      pendingBefore = total;
    }
    const request = await ctx.tenantDb.aiActionRequest.create({
      data: { toolName: tool.name, operationType: tool.operation, summary, arguments: args as never, requestedByKeyId: keyId },
    });

    const managers = await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId);
    const userIds = managers.map((m) => m.tenantUserId);
    this.gateway.notifyPending(userIds, { id: request.id, toolName: tool.name, operationType: tool.operation, summary });
    // اعلان تجمیعی: فقط برای اولین درخواست معلق و سپس به ازای هر ۱۰ درخواست؛ بقیه فقط در فهرست/پاپ‌آپ دیده می‌شوند.
    if (pendingBefore === 0 || pendingBefore % 10 === 0) {
      await Promise.all(
        managers.map((m) =>
          this.notifications.notify(ctx.tenantDb, {
            userId: m.tenantUserId,
            type: 'ai.action.pending',
            title: 'درخواست تأیید از دستیار هوشمند',
            body: pendingBefore === 0 ? summary : `${pendingBefore + 1} درخواست بررسی‌نشده در انتظار شماست`,
            link: '/settings/ai-assistant',
          }),
        ),
      );
    }

    return { id: request.id, summary };
  }

  /** فهرست با فیلتر وضعیت و صفحه‌بندی (cursor)؛ درخواست‌های معلق همیشه می‌توانند جدا فیلتر شوند و زیر ۱۰۰ مورد تازه پنهان نمی‌مانند. */
  async list(ctx: TenantRequestContext, opts: { status?: string; cursor?: string; limit?: number } = {}) {
    const take = Math.min(Math.max(Math.floor(opts.limit ?? 30) || 30, 1), 100);
    const where = opts.status && AI_STATUSES.includes(opts.status) ? { status: opts.status } : {};
    const rows = await ctx.tenantDb.aiActionRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: { decidedBy: { select: { id: true, name: true } } },
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  /** مقدار فعلی رکوردی که درخواست ویرایش آن را دارد (برای نمایش تفاوت پیش از تأیید). null = قابل‌نمایش نیست. */
  async currentValues(ctx: TenantRequestContext, id: string): Promise<Record<string, unknown> | null> {
    const r = await ctx.tenantDb.aiActionRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('درخواست یافت نشد');
    const a = (r.arguments ?? {}) as Record<string, unknown>;
    const db = ctx.tenantDb;
    switch (r.toolName) {
      case 'update_crm_contact': {
        const c = await db.crmContact.findUnique({ where: { id: String(a.contactId) }, select: { name: true, phone: true, email: true, company: true } });
        return c;
      }
      case 'update_funnel_stage':
      case 'disqualify_lead':
      case 'convert_lead_to_customer': {
        const c = await db.crmContact.findUnique({ where: { id: String(a.contactId) }, select: { name: true, funnelStage: true } });
        return c;
      }
      case 'reassign_task': {
        const t = await db.task.findUnique({ where: { id: String(a.taskId) }, select: { title: true, status: true, assignees: { select: { userId: true } } } });
        if (!t) return null;
        const users = t.assignees.length ? await db.user.findMany({ where: { id: { in: t.assignees.map((x) => x.userId) } }, select: { name: true } }) : [];
        return { title: t.title, status: t.status, currentAssignees: users.map((u) => u.name) };
      }
      default:
        return null;
    }
  }

  async approve(ctx: TenantRequestContext, id: string, userId: string | null, tools: McpTool[]): Promise<unknown> {
    const request = await ctx.tenantDb.aiActionRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('درخواست یافت نشد');
    if (request.status !== 'PENDING') throw new BadRequestException('این درخواست قبلاً بررسی شده است');

    const tool = tools.find((t) => t.name === request.toolName);
    if (!tool) throw new BadRequestException('ابزار مربوط به این درخواست دیگر در دسترس نیست');

    // ادعای اتمی: فقط یک تأییدکننده برنده می‌شود (تأیید هم‌زمان/دوبل handler را دوبار اجرا نمی‌کند).
    const claim = await ctx.tenantDb.aiActionRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', decidedByUserId: userId ?? undefined, decidedAt: new Date() },
    });
    if (claim.count !== 1) throw new BadRequestException('این درخواست قبلاً بررسی شده است');

    try {
      const result = await tool.handler(request.arguments as Record<string, unknown>, ctx);
      await ctx.tenantDb.aiActionRequest.update({
        where: { id },
        data: { status: 'EXECUTED', result: result as never, executedAt: new Date() },
      });
      await this.notifyResolved(ctx, id, 'EXECUTED');
      return result;
    } catch (err) {
      // شکست = FAILED با دلیل؛ هرگز به PENDING برنمی‌گردد (اجرای دوباره‌ی ناخواسته ممکن نیست)
      const error = err instanceof Error ? err.message : 'خطای ناشناخته';
      await ctx.tenantDb.aiActionRequest.update({ where: { id }, data: { status: 'FAILED', error } });
      await this.notifyResolved(ctx, id, 'FAILED');
      throw new BadRequestException(`اجرای اقدام تأییدشده شکست خورد: ${error}`);
    }
  }

  async reject(ctx: TenantRequestContext, id: string, userId: string | null): Promise<void> {
    const request = await ctx.tenantDb.aiActionRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('درخواست یافت نشد');
    if (request.status !== 'PENDING') throw new BadRequestException('این درخواست قبلاً بررسی شده است');

    const claim = await ctx.tenantDb.aiActionRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedByUserId: userId ?? undefined, decidedAt: new Date() },
    });
    if (claim.count !== 1) throw new BadRequestException('این درخواست قبلاً بررسی شده است');
    await this.notifyResolved(ctx, id, 'REJECTED');
  }

  private async notifyResolved(ctx: TenantRequestContext, id: string, status: string): Promise<void> {
    const managers = await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId);
    this.gateway.notifyResolved(managers.map((m) => m.tenantUserId), { id, status });
  }
}
