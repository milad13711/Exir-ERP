import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AiActionService } from './ai-action.service.js';
import { McpToolsService } from './mcp-tools.service.js';

/** The human side of the MCP approval queue — see mcp.controller.ts for how a request lands here in the first place. */
@Controller('ai-actions')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('mcp')
export class AiActionsController {
  constructor(
    private readonly aiActions: AiActionService,
    private readonly toolsService: McpToolsService,
  ) {}

  @Get()
  list(@Ctx() ctx: TenantRequestContext) {
    return this.aiActions.list(ctx);
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    const result = await this.aiActions.approve(ctx, id, userId, this.toolsService.tools);
    return { success: true, result };
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    await this.aiActions.reject(ctx, id, userId);
    return { success: true };
  }
}
