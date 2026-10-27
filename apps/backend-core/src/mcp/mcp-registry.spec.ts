import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { buildAllMcpTools } from './mcp-registry.js';
import { McpController } from './mcp.controller.js';
import { McpToolsService } from './mcp-tools.service.js';
import { validateAgainstSchema, validateToolArgs } from './mcp-validate.js';
import { agentLetterActor, maskLetterBrief } from './mcp-tools.correspondence.js';
import { letterVisibilityWhere, canSeeLetter } from '../correspondence/letter-scope.js';
import { buildScopes } from '../api-keys/api-key-scopes.js';
import type { McpTool } from './mcp-tool.types.js';

const here = dirname(fileURLToPath(import.meta.url));
const stub = new Proxy({}, { get: () => vi.fn() }) as never;
const tools: McpTool[] = buildAllMcpTools(new Proxy({}, { get: () => stub }) as never);
const seed = readFileSync(join(here, '../../prisma/control/seed.ts'), 'utf8');
const seededCodes = new Set([...seed.matchAll(/^\s+code: '([a-z0-9-]+)',/gm)].map((m) => m[1]));
const PERSIAN = /[؀-ۿ]/;

/** نمونه‌ی ورودی معتبر حداقلی که از خود JSON Schema ساخته می‌شود. */
function sample(schema: any): unknown {
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'string':
      if (schema.format === 'date') return '2026-10-24';
      if (schema.format === 'date-time') return '2026-10-24T10:00:00.000Z';
      if (schema.pattern === '^\\d{1,2}:\\d{2}$') return '09:30';
      return 'x'.repeat(Math.max(schema.minLength ?? 1, 2));
    case 'integer':
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return false;
    case 'array':
      return schema.minItems ? [sample(schema.items)] : [];
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const k of schema.required ?? []) out[k] = sample(schema.properties[k]);
      return out;
    }
    default:
      return undefined;
  }
}

