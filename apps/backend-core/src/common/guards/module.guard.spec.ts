import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { ModuleGuard } from './module.guard.js';

type ModuleRow = { id: string; code: string; name: string; isCore: boolean; dependsOn: string[] };
type InstallRow = { moduleId: string; status: 'INSTALLED' | 'TRIAL' | 'DISABLED' };

function makeControlDb(modules: ModuleRow[], installs: InstallRow[]) {
  return {
    moduleDefinition: { findMany: vi.fn().mockResolvedValue(modules) },
    tenantModule: { findMany: vi.fn().mockResolvedValue(installs) },
  };
}

function makeContext(tenantId: string | undefined): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ ctx: tenantId ? { tenantId } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

function makeReflector(moduleCode: string | undefined) {
  return { getAllAndOverride: vi.fn().mockReturnValue(moduleCode) } as never;
}

const CRM: ModuleRow = { id: 'm-crm', code: 'crm', name: 'CRM', isCore: false, dependsOn: [] };
const ACCOUNTING: ModuleRow = { id: 'm-acc', code: 'accounting', name: 'حسابداری', isCore: false, dependsOn: [] };
const SALES: ModuleRow = { id: 'm-sales', code: 'sales', name: 'فروش', isCore: false, dependsOn: ['crm', 'accounting'] };
const CHECKS: ModuleRow = { id: 'm-checks', code: 'checks', name: 'چک‌ها', isCore: false, dependsOn: ['crm', 'sales'] };
const TASKS: ModuleRow = { id: 'm-tasks', code: 'tasks', name: 'وظایف', isCore: true, dependsOn: [] };

describe('ModuleGuard', () => {
  let guard: (modules: ModuleRow[], installs: InstallRow[], moduleCode: string | undefined) => ModuleGuard;

  beforeEach(() => {
    guard = (modules, installs, moduleCode) =>
      new ModuleGuard(makeReflector(moduleCode), makeControlDb(modules, installs) as never);
  });

  it('allows the request through when no @RequireModule decorator is present', async () => {
    const g = guard([], [], undefined);
    await expect(g.canActivate(makeContext('t1'))).resolves.toBe(true);
  });

  it('allows a core module with no TenantModule row at all (default-on)', async () => {
    const g = guard([TASKS], [], 'tasks');
    await expect(g.canActivate(makeContext('t1'))).resolves.toBe(true);
  });

  it('blocks a core module once explicitly DISABLED — the exact bug fixed this session: isCore must not short-circuit before checking an existing row', async () => {
    const g = guard([TASKS], [{ moduleId: TASKS.id, status: 'DISABLED' }], 'tasks');
    await expect(g.canActivate(makeContext('t1'))).rejects.toThrow(ForbiddenException);
  });

  it('blocks a paid module with no TenantModule row (default-off)', async () => {
    const g = guard([CRM], [], 'crm');
    await expect(g.canActivate(makeContext('t1'))).rejects.toThrow(ForbiddenException);
  });

  it('allows a paid module with an INSTALLED row', async () => {
    const g = guard([CRM], [{ moduleId: CRM.id, status: 'INSTALLED' }], 'crm');
    await expect(g.canActivate(makeContext('t1'))).resolves.toBe(true);
  });

  it('allows a TRIAL install the same as INSTALLED', async () => {
    const g = guard([CRM], [{ moduleId: CRM.id, status: 'TRIAL' }], 'crm');
    await expect(g.canActivate(makeContext('t1'))).resolves.toBe(true);
  });

  it('walks dependsOn transitively — requesting checks also requires sales AND (via sales) accounting/crm', async () => {
    const modules = [CRM, ACCOUNTING, SALES, CHECKS];
    const allInstalled: InstallRow[] = modules.map((m) => ({ moduleId: m.id, status: 'INSTALLED' }));

    // Every dependency installed → allowed.
    await expect(
      guard(modules, allInstalled, 'checks').canActivate(makeContext('t1')),
    ).resolves.toBe(true);

    // Remove accounting (two hops down: checks -> sales -> accounting) — must still block.
    const withoutAccounting = allInstalled.filter((i) => i.moduleId !== ACCOUNTING.id);
    await expect(
      guard(modules, withoutAccounting, 'checks').canActivate(makeContext('t1')),
    ).rejects.toThrow(ForbiddenException);
  });

  it('skips the guard when the request has no tenant context (route not tenant-scoped, or JwtAuthGuard has not run yet)', async () => {
    const g = guard([CRM], [], 'crm');
    await expect(g.canActivate(makeContext(undefined))).resolves.toBe(true);
  });

  it('does not block on an unknown module code — a stale/removed @RequireModule should not brick a route', async () => {
    const g = guard([], [], 'nonexistent-module');
    await expect(g.canActivate(makeContext('t1'))).resolves.toBe(true);
  });
});
