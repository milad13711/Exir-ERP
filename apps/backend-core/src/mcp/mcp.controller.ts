import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Body, Controller, ForbiddenException, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { McpToolsService } from './mcp-tools.service.js';
import { AiActionService } from './ai-action.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Server-side only — read once at boot, sent as MCP's `instructions` field
 * on `initialize` (part of the protocol, meant exactly for this: guidance
 * the connecting agent should follow). Never served through any REST
 * endpoint or rendered anywhere in web-panel/admin-panel — an MCP client
 * is the only thing that ever sees it. See agent-instructions.md itself
 * for what it says and why; update that file, not this loader, as the
 * product evolves.
 */
const AGENT_INSTRUCTIONS = (() => {
  try {
    return readFileSync(join(__dirname, 'agent-instructions.md'), 'utf8');
  } catch {
    return undefined;
  }
})();

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

const PROTOCOL_VERSION = '2025-06-18';

/**
 * A minimal MCP server (Streamable HTTP transport, single JSON response per
 * request — no SSE) so a tenant's own AI agents can act on their ERP data:
 * https://modelcontextprotocol.io. Authenticates with the same `exir_live_`
 * API key as the REST API (JwtAuthGuard accepts both — see its verifyApiKey).
 * Implements the request/response subset a client needs to connect, list
 * tools, and call them: initialize, tools/list, tools/call, ping.
 * Resources and prompts aren't implemented — this exposes actions
 * (MCP_TOOLS), not a document store.
 *
 * A CREATE/UPDATE/DELETE tool never runs on the agent's own turn — see
 * AiActionService — it only files a pending request and returns
 * immediately; a human approves it later from the web panel, and only that
 * approval actually calls the tool's handler. READ tools are unaffected
 * and still run immediately, same as before.
 */
@Controller('mcp')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('mcp')
export class McpController {
  constructor(
    private readonly toolsService: McpToolsService,
    private readonly aiActions: AiActionService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Body() body: JsonRpcRequest, @Ctx() ctx: TenantRequestContext) {
    // ابزارهای MCP مستقیم روی همه‌ی داده‌ی مستأجر (حقوق پرسنل، فاکتورها، حسابداری...) کار می‌کنند و
    // ماتریس دسترسی ماژول‌ها را اعمال نمی‌کنند؛ پس فقط مالک/مدیر (و کلید API که همان نقش را به ارث می‌برد).
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('دسترسی به MCP فقط برای مالک یا مدیر است');
    }
    // A JSON-RPC *notification* (no id) never gets a response body.
    const respond = (result: unknown) =>
      body.id === undefined || body.id === null ? {} : { jsonrpc: '2.0', id: body.id, result };
    const respondError = (code: number, message: string) =>
      body.id === undefined || body.id === null ? {} : { jsonrpc: '2.0', id: body.id, error: { code, message } };

    try {
      switch (body.method) {
        case 'initialize':
          return respond({
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'exir-erp', version: '1.0.0' },
            ...(AGENT_INSTRUCTIONS ? { instructions: AGENT_INSTRUCTIONS } : {}),
          });

        case 'notifications/initialized':
        case 'ping':
          return respond({});

        case 'tools/list':
          return respond({
            tools: this.toolsService.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          });

        case 'tools/call': {
          const toolName = body.params?.name;
          const tool = this.toolsService.tools.find((t) => t.name === toolName);
          if (!tool) return respondError(-32602, `ابزار ناشناخته: ${String(toolName)}`);

          const args = (body.params?.arguments as Record<string, unknown>) ?? {};
          try {
            if (tool.operation === 'READ') {
              const result = await tool.handler(args, ctx);
              return respond({ content: [{ type: 'text', text: JSON.stringify(result) }] });
            }

            const { id, summary } = await this.aiActions.requestApproval(ctx, tool, args);
            return respond({
              content: [
                {
                  type: 'text',
                  text: `این اقدام نیازمند تأیید کاربر است و بلافاصله اجرا نشد: «${summary}». شناسه‌ی درخواست: ${id}. کاربر باید آن را از پنل اکسیر تأیید کند.`,
                },
              ],
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'خطای ناشناخته';
            return respond({ content: [{ type: 'text', text: `خطا: ${message}` }], isError: true });
          }
        }

        default:
          return respondError(-32601, `متد پشتیبانی‌نشده: ${body.method}`);
      }
    } catch {
      return respondError(-32603, 'خطای داخلی سرور MCP');
    }
  }
}