describe('MCP registry parity', () => {
  it('has unique stable English names, a module, a kind and a Persian description for every tool', () => {
    const names = new Set<string>();
    for (const t of tools) {
      expect(t.name, t.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
      expect(names.has(t.name), `duplicate ${t.name}`).toBe(false);
      names.add(t.name);
      expect(t.module, t.name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(['read', 'write']).toContain(t.kind);
      expect(PERSIAN.test(t.description), `${t.name} description must be Persian`).toBe(true);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe('object');
      // kind و operation هم‌جهت‌اند؛ هر ابزار write یک summarize فارسی دارد
      expect(t.kind === 'read').toBe(t.operation === 'READ');
      if (t.kind === 'write') {
        expect(t.summarize, t.name).toBeTypeOf('function');
        expect(PERSIAN.test(t.summarize!(sample(t.inputSchema) as never)), `${t.name} summary Persian`).toBe(true);
      }
    }
  });

  it('every tool module is a real seeded module code (or the known core "dashboard")', () => {
    for (const t of tools) expect(seededCodes.has(t.module) || t.module === 'dashboard', `${t.name} → ${t.module}`).toBe(true);
  });

  it('includes the expected new tools with the right kind', () => {
    const kinds = Object.fromEntries(tools.map((t) => [t.name, `${t.module}:${t.kind}`]));
    expect(kinds).toMatchObject({
      search_tasks: 'tasks:read',
      get_task: 'tasks:read',
      create_task: 'tasks:write',
      add_task_comment: 'tasks:write',
      reassign_task: 'tasks:write',
      search_letters: 'correspondence:read',
      get_letter: 'correspondence:read',
      list_pending_letter_actions: 'correspondence:read',
      create_letter_draft: 'correspondence:write',
      register_incoming_letter: 'correspondence:write',
      search_shipments: 'dispatch:read',
      get_shipment: 'dispatch:read',
      declare_shipment: 'dispatch:write',
      get_operations_overview: 'operations:read',
      list_free_slots: 'booking:read',
      list_appointments: 'booking:read',
      create_appointment: 'booking:write',
      update_funnel_stage: 'crm:write',
      disqualify_lead: 'crm:write',
      convert_lead_to_customer: 'crm:write',
      get_stock_levels: 'warehouse:read',
      create_reminder: 'dashboard:write',
    });
  });

  it('is documented: every tool is in the web settings reference, and every new tool in agent-instructions.md', () => {
    const instr = readFileSync(join(here, 'agent-instructions.md'), 'utf8');
    const page = readFileSync(join(here, '../../../web-panel/src/app/(app)/settings/api/page.tsx'), 'utf8');
    const legacy = new Set(['list_crm_deals', 'create_crm_contact', 'update_crm_contact', 'create_crm_deal', 'list_sales_invoices', 'create_sales_invoice', 'list_purchase_orders', 'create_purchase_order', 'list_products', 'create_product', 'get_accounting_summary', 'create_journal_entry', 'list_employees', 'create_leave_request', 'list_tasks', 'suggest_new_module', 'list_module_suggestions']);
    for (const t of tools) {
      expect(page.includes(t.name), `page.tsx missing ${t.name}`).toBe(true);
      if (!legacy.has(t.name)) expect(instr.includes(t.name), `agent-instructions.md missing ${t.name}`).toBe(true);
    }
  });
});

describe('MCP tool input validation', () => {
  it('accepts a minimal sample built from each tool schema (schema and domain DTO agree)', () => {
    for (const t of tools) expect(() => validateToolArgs(t, sample(t.inputSchema)), t.name).not.toThrow();
  });

  it('rejects unknown fields, missing required fields and wrong types for every tool', () => {
    for (const t of tools) {
      expect(() => validateToolArgs(t, { ...(sample(t.inputSchema) as object), __unexpected: 1 }), t.name).toThrow();
      const required = (t.inputSchema.required as string[] | undefined) ?? [];
      if (required.length) expect(() => validateToolArgs(t, {}), t.name).toThrow();
      expect(() => validateToolArgs(t, 'nope' as never), t.name).toThrow();
    }
  });

  it('enforces enums, bounds and formats', () => {
    const by = (n: string) => tools.find((t) => t.name === n)!;
    expect(() => validateToolArgs(by('search_tasks'), { priority: 'HIGH' })).toThrow();
    expect(() => validateToolArgs(by('search_tasks'), { limit: 5000 })).toThrow();
    expect(() => validateToolArgs(by('list_free_slots'), { serviceTypeId: 'a', date: '1405/01/01' })).toThrow();
    expect(() => validateToolArgs(by('create_letter_draft'), { type: 'OUTGOING', subject: 'سلام', confidentiality: 'SECRET' })).toThrow();
    expect(() => validateToolArgs(by('disqualify_lead'), { contactId: 'c1', reason: 'x' })).toThrow();
    expect(() => validateToolArgs(by('declare_shipment'), { cargoType: 'x', quantity: 0, deliveryAddress: 'abc', pickupAt: '2026-10-24T10:00:00Z' })).toThrow();
    expect(() => validateToolArgs(by('declare_shipment'), { cargoType: 'x', quantity: 2, deliveryAddress: 'abc', pickupAt: '2026-10-24T10:00:00Z', sourceType: 'SALES_INVOICE' })).toThrow(); // sourceId missing
    expect(validateAgainstSchema({ type: 'object', properties: { a: { type: 'integer' } } }, { a: 1.5 })).not.toEqual([]);
  });
});

function mkController(opts: { moduleReason?: string | null; scopes?: string[] } = {}) {
  const spies = new Map<string, ReturnType<typeof vi.fn>>();
  const wrapped = tools.map((t) => {
    const h = vi.fn().mockResolvedValue({ ok: true });
    spies.set(t.name, h);
    return { ...t, handler: h };
  });
  const moduleGuard = { moduleUnavailableReason: vi.fn().mockResolvedValue(opts.moduleReason ?? null) };
  const svc = Object.create(McpToolsService.prototype) as McpToolsService & { tools: McpTool[]; moduleGuard: unknown };
  (svc as any).tools = wrapped;
  (svc as any).moduleGuard = moduleGuard;
  const aiActions = { requestApproval: vi.fn().mockResolvedValue({ id: 'req1', summary: 'خلاصه' }) };
  const controller = new McpController(svc, aiActions as never);
  const ctx = { tenantId: 't1', auth: { type: 'api_key', role: 'OWNER', scopes: opts.scopes ?? [] } } as never;
  const call = (name: string, args: unknown) => controller.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args as never } }, ctx) as Promise<any>;
  return { controller, spies, aiActions, moduleGuard, ctx, call };
}

