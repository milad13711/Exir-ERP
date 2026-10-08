import * as bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { AdminUsersService } from './admin-users.service.js';
import { generateOneTimePassword, validateAdminPassword } from './admin-password-policy.js';

type Row = Record<string, any>;
function make(rows: Row[]) {
  const db = {
    adminUser: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => rows.find((r) => r.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null),
      count: vi.fn().mockImplementation(async ({ where }: any) => rows.filter((r) => r.team === where.team && r.isActive === where.isActive && r.id !== where.id.not).length),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'new1', ...data })),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const events = { record: vi.fn() };
  return { svc: new AdminUsersService(db as never, events as never), db, events };
}
const sa = (id: string, over: Row = {}) => ({ id, email: `${id}@x.ir`, team: 'SUPER_ADMIN', isActive: true, ...over });

describe('password policy', () => {
  it('accepts a strong password; rejects the rules', () => {
    expect(validateAdminPassword('Tr0ub4dor-and-3-horses', { email: 'bob@x.ir' })).toBeNull();
    expect(validateAdminPassword('Ab1-short')).toMatch(/12/);
    expect(validateAdminPassword('ExirSupport123!')).not.toBeNull();
    expect(validateAdminPassword('my-bobby-pass-99', { email: 'bobby@x.ir' })).toMatch(/ایمیل/);
    expect(validateAdminPassword('Same-As-Before-1', { currentPassword: 'Same-As-Before-1' })).toMatch(/متفاوت/);
  });
  it('generated one-time passwords always satisfy the policy', () => {
    for (let i = 0; i < 50; i++) expect(validateAdminPassword(generateOneTimePassword('a@x.ir'), { email: 'a@x.ir' })).toBeNull();
  });
});

describe('AdminUsersService', () => {
  it('create: returns the one-time password once, stores only a hash, flags mustChangePassword, never logs it', async () => {
    const { svc, db, events } = make([]);
    const res = await svc.create('boss', { name: 'N', email: 'New@x.ir', team: 'SUPPORT' });
    const data = db.adminUser.create.mock.calls[0][0].data;
    expect(data.mustChangePassword).toBe(true);
    expect(data.passwordHash).not.toBe(res.oneTimePassword);
    expect(await bcrypt.compare(res.oneTimePassword, data.passwordHash)).toBe(true);
    const logged = JSON.stringify([db.auditLog.create.mock.calls, events.record.mock.calls]);
    expect(logged).not.toContain(res.oneTimePassword);
  });

  it('reset: new one-time password, flag set, sessions revoked, secret absent from audit/events; cannot reset self', async () => {
    const { svc, db, events } = make([sa('boss'), sa('u2', { team: 'SUPPORT' })]);
    const res = await svc.resetPassword('boss', 'u2');
    const data = db.adminUser.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ mustChangePassword: true, tokenVersion: { increment: 1 } });
    expect(JSON.stringify([db.auditLog.create.mock.calls, events.record.mock.calls])).not.toContain(res.oneTimePassword);
    await expect(svc.resetPassword('boss', 'boss')).rejects.toMatchObject({ status: 400 });
  });

  it('cannot disable yourself, nor the last active SUPER_ADMIN; disabling revokes sessions', async () => {
    const { svc, db } = make([sa('boss'), sa('other', { team: 'SUPPORT' })]);
    await expect(svc.setActive('boss', 'boss', false)).rejects.toMatchObject({ status: 400 });
    await expect(svc.setActive('other', 'boss', false)).rejects.toMatchObject({ status: 400 }); // last super admin
    await svc.setActive('boss', 'other', false);
    expect(db.adminUser.update).toHaveBeenCalledWith({ where: { id: 'other' }, data: { isActive: false, tokenVersion: { increment: 1 } } });
    const two = make([sa('a'), sa('b')]);
    await two.svc.setActive('a', 'b', false); // allowed: another active super admin remains
    expect(two.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'admin_user.disabled' }) }));
  });

  it('cannot demote yourself or the last super admin', async () => {
    const { svc } = make([sa('boss'), sa('b', { isActive: false })]);
    await expect(svc.setTeam('boss', 'boss', 'SUPPORT')).rejects.toMatchObject({ status: 400 });
    await expect(svc.setTeam('x', 'boss', 'SUPPORT')).rejects.toMatchObject({ status: 400 });
  });
});
