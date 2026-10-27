import { Controller, ForbiddenException, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { HumanOnly } from '../common/decorators/human-only.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AiActionService } from './ai-action.service.js';
import { McpToolsService } from './mcp-tools.service.js';

/**
 * The human side of the MCP approval queue — see mcp.controller.ts for how
 * a request lands here. Restricted to OWNER/ADMIN, matching exactly who
 * getManagerUsers() (see ai-action.service.ts) actually notifies — a
 * pending request can be for any module, so there's no single narrower
 * permission to check it against.
 */
/**
 * تأیید/ردِ درخواست فقط توسط انسان با نشست کاربری: اگر خودِ کلید API (یا ایجنتی که با آن کار می‌کند) می‌توانست
 * درخواستِ خودش را تأیید کند، کل دروازه‌ی تأیید بی‌اثر می‌شد.
 */
function assertHumanDecision(ctx: TenantRequestContext): void {
  if (ctx.auth.type === 'api_key') throw new ForbiddenException('تأیید یا ردِ درخواست‌ها فقط توسط کاربر داخل پنل ممکن است، نه با کلید API');
}

@Controller('ai-actions')
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard)
@RequireModule('mcp')
@Roles('OWNER', 'ADMIN')
@HumanOnly()
export class AiActionsController {
  constructor(
    private readonly aiActions: AiActionService,
    private readonly toolsService: McpToolsService,
  ) {}

  @Get()
  list(@Query('status') status: string | undefined, @Query('cursor') cursor: string | undefined, @Query('limit') limit: string | undefined, @Ctx() ctx: TenantRequestContext) {
    assertHumanDecision(ctx); // کلید API فهرست (arguments/result ماژول‌های دیگر) را نمی‌خواند
    return this.aiActions.list(ctx, { status, cursor, limit: limit ? Number(limit) : undefined });
  }

  @Get(':id/current')
  current(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    assertHumanDecision(ctx);
    return this.aiActions.currentValues(ctx, id);
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    assertHumanDecision(ctx);
    const userId = await resolveTenantUserId(ctx);
    const result = await this.aiActions.approve(ctx, id, userId, this.toolsService.tools);
    return { success: true, result };
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    assertHumanDecision(ctx);
    const userId = await resolveTenantUserId(ctx);
    await this.aiActions.reject(ctx, id, userId);
    return { success: true };
  }
}
