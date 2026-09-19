import { describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service.js';

function make(targetRole: 'OWNER' | 'ADMIN' | 'MEMBER', actorRole: 'OWNER' | 'ADMIN') {
  const tenantDb = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'target', name: 'هدف', globalUserId: 'g-target' }),
      findUnique: vi.fn().mockResolvedValue({ id: 'actor', globalUserId: 'g-actor' }),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  const controlDb = {
    tenantMembership: {
      findUnique: vi.fn().mockResolvedValue({ id: 'm1', role: targetRole }),
      delete: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(1),
      update: vi.fn(),
    },
  };
  const approvals = { registerHandler: vi.fn(), request: vi.fn().mockResolvedValue({}), closeForEntity: vi.fn() };
  const service = new UsersService(controlDb as never, {} as never, approvals as never);
  const ctx = { tenantId: 't', tenantDb, auth: { role: actorRole, membershipId: 'actor-m' } } as never;
  return { service, ctx, tenantDb, controlDb, approvals };
}

describe('UsersService — deletion hierarchy', () => {
  it('never deletes the main owner, even for another owner', async () => {
    const { service, ctx } = make('OWNER', 'OWNER');
    await expect(service.deleteUser(ctx, 'target')).rejects.toThrow('مدیر اصلی');
  });

  it('an admin cannot delete a peer admin', async () => {
    const { service, ctx } = make('ADMIN', 'ADMIN');
    await expect(service.deleteUser(ctx, 'target')).rejects.toThrow('مدیر بالادستی');
  });

  it('an admin deleting a member goes to the cartable instead of deleting', async () => {
    const { service, ctx, tenantDb, approvals } = make('MEMBER', 'ADMIN');
    const res = await service.deleteUser(ctx, 'target');
    expect(res.pendingApproval).toBe(true);
    expect(approvals.request).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityType: 'USER_DELETION', entityId: 'target' }));
    expect(tenantDb.user.delete).not.toHaveBeenCalled();
  });

  it('the owner deletes an admin directly', async () => {
    const { service, ctx, tenantDb } = make('ADMIN', 'OWNER');
    const res = await service.deleteUser(ctx, 'target');
    expect(res.pendingApproval).toBe(false);
    expect(tenantDb.user.delete).toHaveBeenCalled();
  });

  it('refuses to demote the last owner', async () => {
    const { service, ctx } = make('OWNER', 'OWNER');
    await expect(service.setManagementRole(ctx, 'target', 'ADMIN', false)).rejects.toThrow('حداقل یک مدیر کل');
  });
});
