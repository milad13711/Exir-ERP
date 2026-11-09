import { describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service.js';

function make(opts: { targetRole?: 'OWNER' | 'ADMIN' | 'MEMBER'; actorRole?: 'OWNER' | 'ADMIN'; otherTenants?: number; taken?: boolean | 'orphan'; superUser?: boolean } = {}) {
  const { targetRole = 'MEMBER', actorRole = 'OWNER', otherTenants = 0, taken = false, superUser = false } = opts;
  const target = { id: 'target', name: 'هدف', globalUserId: 'g-target', status: 'ACTIVE', phone: '09120000001' };
  const tenantDb = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; globalUserId?: string } }) =>
        where.id === 'target' ? target : where.globalUserId === 'g-actor' ? { id: 'actor', globalUserId: 'g-actor' } : null,
      ),
      findUniqueOrThrow: vi.fn().mockResolvedValue(target),
      update: vi.fn().mockResolvedValue({}),
    },
    activityLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const globalUserUpdate = vi.fn().mockResolvedValue({});
  const globalUserUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const membershipUpdate = vi.fn().mockResolvedValue({});
  const tx = { globalUser: { update: globalUserUpdate, updateMany: globalUserUpdateMany }, tenantMembership: { update: membershipUpdate } };
  const controlDb = {
    tenantMembership: {
      findUnique: vi.fn().mockResolvedValue({ id: 'm1', role: targetRole }),
      count: vi.fn().mockResolvedValue(otherTenants),
      update: membershipUpdate,
    },
    globalUser: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; phone?: string } }) =>
        where.id === 'g-target'
          ? { id: 'g-target', phone: '09120000001', isSuperUser: superUser }
          : where.phone && taken
            ? { id: 'g-other', isSuperUser: false, totpEnabledAt: null, _count: { memberships: taken === 'orphan' ? 0 : 1, supportTickets: 0 } }
            : null,
      ),
    },
    tenant: { findUnique: vi.fn().mockResolvedValue({ name: 'شرکت' }) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const sms = { isConfigured: () => false, sendSms: vi.fn() };
  const approvals = { registerHandler: vi.fn() };
  const service = new UsersService(controlDb as never, sms as never, approvals as never);
  const ctx = { tenantId: 't', tenantDb, auth: { type: 'tenant_user', sub: 'g-actor', role: actorRole, membershipId: 'actor-m' } } as never;
  return { service, ctx, tenantDb, controlDb, globalUserUpdate, globalUserUpdateMany, membershipUpdate };
}

describe('UsersService.changeUserPhone', () => {
  it('changes the login phone on the person and tenant user, and revokes current sessions', async () => {
    const { service, ctx, tenantDb, controlDb, globalUserUpdate, membershipUpdate } = make();
    const res = await service.changeUserPhone(ctx, 'target', '09129999999');
    expect(res).toEqual({ id: 'target', phone: '09129999999', changed: true });
    expect(globalUserUpdate).toHaveBeenCalledWith({ where: { id: 'g-target' }, data: { phone: '09129999999' } });
    expect(membershipUpdate).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { tokenVersion: { increment: 1 } } });
    expect(controlDb.$transaction).toHaveBeenCalledTimes(1);
    expect(tenantDb.user.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { phone: '09129999999' } });
    expect(tenantDb.activityLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'user.phone_changed' }) }));
  });

  it('frees a number held only by an abandoned account (e.g. a deleted invite) instead of refusing', async () => {
    const { service, ctx, globalUserUpdate, globalUserUpdateMany } = make({ taken: 'orphan' });
    const res = await service.changeUserPhone(ctx, 'target', '09129999999');
    expect(res.changed).toBe(true);
    expect(globalUserUpdateMany).toHaveBeenCalledWith({
      where: { id: 'g-other', phone: '09129999999', memberships: { none: {} }, isSuperUser: false },
      data: { phone: 'released:g-other' },
    });
    expect(globalUserUpdate).toHaveBeenCalledWith({ where: { id: 'g-target' }, data: { phone: '09129999999' } });
  });

  it('does not free the number if the abandoned account was re-invited meanwhile (re-checked inside the transaction)', async () => {
    const { service, ctx, globalUserUpdate, globalUserUpdateMany } = make({ taken: 'orphan' });
    globalUserUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.changeUserPhone(ctx, 'target', '09129999999')).rejects.toThrow('حساب دیگری');
    expect(globalUserUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the person also belongs to another workspace (no cross-tenant account takeover)', async () => {
    const { service, ctx, controlDb } = make({ otherTenants: 1 });
    await expect(service.changeUserPhone(ctx, 'target', '09129999999')).rejects.toThrow('محیط‌های کاری دیگری');
    expect(controlDb.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a phone that already belongs to another account', async () => {
    const { service, ctx, controlDb } = make({ taken: true });
    await expect(service.changeUserPhone(ctx, 'target', '09129999999')).rejects.toThrow('حساب دیگری');
    expect(controlDb.$transaction).not.toHaveBeenCalled();
  });

  it('an admin cannot change the phone of the owner or a peer admin', async () => {
    for (const targetRole of ['OWNER', 'ADMIN'] as const) {
      const { service, ctx, controlDb } = make({ targetRole, actorRole: 'ADMIN' });
      await expect(service.changeUserPhone(ctx, 'target', '09129999999')).rejects.toThrow('مدیر بالادستی');
      expect(controlDb.$transaction).not.toHaveBeenCalled();
    }
  });

  it('never touches a platform super-user and rejects malformed numbers', async () => {
    const s1 = make({ superUser: true });
    await expect(s1.service.changeUserPhone(s1.ctx, 'target', '09129999999')).rejects.toThrow('پنل پلتفرم');
    const s2 = make();
    await expect(s2.service.changeUserPhone(s2.ctx, 'target', '9129999999')).rejects.toThrow('نامعتبر');
  });

  it('is a no-op when the number is unchanged', async () => {
    const { service, ctx, controlDb } = make();
    const res = await service.changeUserPhone(ctx, 'target', '09120000001');
    expect(res.changed).toBe(false);
    expect(controlDb.$transaction).not.toHaveBeenCalled();
  });
});
