import { describe, expect, it, vi } from 'vitest';
import { AiActionService } from './ai-action.service.js';

function makeDb(initial: Array<Record<string, any>> = []) {
  const rows = new Map<string, any>(initial.map((r) => [r.id, { status: 'PENDING', toolName: 't', arguments: {}, requestedByKeyId: null, createdAt: new Date(), ...r }]));
  let seq = 0;
  const db = {
    aiActionRequest: {
      findUnique: vi.fn(async ({ where }: any) => rows.get(where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const r = rows.get(where.id);
        if (!r || (where.status && r.status !== where.status)) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(rows.get(where.id), data)),
      count: vi.fn(async ({ where }: any) => [...rows.values()].filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)).length),
      create: vi.fn(async ({ data }: any) => {
        const r = { id: `n${++seq}`, status: 'PENDING', createdAt: new Date(), ...data };
        rows.set(r.id, r);
        return r;
      }),
      findMany: vi.fn(async ({ where, take, cursor, skip }: any) => {
        let all = [...rows.values()].filter((r) => !where?.status || r.status === where.status).sort((a, b) => b.id.localeCompare(a.id));
        if (cursor) all = all.slice(all.findIndex((r) => r.id === cursor.id) + (skip ?? 0));
        return all.slice(0, take);
      }),
    },
  };
  return { db, rows };
}

function makeSvc() {
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const gateway = { notifyPending: vi.fn(), notifyResolved: vi.fn() };
  const controlDb = { tenantMembership: { findMany: vi.fn().mockResolvedValue([]) } };
  const svc = new AiActionService(controlDb as never, notifications as never, gateway as never);
  vi.spyOn(svc as any, 'notifyResolved').mockResolvedValue(undefined);
  return { svc, notifications };
}
const tool = (handler: any) => ({ name: 't', operation: 'CREATE', summarize: () => 'خلاصه', handler }) as never;

describe('AiActionService.approve — atomic claim', () => {
  it('two concurrent approvals: handler runs exactly once, loser gets a clear error', async () => {
    const { db, rows } = makeDb([{ id: 'r1' }]);
    const { svc } = makeSvc();
    const handler = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { ok: 1 };
    });
    const ctx: any = { tenantDb: db, tenantId: 't' };
    const results = await Promise.allSettled([svc.approve(ctx, 'r1', 'u1', [tool(handler)]), svc.approve(ctx, 'r1', 'u2', [tool(handler)])]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(rows.get('r1').status).toBe('EXECUTED');
  });

  it('handler failure → FAILED with reason (never back to PENDING) and cannot be approved again', async () => {
    const { db, rows } = makeDb([{ id: 'r1' }]);
    const { svc } = makeSvc();
    const handler = vi.fn().mockRejectedValue(new Error('نامه‌ی تکراری'));
    const ctx: any = { tenantDb: db, tenantId: 't' };
    await expect(svc.approve(ctx, 'r1', 'u1', [tool(handler)])).rejects.toThrow('نامه‌ی تکراری');
    expect(rows.get('r1').status).toBe('FAILED');
    expect(rows.get('r1').error).toContain('نامه‌ی تکراری');
    await expect(svc.approve(ctx, 'r1', 'u1', [tool(handler)])).rejects.toThrow('قبلاً بررسی');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('AiActionService.requestApproval — flood protection', () => {
  const keyCtx = (db: any): any => ({ tenantDb: db, tenantId: 't', auth: { type: 'api_key', sub: 'k1' } });

  it('caps pending requests per key per tool (20) and sends one aggregated notification', async () => {
    const { db } = makeDb();
    const { svc, notifications } = makeSvc();
    const managerSpy = vi.spyOn(await import('../common/manager-users.js'), 'getManagerUsers').mockResolvedValue([{ tenantUserId: 'm1', name: 'م', phone: '', email: null }]);
    for (let i = 0; i < 20; i++) await svc.requestApproval(keyCtx(db), tool(vi.fn()), {});
    await expect(svc.requestApproval(keyCtx(db), tool(vi.fn()), {})).rejects.toThrow('سقف');
    // اعلان فقط برای اولین و بیستمی (۱۰ در پی هر ده) — نه ۲۰ بار
    expect(notifications.notify.mock.calls.length).toBeLessThan(5);
    managerSpy.mockRestore();
  });

  it('a different key is not affected by another key hitting its cap', async () => {
    const { db } = makeDb();
    const { svc } = makeSvc();
    const spy = vi.spyOn(await import('../common/manager-users.js'), 'getManagerUsers').mockResolvedValue([]);
    for (let i = 0; i < 20; i++) await svc.requestApproval(keyCtx(db), tool(vi.fn()), {});
    const other: any = { tenantDb: db, tenantId: 't', auth: { type: 'api_key', sub: 'k2' } };
    await expect(svc.requestApproval(other, tool(vi.fn()), {})).resolves.toMatchObject({ id: expect.any(String) });
    spy.mockRestore();
  });
});

describe('AiActionService.list — status filter + pagination', () => {
  it('real PENDING requests are not hidden by many finished ones', async () => {
    const rowsIn = [
      ...Array.from({ length: 150 }, (_, i) => ({ id: `e${String(i).padStart(3, '0')}`, status: 'EXECUTED' })),
      { id: 'a000', status: 'PENDING' },
    ];
    const { db } = makeDb(rowsIn);
    const { svc } = makeSvc();
    const ctx: any = { tenantDb: db };
    const pend = await svc.list(ctx, { status: 'PENDING' });
    expect(pend.items.map((x: any) => x.id)).toEqual(['a000']);
    const page1 = await svc.list(ctx, { limit: 100 });
    expect(page1.items).toHaveLength(100);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await svc.list(ctx, { limit: 100, cursor: page1.nextCursor! });
    expect(page2.items.length).toBe(51);
    expect(page2.nextCursor).toBeNull();
  });
});
