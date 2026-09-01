import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { MCP_TOOLS } from './mcp-tools.js';

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
 */
@Controller('mcp')
@UseGuards(JwtAuthGuard)
export class McpController {
  @Post()
  @HttpCode(200)
  async handle(@Body() body: JsonRpcRequest, @Ctx() ctx: TenantRequestContext) {
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
          });

        case 'notifications/initialized':
        case 'ping':
          return respond({});

        case 'tools/list':
          return respond({
            tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          });

        case 'tools/call': {
          const toolName = body.params?.name;
          const tool = MCP_TOOLS.find((t) => t.name === toolName);
          if (!tool) return respondError(-32602, `ابزار ناشناخته: ${String(toolName)}`);

          const args = (body.params?.arguments as Record<string, unknown>) ?? {};
          try {
            const result = await tool.handler(args, ctx);
            return respond({ content: [{ type: 'text', text: JSON.stringify(result) }] });
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
