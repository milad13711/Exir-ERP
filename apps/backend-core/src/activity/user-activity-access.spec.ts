import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { resolveArchiveAccess } from './user-activity-access.js';

type Opts = {
  viewer: string | null;
  role?: string;
  authType?: string;
  users?: Record<string, { id: string; name: string; status: string; globalUserId: string }>;
  hr?: { canViewAll: boolean; canViewOwn: boolean };
  employees?: Record<string, string>; // userId -> employeeId
  membershipRole?: Record<string, string>; // globalUserId -> role
  subordinates?: string[]; // employee ids below viewer
  runs?: Array<{ fromUserId: string; fromUserName: string }>;
};

const U = (id: string, over = {}) => ({ id, name: `n-${id}`, status: 'ACTIVE', globalUserId: `g-${id}`, ...over });

function setup(o: Opts) {
  const users = { target: U('target'), viewer: U('viewer'), boss: U('boss'), ...(o.users ?? {}) } as NonNullable<Opts['users']>;
  const db = {
    user: {
      findUnique: vi.fn(async (a: { where: { id?: string; globalUserId?: string } }) => {
        if (a.where.globalUserId) return o.viewer ? { id: o.viewer } : null;
        return (users as Record<string, unknown>)[a.where.id as string] ?? Object.values(users).find((u) => u?.id === a.where.id) ?? null;
      }),
    },
    employee: {
      findUnique: vi.fn(async (a: { where: { userId?: string; id?: string } }) => {
        const emp = o.employees ?? {};
        if (a.where.userId) return emp[a.where.userId] ? { id: emp[a.where.userId] } : null;
        return { managerId: null };
      }),
      findMany: vi.fn(async (a: { where: { id?: { in: string[] }; managerId?: { in: string[] }; userId?: unknown } }) => {
        if (a.where.managerId) return (o.subordinates ?? []).filter(() => a.where.managerId!.in.includes(emp(o, 'viewer'))).map((id) => ({ id }));
        const ids = a.where.id?.in ?? [];
        return Object.entries(o.employees ?? {}).filter(([, e]) => ids.includes(e)).map(([userId]) => ({ userId }));
      }),
    },
    department: { findMany: vi.fn(async () => []) },
    userOffboardingRun: { findFirst: vi.fn(async (a: { where: { fromUserId: string } }) => (o.runs ?? []).find((r) => r.fromUserId === a.where.fromUserId) ?? null) },
  };
  const ctx = { auth: { role: o.role ?? 'MEMBER', type: o.authType ?? 'tenant_user', sub: 'gv' }, tenantId: 't', tenantDb: db } as never;
  const permissions = { getEffective: vi.fn(async () => ({ canViewAll: o.hr?.canViewAll ?? false, canViewOwn: o.hr?.canViewOwn ?? false })) };
  const controlDb = { tenantMembership: { findUnique: vi.fn(async (a: { where: { tenantId_globalUserId: { globalUserId: string } } }) => { const r = o.membershipRole?.[a.where.tenantId_globalUserId.globalUserId]; return r ? { role: r } : null; }) } };
  return { ctx, deps: { permissions: permissions as never, controlDb: controlDb as never } };
}
const emp = (o: Opts, who: string) => (o.employees ?? {})[who] ?? '';

