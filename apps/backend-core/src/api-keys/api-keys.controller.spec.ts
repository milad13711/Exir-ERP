import * as bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeysController } from './api-keys.controller.js';
import { AiActionsController } from '../mcp/ai-actions.controller.js';

function setup() {
  const rows: any[] = [];
  const controlDb = {
    apiKey: {
      create: vi.fn(async ({ data, select }: any) => {
        const row = { id: `k${rows.length + 1}`, createdAt: new Date(), lastUsedAt: null, revokedAt: null, lastUsedIp: null, useCount: 0, ...data };
        rows.push(row);
        return pick(row, select);
      }),
      findMany: vi.fn(async ({ select }: any) => rows.map((r) => pick(r, select))),
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
      update: vi.fn(async ({ where, data, select }: any) => {
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return select ? pick(r, select) : r;
      }),
    },
  };
  const c = new ApiKeysController(controlDb as never);
  const ctx: any = { tenantId: 't1', auth: { type: 'tenant_user', role: 'OWNER', sub: 'u1' }, twoFactor: undefined };
  return { c, ctx, rows, controlDb };
}
function pick(row: any, select?: Record<string, boolean>) {
  if (!select) return row;
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

describe('ApiKeysController', () => {
  it('defaults to the read-only preset (least privilege) and stores only a bcrypt hash', async () => {
    const { c, ctx, rows } = setup();
    const created = await c.create({ name: 'تست' } as never, ctx);
    expect(created.scopes).toEqual(['read']);
    expect(created.rawKey).toMatch(/^exir_live_[0-9a-f]{32}$/);
    expect(rows[0].keyHash).not.toContain(created.rawKey);
    expect(await bcrypt.compare(created.rawKey, rows[0].keyHash)).toBe(true);
  });

  it('builds scopes from preset + modules + tools + expiry + IPs, and rejects bad IPs', async () => {
    const { c, ctx } = setup();
    const k = await c.create({ name: 'کلید', preset: 'read_propose', modules: ['tasks'], tools: ['search_tasks'], expiresInDays: 30, ipAllowlist: ['10.0.0.0/24'] } as never, ctx);
    expect(k.scopes).toEqual(['read', 'propose', 'module:tasks', 'mcp:tools:search_tasks']);
    expect(k.ipAllowlist).toEqual(['10.0.0.0/24']);
    expect(k.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await expect(c.create({ name: 'بد', ipAllowlist: ['999.1.1.1'] } as never, ctx)).rejects.toThrow('نامعتبر');
  });

  it('list never exposes the secret or its hash', async () => {
    const { c, ctx } = setup();
    const k = await c.create({ name: 'کلید' } as never, ctx);
    const list = await c.list(ctx);
    const json = JSON.stringify(list);
    expect(json).not.toContain('keyHash');
    expect(json).not.toContain(k.rawKey);
    expect(json).not.toContain('rawKey');
  });

  it('rotation creates a new key with the same scopes and gives the old one a grace expiry (or revokes at 0)', async () => {
    const { c, ctx, rows } = setup();
    const old = await c.create({ name: 'کلید', preset: 'read_propose', modules: ['crm'] } as never, ctx);
    const fresh = await c.rotate(old.id, { graceHours: 2 } as never, ctx);
    expect(fresh.scopes).toEqual(old.scopes);
    expect(fresh.rotatedFromId).toBe(old.id);
    expect(fresh.rawKey).not.toBe(old.rawKey);
    const oldRow = rows.find((r) => r.id === old.id);
    expect(oldRow.revokedAt).toBeNull();
    expect(oldRow.expiresAt.getTime()).toBeLessThan(Date.now() + 3 * 3_600_000);
    const fresh2 = await c.rotate(fresh.id, { graceHours: 0 } as never, ctx);
    expect(rows.find((r) => r.id === fresh.id).revokedAt).toBeInstanceOf(Date);
    expect(fresh2.id).not.toBe(fresh.id);
  });

  it('an API key can never manage keys (no privilege escalation)', async () => {
    const { c, ctx } = setup();
    const keyCtx = { ...ctx, auth: { type: 'api_key', role: 'OWNER', sub: 'k1', scopes: ['read', 'propose', 'write'] } };
    await expect(c.create({ name: 'x' } as never, keyCtx)).rejects.toMatchObject({ status: 403 });
    await expect(c.rotate('k1', {} as never, keyCtx)).rejects.toMatchObject({ status: 403 });
    await expect(c.revoke('k1', keyCtx)).rejects.toMatchObject({ status: 403 });
  });
});

describe('AiActionsController — the approval gate cannot be self-approved', () => {
  it('rejects approve/reject made with an API key', async () => {
    const svc = { approve: vi.fn(), reject: vi.fn() };
    const c = new AiActionsController(svc as never, { tools: [] } as never);
    const keyCtx: any = { auth: { type: 'api_key', role: 'OWNER', sub: 'k1' } };
    await expect(c.approve('r1', keyCtx)).rejects.toMatchObject({ status: 403 });
    await expect(c.reject('r1', keyCtx)).rejects.toMatchObject({ status: 403 });
    expect(svc.approve).not.toHaveBeenCalled();
    expect(svc.reject).not.toHaveBeenCalled();
  });
});