describe('McpController — approval gate, module checks, scopes', () => {
  it('write tools NEVER execute: they only enqueue an approval request', async () => {
    const { call, spies, aiActions } = mkController();
    for (const t of tools.filter((x) => x.kind === 'write')) {
      const res = await call(t.name, sample(t.inputSchema));
      expect(res.result.isError, t.name).toBeUndefined();
      expect(res.result.content[0].text).toContain('نیازمند تأیید');
      expect(spies.get(t.name)).not.toHaveBeenCalled();
    }
    expect(aiActions.requestApproval).toHaveBeenCalledTimes(tools.filter((x) => x.kind === 'write').length);
  });

  it('read tools run immediately and never create an approval request', async () => {
    const { call, spies, aiActions } = mkController();
    const r = tools.find((t) => t.kind === 'read' && !(t.inputSchema.required as string[] | undefined)?.length)!;
    const res = await call(r.name, {});
    expect(spies.get(r.name)).toHaveBeenCalledTimes(1);
    expect(res.result.content[0].text).toBe('{"ok":true}');
    expect(aiActions.requestApproval).not.toHaveBeenCalled();
  });

  it('invalid input never reaches the approval queue', async () => {
    const { call, aiActions, spies } = mkController();
    const res = await call('create_task', { title: 'x' });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('ورودی نامعتبر');
    expect(aiActions.requestApproval).not.toHaveBeenCalled();
    expect(spies.get('create_task')).not.toHaveBeenCalled();
  });

  it('module-not-installed returns the clear Persian message and neither runs nor enqueues', async () => {
    const reason = 'ماژول «وظایف» برای این محیط کاری فعال نیست — از فروشگاه ماژول‌ها فعالش کنید یا با پشتیبانی تماس بگیرید.';
    const { call, aiActions, spies } = mkController({ moduleReason: reason });
    for (const name of ['search_tasks', 'create_task']) {
      const res = await call(name, name === 'create_task' ? { title: 'یک وظیفه' } : {});
      expect(res.result.isError).toBe(true);
      expect(res.result.content[0].text).toContain('فعال نیست');
      expect(spies.get(name)).not.toHaveBeenCalled();
    }
    expect(aiActions.requestApproval).not.toHaveBeenCalled();
  });

  it('tools/list is filtered by key scopes (read-only hides every write tool; module scope filters modules)', async () => {
    const list = async (scopes?: string[]) => {
      const { controller, ctx } = mkController({ scopes });
      const res = (await controller.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx)) as any;
      return res.result.tools as Array<{ name: string }>;
    };
    const all = await list([]); // legacy
    expect(all.length).toBe(tools.length);
    const ro = await list(buildScopes('read_only'));
    expect(ro.length).toBeGreaterThan(0);
    for (const t of ro) expect(tools.find((x) => x.name === t.name)!.kind).toBe('read');
    const prop = await list(buildScopes('read_propose', ['tasks']));
    for (const t of prop) expect(tools.find((x) => x.name === t.name)!.module).toBe('tasks');
    expect(prop.some((t) => t.name === 'create_task')).toBe(true);
    const only = await list(buildScopes('read_only', [], ['get_task']));
    expect(only.map((t) => t.name)).toEqual(['get_task']);
  });

  it('tools/call re-checks scope (defence in depth) even for a name the agent never saw in tools/list', async () => {
    const { call, spies, aiActions } = mkController({ scopes: buildScopes('read_only') });
    const res = await call('create_task', { title: 'یک وظیفه' });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('اجازه');
    expect(aiActions.requestApproval).not.toHaveBeenCalled();
    expect(spies.get('create_task')).not.toHaveBeenCalled();
    const res2 = await call('search_tasks', {});
    expect(res2.result.isError).toBeUndefined();
  });

  it('non-manager roles are rejected', async () => {
    const { controller } = mkController();
    await expect(controller.handle({ jsonrpc: '2.0', id: 1, method: 'ping' }, { auth: { role: 'MEMBER' } } as never)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Correspondence scope for agents', () => {
  const apiKeyLikeActor: any = {
    userId: null, name: 'مدیر', title: null, isOwner: true, isAdmin: false, isManager: true,
    matrix: { canViewAll: true, canViewOwn: true },
    scope: { userId: null, isOwner: true, isAdmin: false, viewAll: true, viewOwn: true },
  };

  it('even an OWNER-issued key is downgraded to ADMIN scope: no SECRET, no drafts', () => {
    const a = agentLetterActor(apiKeyLikeActor);
    expect(a.isOwner).toBe(false);
    const where = letterVisibilityWhere(a.scope);
    expect(where).toEqual({ AND: [{ confidentiality: { not: 'SECRET' } }, { status: { not: 'DRAFT' } }] });
    const facts = { createdByUserId: 'u1', ownerUserId: 'u1', signerUserId: null, confidentiality: 'SECRET', status: 'ISSUED' };
    expect(canSeeLetter(a.scope, facts, [])).toBe(false);
    expect(canSeeLetter(a.scope, { ...facts, confidentiality: 'NORMAL', status: 'DRAFT' }, [])).toBe(false);
    expect(canSeeLetter(a.scope, { ...facts, confidentiality: 'NORMAL', status: 'ISSUED' }, [])).toBe(true);
    expect(canSeeLetter(apiKeyLikeActor.scope, facts, [])).toBe(true); // sanity: raw OWNER would have seen it
  });

  it('confidential letters are masked in tool output', () => {
    const base = { id: 'l1', type: 'INCOMING', status: 'REGISTERED', letterNumber: '1405/1', subject: 'موضوع حساس', senderName: 'علی', priority: 'NORMAL' };
    expect(maskLetterBrief({ ...base, confidentiality: 'NORMAL' }).subject).toBe('موضوع حساس');
    const m = maskLetterBrief({ ...base, confidentiality: 'CONFIDENTIAL' });
    expect(m.subject).toBe('[محرمانه]');
    expect(JSON.stringify(m)).not.toContain('حساس');
    expect(JSON.stringify(m)).not.toContain('علی');
  });
});
