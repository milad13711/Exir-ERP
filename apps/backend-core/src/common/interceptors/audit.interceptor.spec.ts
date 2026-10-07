import { describe, expect, it, vi } from 'vitest';
import { of, throwError, lastValueFrom } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor.js';
import { ActivityLogService } from '../../activity/activity-log.service.js';
import { currentActor } from '../../activity/activity-context.js';

const ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

function setup(opts: { method: string; route: string; path?: string; withCtx?: boolean; response?: unknown; fail?: boolean; requireModule?: string; db?: Record<string, unknown> }) {
  const createMany = vi.fn().mockResolvedValue({ count: 1 });
  const db = opts.db ?? {
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1', globalUserId: 'g1' }]) },
    activityLog: { createMany, findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  };
  const service = new ActivityLogService();
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(opts.requireModule) } as never;
  const interceptor = new AuditInterceptor(service, reflector);
  const req = {
    method: opts.method,
    path: opts.path ?? opts.route,
    route: { path: opts.route },
    ip: '203.0.113.77',
    body: { password: 'hunter2', token: 'secret-token' },
    ctx: opts.withCtx === false ? undefined : { auth: { sub: 'g1', type: 'tenant_user', role: 'STAFF' }, tenantId: 't1', tenantDb: db },
  };
  const context = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null } as never;
  const handler = { handle: () => (opts.fail ? throwError(() => new Error('boom')) : of(opts.response ?? { ok: true })) };
  return { interceptor, service, context, handler, createMany, db };
}

async function run(opts: Parameters<typeof setup>[0]) {
  const s = setup(opts);
  await lastValueFrom(s.interceptor.intercept(s.context, s.handler)).catch(() => undefined);
  await s.service.flush();
  return s;
}

describe('AuditInterceptor', () => {
  it('logs a successful mutation with module, action, summary, entity id, masked ip and the resolved user', async () => {
    const { createMany } = await run({ method: 'POST', route: '/api/sales/invoices', response: { id: ID, number: 5 } });
    expect(createMany).toHaveBeenCalledTimes(1);
    const [row] = createMany.mock.calls[0][0].data;
    expect(row).toMatchObject({ userId: 'u1', actorType: 'MANUAL', moduleCode: 'sales', actionType: 'create', action: 'sales.invoices.created', entityId: ID, summary: 'ایجاد فاکتور فروش', ip: '203.0.113.x' });
  });

  it('uses @RequireModule metadata as module code and labels action-style POSTs', async () => {
    const { createMany } = await run({ method: 'POST', route: '/api/accounting/entries/:id/void', path: `/api/accounting/entries/${ID}/void`, requireModule: 'accounting' });
    const [row] = createMany.mock.calls[0][0].data;
    expect(row).toMatchObject({ moduleCode: 'accounting', actionType: 'cancel', action: 'accounting.entries.voided', entityId: ID });
  });

  it('logs deletes with the record id from the route param', async () => {
    const { createMany } = await run({ method: 'DELETE', route: '/api/crm/contacts/:id', path: `/api/crm/contacts/${ID}` });
    expect(createMany.mock.calls[0][0].data[0]).toMatchObject({ action: 'crm.contacts.deleted', actionType: 'delete', entityId: ID });
  });

  it('skips GET reads, auth, public, notifications, heartbeat and the logs endpoints themselves', async () => {
    for (const [method, route] of [
      ['GET', '/api/crm/contacts'],
      ['POST', '/api/auth/otp/request'],
      ['POST', '/api/public/booking/x/appointments'],
      ['POST', '/api/notifications/:id/read'],
      ['PUT', '/api/logs/daily-reports/settings'],
      ['POST', '/api/tasks/heartbeat'],
      ['POST', '/api/me/push/subscribe'],
    ]) {
      const { createMany } = await run({ method, route });
      expect(createMany, `${method} ${route}`).not.toHaveBeenCalled();
    }
  });

  it('skips unauthenticated requests and failed requests', async () => {
    expect((await run({ method: 'POST', route: '/api/crm/contacts', withCtx: false })).createMany).not.toHaveBeenCalled();
    expect((await run({ method: 'POST', route: '/api/crm/contacts', fail: true })).createMany).not.toHaveBeenCalled();
  });

  it('never stores request bodies, secrets or the raw path/token', async () => {
    const { createMany } = await run({ method: 'POST', route: '/api/crm/contacts/:token/send', path: '/api/crm/contacts/SECRET-TOKEN-123/send' });
    const row = createMany.mock.calls[0][0].data[0];
    const json = JSON.stringify(row);
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('secret-token');
    expect(json).not.toContain('SECRET-TOKEN-123');
    expect(row.entityId).toBeNull();
  });

  it('is fail-safe: a database error while writing never breaks the request', async () => {
    const db = { user: { findMany: vi.fn().mockRejectedValue(new Error('db down')) }, activityLog: { createMany: vi.fn().mockRejectedValue(new Error('db down')), findMany: vi.fn().mockRejectedValue(new Error('x')), create: vi.fn() } };
    const s = setup({ method: 'POST', route: '/api/crm/contacts', db });
    await expect(lastValueFrom(s.interceptor.intercept(s.context, s.handler))).resolves.toEqual({ ok: true });
    await expect(s.service.flush()).resolves.toBeUndefined();
  });

  it('drops a row when an explicit module log for the same user+entity already exists (no duplicates)', async () => {
    const db = {
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1', globalUserId: 'g1' }]) },
      activityLog: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([{ userId: 'u1', entityId: ID, metadata: null }]), create: vi.fn() },
    };
    await run({ method: 'POST', route: '/api/crm/deals', response: { id: ID }, db });
    expect(db.activityLog.createMany).not.toHaveBeenCalled();
  });

  it('exposes the acting user to code running inside the request (SMS attribution)', async () => {
    let seen: ReturnType<typeof currentActor>;
    const s = setup({ method: 'POST', route: '/api/sales/invoices/:id/send-sms' });
    const handler = { handle: () => { seen = currentActor(); return of(1); } };
    await lastValueFrom(s.interceptor.intercept(s.context, handler as never));
    expect(seen).toMatchObject({ actorType: 'MANUAL', globalUserId: 'g1', tenantId: 't1' });
  });
});