describe('resolveArchiveAccess scope matrix', () => {
  it('خود کاربر: self با IP', async () => {
    const { ctx, deps } = setup({ viewer: 'target' });
    const a = await resolveArchiveAccess(ctx, 'target', deps);
    expect(a).toMatchObject({ level: 'self', canSeeNetwork: true, canExport: false, canSeeLabels: true });
  });
  it('OWNER/ADMIN: هر کاربر، با IP و CSV', async () => {
    const { ctx, deps } = setup({ viewer: 'boss', role: 'ADMIN' });
    expect(await resolveArchiveAccess(ctx, 'target', deps)).toMatchObject({ level: 'admin', canSeeNetwork: true, canExport: true });
  });
  it('کاربر عادی بدون HR: ۴۰۴', async () => {
    const { ctx, deps } = setup({ viewer: 'viewer', employees: { target: 'e-t' } });
    await expect(resolveArchiveAccess(ctx, 'target', deps)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('HR با canViewAll: کارمند را می‌بیند، بدون IP؛ کاربر غیرکارمند ۴۰۴', async () => {
    const ok = setup({ viewer: 'viewer', hr: { canViewAll: true, canViewOwn: true }, employees: { target: 'e-t' } });
    expect(await resolveArchiveAccess(ok.ctx, 'target', ok.deps)).toMatchObject({ level: 'hr', canSeeNetwork: false, canExport: true, canSeeLabels: false });
    const none = setup({ viewer: 'viewer', hr: { canViewAll: true, canViewOwn: true }, employees: {} });
    await expect(resolveArchiveAccess(none.ctx, 'target', none.deps)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('HR نمی‌تواند فعالیت مالک/مدیر سیستم را ببیند', async () => {
    const { ctx, deps } = setup({ viewer: 'viewer', hr: { canViewAll: true, canViewOwn: true }, employees: { target: 'e-t' }, membershipRole: { 'g-target': 'ADMIN' } });
    await expect(resolveArchiveAccess(ctx, 'target', deps)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('مدیر سلسله‌مراتبی (canViewOwn): فقط زیردست؛ غیرزیردست ۴۰۴', async () => {
    const yes = setup({ viewer: 'viewer', hr: { canViewAll: false, canViewOwn: true }, employees: { viewer: 'e-v', target: 'e-t' }, subordinates: ['e-t'] });
    expect(await resolveArchiveAccess(yes.ctx, 'target', yes.deps)).toMatchObject({ level: 'hr' });
    const no = setup({ viewer: 'viewer', hr: { canViewAll: false, canViewOwn: true }, employees: { viewer: 'e-v', target: 'e-t' }, subordinates: [] });
    await expect(resolveArchiveAccess(no.ctx, 'target', no.deps)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('کلید API: ۴۰۴', async () => {
    const { ctx, deps } = setup({ viewer: null, role: 'ADMIN', authType: 'api_key' });
    await expect(resolveArchiveAccess(ctx, 'target', deps)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('کاربر ناشناس‌شده/غیرفعال: مدیر دسترسی دارد (فقط‌خواندنی)، غیرمدیر ۴۰۴', async () => {
    const users = { target: U('target', { name: 'کاربر حذف‌شده', status: 'DISABLED', globalUserId: 'deleted:gx' }) };
    const admin = setup({ viewer: 'boss', role: 'OWNER', users });
    const a = await resolveArchiveAccess(admin.ctx, 'target', admin.deps);
    expect(a.level).toBe('admin');
    expect(a.target?.globalUserId).toBe('deleted:gx');
    const member = setup({ viewer: 'viewer', users });
    await expect(resolveArchiveAccess(member.ctx, 'target', member.deps)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('ردیف کاربر کاملاً حذف: مدیر فقط با گزارش خروج؛ بدون آن ۴۰۴', async () => {
    const users = { gone: undefined } as never;
    const withRun = setup({ viewer: 'boss', role: 'ADMIN', users, runs: [{ fromUserId: 'gone', fromUserName: 'علی' }] });
    const a = await resolveArchiveAccess(withRun.ctx, 'gone', withRun.deps);
    expect(a.tombstone).toEqual({ name: 'علی' });
    const noRun = setup({ viewer: 'boss', role: 'ADMIN', users });
    await expect(resolveArchiveAccess(noRun.ctx, 'gone', noRun.deps)).rejects.toBeInstanceOf(NotFoundException);
    const member = setup({ viewer: 'viewer', users, runs: [{ fromUserId: 'gone', fromUserName: 'علی' }] });
    await expect(resolveArchiveAccess(member.ctx, 'gone', member.deps)).rejects.toBeInstanceOf(NotFoundException);
  });
});
