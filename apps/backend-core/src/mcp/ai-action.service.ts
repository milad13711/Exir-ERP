import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { AiApprovalGateway } from './ai-approval.gateway.js';
import type { McpTool } from './mcp-tools.js';

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
    const request = await ctx.tenantDb.aiActionRequest.create({
      data: { toolName: tool.name, operationType: tool.operation, summary, arguments: args as never },
    });

    const managers = await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId);
    const userIds = managers.map((m) => m.tenantUserId);
    this.gateway.notifyPending(userIds, { id: request.id, toolName: tool.name, operationType: tool.operation, summary });
    await Promise.all(
      managers.map((m) =>
        this.notifications.notify(ctx.tenantDb, {
          userId: m.tenantUserId,
          type: 'ai.action.pending',
          title: 'درخواست تأیید از دستیار هوشمند',
          body: summary,
          link: '/settings/ai-assistant',
        }),
      ),
    );

    return { id: request.id, summary };
  }

  async list(ctx: TenantRequestContext) {
    return ctx.tenantDb.aiActionRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { decidedBy: { select: { id: true, name: true } } },
    });
  }

  async approve(ctx: TenantRequestContext, id: string, userId: string | null, tools: McpTool[]): Promise<unknown> {
    const request = await ctx.tenantDb.aiActionRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('درخواست یافت نشد');
    if (request.status !== 'PENDING') throw new BadRequestException('این درخواست قبلاً بررسی شده است');

    const tool = tools.find((t) => t.name === request.toolName);
    if (!tool) throw new BadRequestException('ابزار مربوط به این درخواست دیگر در دسترس نیست');

    await ctx.tenantDb.aiActionRequest.update({
      where: { id },
      data: { status: 'APPROVED', decidedByUserId: userId ?? undefined, decidedAt: new Date() },
    });

    try {
      const result = await tool.handler(request.arguments as Record<string, unknown>, ctx);
      await ctx.tenantDb.aiActionRequest.update({
        where: { id },
        data: { status: 'EXECUTED', result: result as never, executedAt: new Date() },
      });
      await this.notifyResolved(ctx, id, 'EXECUTED');
      return result;
    } catch (err) {
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

    await ctx.tenantDb.aiActionRequest.update({
      where: { id },
      data: { status: 'REJECTED', decidedByUserId: userId ?? undefined, decidedAt: new Date() },
    });
    await this.notifyResolved(ctx, id, 'REJECTED');
  }

  private async notifyResolved(ctx: TenantRequestContext, id: string, status: string): Promise<void> {
    const managers = await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId);
    this.gateway.notifyResolved(managers.map((m) => m.tenantUserId), { id, status });
  }
}
