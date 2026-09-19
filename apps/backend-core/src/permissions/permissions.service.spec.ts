import { describe, expect, it, vi } from 'vitest';
import { PermissionsService } from './permissions.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

function makeCtx(opts: {
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  permissionRows?: Array<Record<string, unknown>>;
  userExists?: boolean;
  override?: Record<string, unknown> | null;
}): TenantRequestContext {
  const permissionRows = opts.permissionRows ?? [];
  const tenantDb = {
    user: {
      findUnique: vi.fn().mockResolvedValue(opts.userExists === false ? null : { id: 'user-1' }),
    },
    modulePermission: {
      findMany: vi.fn().mockResolvedValue(permissionRows),
    },
    userModulePermission: {
      findUnique: vi.fn().mockResolvedValue(opts.override ?? null),
    },
  };
  return {
    tenantDb,
    auth: { type: 'tenant_user', sub: 'global-1', role: opts.role },
    tenantId: 't1',
  } as unknown as TenantRequestContext;
}

const NO_ACCESS = { canViewAll: false, canViewOwn: false, canCreate: false, canEdit: false, canDelete: false };

describe('PermissionsService', () => {
  const service = new PermissionsService();

  it('grants full access to OWNER regardless of any ModulePermission rows', async () => {
    const ctx = makeCtx({ role: 'OWNER' });
    const matrix = await service.getEffective(ctx, 'sales');
    expect(matrix).toEqual({ canViewAll: true, canViewOwn: true, canCreate: true, canEdit: true, canDelete: true });
    expect((ctx.tenantDb as never as { modulePermission: { findMany: ReturnType<typeof vi.fn> } }).modulePermission.findMany).not.toHaveBeenCalled();
  });

  it('grants full access to ADMIN the same as OWNER', async () => {
    const ctx = makeCtx({ role: 'ADMIN' });
    const matrix = await service.getEffective(ctx, 'sales');
    expect(matrix.canDelete).toBe(true);
  });

  it('gives a MEMBER with no assigned role rows no access at all', async () => {
    const ctx = makeCtx({ role: 'MEMBER', permissionRows: [] });
    await expect(service.getEffective(ctx, 'sales')).resolves.toEqual(NO_ACCESS);
  });

  it('unions (logical OR) across every role a MEMBER holds — one role granting an action is enough', async () => {
    const ctx = makeCtx({
      role: 'MEMBER',
      permissionRows: [
        { canViewAll: false, canViewOwn: true, canCreate: true, canEdit: false, canDelete: false },
        { canViewAll: false, canViewOwn: false, canCreate: false, canEdit: true, canDelete: false },
      ],
    });
    const matrix = await service.getEffective(ctx, 'sales');
    expect(matrix).toEqual({ canViewAll: false, canViewOwn: true, canCreate: true, canEdit: true, canDelete: false });
  });

  it('assertDelete throws ForbiddenException when the effective matrix has no delete access', async () => {
    const ctx = makeCtx({ role: 'MEMBER', permissionRows: [] });
    await expect(service.assertDelete(ctx, 'sales')).rejects.toThrow('اجازه‌ی حذف');
  });

  it('assertView passes when only canViewOwn is granted (canViewAll is not required)', async () => {
    const ctx = makeCtx({
      role: 'MEMBER',
      permissionRows: [{ canViewAll: false, canViewOwn: true, canCreate: false, canEdit: false, canDelete: false }],
    });
    await expect(service.assertView(ctx, 'sales')).resolves.toBeUndefined();
  });

  describe('viewScope', () => {
    it('returns an unrestricted (empty) where-fragment when canViewAll is granted', async () => {
      const ctx = makeCtx({
        role: 'MEMBER',
        permissionRows: [{ canViewAll: true, canViewOwn: false, canCreate: false, canEdit: false, canDelete: false }],
      });
      await expect(service.viewScope(ctx, 'sales', 'createdByUserId')).resolves.toEqual({});
    });

    it('scopes to the caller when only canViewOwn is granted', async () => {
      const ctx = makeCtx({
        role: 'MEMBER',
        permissionRows: [{ canViewAll: false, canViewOwn: true, canCreate: false, canEdit: false, canDelete: false }],
      });
      await expect(service.viewScope(ctx, 'sales', 'createdByUserId')).resolves.toEqual({ createdByUserId: 'user-1' });
    });

    it('throws when neither canViewAll nor canViewOwn is granted', async () => {
      const ctx = makeCtx({ role: 'MEMBER', permissionRows: [] });
      await expect(service.viewScope(ctx, 'sales', 'createdByUserId')).rejects.toThrow('اجازه‌ی مشاهده');
    });
  });

  it('a per-user override replaces the role-derived access (can revoke what the role grants)', async () => {
    const ctx = makeCtx({
      role: 'MEMBER',
      permissionRows: [{ ...NO_ACCESS, canViewAll: true, canEdit: true }],
      override: { ...NO_ACCESS, canViewOwn: true },
    });
    expect(await service.getEffective(ctx, 'hr')).toEqual({ ...NO_ACCESS, canViewOwn: true });
  });

  it('a per-user override can grant access the role does not have', async () => {
    const ctx = makeCtx({ role: 'MEMBER', permissionRows: [], override: { ...NO_ACCESS, canViewAll: true, canCreate: true } });
    expect(await service.getEffective(ctx, 'recruitment')).toEqual({ ...NO_ACCESS, canViewAll: true, canCreate: true });
  });
});
