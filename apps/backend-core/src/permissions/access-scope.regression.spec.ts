import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PermissionsService } from './permissions.service.js';
import { contractScope, projectScope } from './entity-scopes.js';
import { reportEditScope, reportScope } from '../reports/report-scope.js';
import { getSubordinateUserIds } from '../hr/org-chain.util.js';
import type { TenantRequestContext } from '../common/request-context.js';

/**
 * Regression suite for "مشاهده‌ی همه / فقط خودم" (docs/security/access-scope-audit-2026-10.md):
 * null-user scopes, multi-role union, per-user override, reports hierarchy, projects scope.
 */

type Emp = { id: string; userId: string | null; managerId: string | null; departmentId?: string | null };

function makeDb(opts: { employees?: Emp[]; departments?: Array<{ id: string; managerId: string | null }>; rows?: Array<Record<string, unknown>>; override?: Record<string, unknown> | null; noUser?: boolean }) {
  const employees = opts.employees ?? [];
  const departments = opts.departments ?? [];
  return {
    user: { findUnique: vi.fn(async () => (opts.noUser ? null : { id: 'me' })) },
    modulePermission: { findMany: vi.fn(async () => opts.rows ?? []) },
    userModulePermission: { findUnique: vi.fn(async () => opts.override ?? null) },
    employee: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; userId?: string } }) =>
        employees.find((e) => (where.id ? e.id === where.id : e.userId === where.userId)) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: { managerId?: { in: string[] }; id?: { in: string[] }; userId?: unknown } }) => {
        if (where.managerId) return employees.filter((e) => e.managerId && where.managerId!.in.includes(e.managerId)).map((e) => ({ id: e.id }));
        if (where.id) return employees.filter((e) => where.id!.in.includes(e.id) && e.userId).map((e) => ({ userId: e.userId }));
        return [];
      }),
    },
    department: {
      findMany: vi.fn(async ({ where }: { where: { managerId: string } }) =>
        departments
          .filter((d) => d.managerId === where.managerId)
          .map((d) => ({ employees: employees.filter((e) => e.departmentId === d.id).map((e) => ({ id: e.id })) })),
      ),
    },
  };
}

function ctxOf(db: ReturnType<typeof makeDb>, role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'MEMBER', type: 'tenant_user' | 'api_key' = 'tenant_user'): TenantRequestContext {
  return { tenantDb: db, auth: { type, sub: 'g1', role }, tenantId: 't1' } as unknown as TenantRequestContext;
}

const row = (moduleCode: string, p: Partial<Record<'canViewAll' | 'canViewOwn' | 'canCreate' | 'canEdit' | 'canDelete', boolean>>) => ({
  moduleCode,
  canViewAll: false,
  canViewOwn: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  ...p,
});

const svc = new PermissionsService();

