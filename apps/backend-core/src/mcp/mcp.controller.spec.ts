import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { McpController } from './mcp.controller.js';

describe('McpController access', () => {
  const tools = { tools: [] } as any;
  const c = new McpController(tools, {} as any);

  it('rejects regular (non-manager) users — MCP tools bypass the module access matrix', async () => {
    await expect(c.handle({ jsonrpc: '2.0', id: 1, method: 'ping' }, { auth: { role: 'MEMBER' } } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows OWNER/ADMIN (and API keys, which inherit that role)', async () => {
    const res = (await c.handle({ jsonrpc: '2.0', id: 1, method: 'ping' }, { auth: { role: 'ADMIN' } } as any)) as any;
    expect(res.result).toEqual({});
    void vi;
  });
});
