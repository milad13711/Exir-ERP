import { describe, expect, it, vi } from 'vitest';
import { DashboardLayoutService } from './dashboard-layout.service.js';

function make(role: 'OWNER' | 'ADMIN' | 'MEMBER', opts: { stored?: Array<{ scope: string; ownerKey: string; layout: unknown }>; acl?: unknown } = {}) {
  const controlDb = {
    moduleDefinition: {
      findMany: vi.fn(async () => [
        { id: 'a', code: 'accounting', isCore: true, dependsOn: [] },
        { id: 's', code: 'sales', isCore: false, dependsOn: ['accounting'] },
        { id: 't', code: 'tasks', isCore: true, dependsOn: [] },
        { id: 'p', code: 'projects', isCore: false, dependsOn: [] },
      ]),
    },
    tenantModule: { findMany: vi.fn(async () => [{ moduleId: 's', status: 'INSTALLED' }, { moduleId: 't', status: 'DISABLED' }]) },
  };
  const permissions = { effectiveMatrix: vi.fn(async () => opts.acl ?? { manager: role !== 'MEMBER', modules: {} }) };
  const upsert = vi.fn(async () => ({}));
  const tenantDb = {
    user: { findUnique: vi.fn(async () => ({ id: 'u1' })) },
    dashboardLayout: { findMany: vi.fn(async () => opts.stored ?? []), upsert, deleteMany: vi.fn(async () => ({})) },
  };
  const ctx = { tenantId: 't1', tenantDb, auth: { type: 'user', sub: 'g1', role } } as never;
  return { svc: new DashboardLayoutService(controlDb as never, permissions as never), ctx, upsert };
}

describe('DashboardLayoutService', () => {
  it('installedModules follows ModuleGuard semantics (explicit row wins, isCore default, deps)', async () => {
    const { svc } = make('OWNER');
    const set = await svc.installedModules('t1');
    expect([...set].sort()).toEqual(['accounting', 'sales']); // tasks disabled explicitly, projects not core/not installed
  });

  it('company layout writes are manager-only', async () => {
    const { svc, ctx, upsert } = make('MEMBER');
    await expect(svc.saveCompany(ctx, { items: [] })).rejects.toThrow();
    await expect(svc.companyConfig(ctx)).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('resolveForUser returns only permitted widgets and flags manager capability', async () => {
    const acl = { manager: false, modules: { sales: { canViewAll: false, canViewOwn: true } } };
    const { svc, ctx } = make('MEMBER', { acl });
    const r = await svc.resolveForUser(ctx);
    const keys = r.widgets.map((w) => w.key);
    expect(r.canConfigureCompany).toBe(false);
    expect(keys).toContain('calendar');
    expect(keys).not.toContain('due-invoices'); // sales own-only
    expect(keys).not.toContain('tasks'); // module disabled
    expect(keys).not.toContain('projects-progress'); // not installed
  });

  it('personal save rejects unknown widgets and stores valid ones for the user only', async () => {
    const { svc, ctx, upsert } = make('MEMBER');
    await expect(svc.saveMine(ctx, { items: [{ key: 'bogus', hidden: true }] })).rejects.toThrow();
    await svc.saveMine(ctx, { items: [{ key: 'calendar', hidden: true }] });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { scope_ownerKey: { scope: 'USER', ownerKey: 'u1' } } }));
  });
});