describe('viewScope / entity scopes never match ownerless rows', () => {
  it('viewScope: view-own with no tenant user id (non-admin API key) is forbidden, never {owner: null}', async () => {
    const db = makeDb({ rows: [row('crm', { canViewOwn: true })] });
    const ctx = ctxOf(db, 'MEMBER', 'api_key');
    await expect(svc.viewScope(ctx, 'crm', 'ownerUserId')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('viewScope: view-own returns the caller id; view-all returns {}', async () => {
    const own = ctxOf(makeDb({ rows: [row('crm', { canViewOwn: true })] }));
    await expect(svc.viewScope(own, 'crm', 'ownerUserId')).resolves.toEqual({ ownerUserId: 'me' });
    const all = ctxOf(makeDb({ rows: [row('crm', { canViewAll: true })] }));
    await expect(svc.viewScope(all, 'crm', 'ownerUserId')).resolves.toEqual({});
  });

  it('projectScope / contractScope: null user is forbidden', async () => {
    const db = makeDb({ rows: [row('projects', { canViewOwn: true }), row('contracts', { canViewOwn: true })] });
    const ctx = ctxOf(db, 'MEMBER', 'api_key');
    await expect(projectScope(svc, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(contractScope(svc, ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('projects scope', () => {
  it('view-own = manager | creator | member | responsible of a stage (and nothing else)', async () => {
    const ctx = ctxOf(makeDb({ rows: [row('projects', { canViewOwn: true })] }));
    const scope = (await projectScope(svc, ctx)) as { OR: Array<Record<string, unknown>> };
    expect(scope.OR).toEqual([
      { managerUserId: 'me' },
      { createdByUserId: 'me' },
      { members: { some: { userId: 'me' } } },
      { stages: { some: { responsibleUserId: 'me' } } },
    ]);
  });

  it('view-all is unscoped; no view rights is forbidden', async () => {
    await expect(projectScope(svc, ctxOf(makeDb({ rows: [row('projects', { canViewAll: true })] })))).resolves.toEqual({});
    await expect(projectScope(svc, ctxOf(makeDb({ rows: [] })))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('multi-role union and user override', () => {
  it('union: one role granting view-all wins over another role granting only view-own', async () => {
    const m = await svc.getEffective(ctxOf(makeDb({ rows: [row('reports', { canViewOwn: true }), row('reports', { canViewAll: true })] })), 'reports');
    expect(m.canViewAll).toBe(true);
  });

  it('union of view-own roles never produces view-all', async () => {
    const m = await svc.getEffective(ctxOf(makeDb({ rows: [row('projects', { canViewOwn: true }), row('projects', { canViewOwn: true, canEdit: true })] })), 'projects');
    expect(m.canViewAll).toBe(false);
    expect(m.canEdit).toBe(true);
  });

  it('a per-user override REPLACES the role union (it can downgrade view-all to view-own)', async () => {
    const db = makeDb({ rows: [row('projects', { canViewAll: true })], override: row('projects', { canViewOwn: true }) });
    const m = await svc.getEffective(ctxOf(db), 'projects');
    expect(m).toMatchObject({ canViewAll: false, canViewOwn: true });
    expect(db.modulePermission.findMany).not.toHaveBeenCalled();
  });

  it('effectiveMatrix applies the override per module and keeps other modules from roles', async () => {
    const db = {
      ...makeDb({ rows: [row('projects', { canViewAll: true }), row('crm', { canViewOwn: true })] }),
      userModulePermission: { findMany: vi.fn(async () => [row('projects', { canViewOwn: true })]), findUnique: vi.fn() },
    };
    const em = await svc.effectiveMatrix(ctxOf(db as never));
    expect(em.modules.projects.canViewAll).toBe(false);
    expect(em.modules.crm.canViewOwn).toBe(true);
  });

  it('a user without a tenant user row is denied (error, never a grant)', async () => {
    await expect(svc.getEffective(ctxOf(makeDb({ noUser: true, rows: [row('projects', { canViewAll: true })] })), 'projects')).rejects.toThrow();
  });
});

// CEO(u-ceo) -> Manager(u-mgr) -> Staff(u-staff), Staff2(u-staff2); Peer manager(u-peer) under CEO; Unlinked employee without user.
const ORG: Emp[] = [
  { id: 'e-ceo', userId: 'u-ceo', managerId: null },
  { id: 'e-mgr', userId: 'u-mgr', managerId: 'e-ceo' },
  { id: 'e-staff', userId: 'u-staff', managerId: 'e-mgr' },
  { id: 'e-staff2', userId: 'u-staff2', managerId: 'e-mgr' },
  { id: 'e-peer', userId: 'u-peer', managerId: 'e-ceo' },
  { id: 'e-noacct', userId: null, managerId: 'e-mgr' },
];

describe('getSubordinateUserIds', () => {
  const subs = (userId: string, extra: Partial<Parameters<typeof makeDb>[0]> = {}) => getSubordinateUserIds(makeDb({ employees: ORG, ...extra }) as never, userId);

  it('returns all generations below, never self / boss / peers', async () => {
    expect((await subs('u-ceo')).sort()).toEqual(['u-mgr', 'u-peer', 'u-staff', 'u-staff2']);
    expect((await subs('u-mgr')).sort()).toEqual(['u-staff', 'u-staff2']);
    expect(await subs('u-staff')).toEqual([]);
  });

  it('user without an Employee record has no subordinates', async () => {
    expect(await subs('u-ghost')).toEqual([]);
  });

  it('a department headed by a subordinate can never reveal the boss (ancestor exclusion)', async () => {
    // staff heads a department that (oddly) contains the manager and CEO
    const employees: Emp[] = ORG.map((e) => (e.id === 'e-mgr' || e.id === 'e-ceo' ? { ...e, departmentId: 'd1' } : e));
    const got = await subs('u-staff', { employees, departments: [{ id: 'd1', managerId: 'e-staff' }] });
    expect(got).not.toContain('u-mgr');
    expect(got).not.toContain('u-ceo');
  });
});

describe('reports hierarchy scope', () => {
  const ctxFor = (rows: Array<Record<string, unknown>>, userEmpId?: string) => {
    const db = makeDb({ employees: ORG, rows });
    // map tenant user id 'me' to the chosen org user
    const emp = ORG.find((e) => e.id === userEmpId);
    (db.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: emp?.userId ?? 'me' });
    return ctxOf(db);
  };

  it('OWNER/ADMIN: unscoped', async () => {
    const ctx = ctxOf(makeDb({}), 'ADMIN');
    await expect(reportScope(svc, ctx)).resolves.toEqual({});
    await expect(reportEditScope(svc, ctx)).resolves.toEqual({});
  });

  it('no reports permission: forbidden', async () => {
    await expect(reportScope(svc, ctxFor([], 'e-staff'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('non-admin API key (no tenant user): forbidden', async () => {
    const db = makeDb({ rows: [row('reports', { canViewAll: true })] });
    await expect(reportScope(svc, ctxOf(db, 'MEMBER', 'api_key'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('view-own staff: only own authored + referred-to-me + knowledge; no ownerless, no subordinates', async () => {
    const scope = (await reportScope(svc, ctxFor([row('reports', { canViewOwn: true })], 'e-mgr'))) as { OR: Array<Record<string, unknown>> };
    expect(scope.OR).toEqual([
      { createdByUserId: { in: ['u-mgr'] } },
      { referrals: { some: { toUserId: 'u-mgr' } } },
      { isKnowledge: true },
    ]);
  });

  it('view-all manager: self + subtree (not boss/peer) + ownerless', async () => {
    const scope = (await reportScope(svc, ctxFor([row('reports', { canViewAll: true })], 'e-mgr'))) as { OR: Array<Record<string, any>> };
    const authors = scope.OR[0].createdByUserId.in as string[];
    expect(authors.sort()).toEqual(['u-mgr', 'u-staff', 'u-staff2']);
    expect(authors).not.toContain('u-ceo');
    expect(authors).not.toContain('u-peer');
    expect(scope.OR).toContainEqual({ createdByUserId: null });
  });

  it('view-all STAFF (leaf): sees only their own reports, never the manager above', async () => {
    const scope = (await reportScope(svc, ctxFor([row('reports', { canViewAll: true })], 'e-staff'))) as { OR: Array<Record<string, any>> };
    expect(scope.OR[0].createdByUserId.in).toEqual(['u-staff']);
  });

  it('view-all user not linked to an Employee falls back to own reports only', async () => {
    const scope = (await reportScope(svc, ctxFor([row('reports', { canViewAll: true })]))) as { OR: Array<Record<string, any>> };
    expect(scope.OR[0].createdByUserId.in).toEqual(['me']);
  });

  it('edit scope: authors only (self for view-own, self+subtree for view-all); recipients/knowledge cannot edit', async () => {
    expect(await reportEditScope(svc, ctxFor([row('reports', { canViewOwn: true })], 'e-mgr'))).toEqual({ createdByUserId: { in: ['u-mgr'] } });
    const all = (await reportEditScope(svc, ctxFor([row('reports', { canViewAll: true })], 'e-mgr'))) as { createdByUserId: { in: string[] } };
    expect(all.createdByUserId.in.sort()).toEqual(['u-mgr', 'u-staff', 'u-staff2']);
  });
});
