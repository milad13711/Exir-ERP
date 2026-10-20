import { describe, expect, it, vi } from 'vitest';
import { OffboardingService } from './offboarding.service.js';
import { makeFakeTenantDb } from '../../../test/helpers/fake-tenant-db.js';

const LEAVER = 'u-leaver';
const TARGET = 'u-target';
const OTHER = 'u-other';
const ACTOR = 'u-actor';

type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

function baseSeed(extra: Record<string, unknown[]> = {}) {
  return {
    user: [
      { id: LEAVER, name: 'علی', status: 'ACTIVE', globalUserId: 'g-leaver', phone: '0912' },
      { id: TARGET, name: 'مهدی', status: 'ACTIVE', globalUserId: 'g-target', phone: '0913' },
      { id: OTHER, name: 'سارا', status: 'ACTIVE', globalUserId: 'g-other', phone: '0914' },
      { id: ACTOR, name: 'مدیر', status: 'ACTIVE', globalUserId: 'g-actor', phone: '0915' },
    ],
    crmContact: [
      { id: 'c1', ownerUserId: LEAVER },
      { id: 'c2', ownerUserId: LEAVER },
      { id: 'c3', ownerUserId: TARGET },
    ],
    crmDeal: [
      { id: 'd1', ownerUserId: LEAVER, stage: 'NEW' },
      { id: 'd2', ownerUserId: LEAVER, stage: 'WON' },
    ],
    task: [
      { id: 't1', status: 'IN_PROGRESS', assignedUserId: LEAVER, createdByUserId: LEAVER },
      { id: 't2', status: 'NEW', assignedUserId: null, createdByUserId: LEAVER },
      { id: 't3', status: 'APPROVED', assignedUserId: LEAVER, createdByUserId: LEAVER },
    ],
    taskAssignee: [
      { id: 'a1', taskId: 't1', userId: LEAVER },
      { id: 'a2', taskId: 't2', userId: LEAVER },
      { id: 'a3', taskId: 't1', userId: TARGET },
      { id: 'a4', taskId: 't3', userId: LEAVER },
    ],
    role: [{ id: 'r-all' }],
    userRole: [
      { id: 'ur-t', userId: TARGET, roleId: 'r-all' },
      { id: 'ur-o', userId: OTHER, roleId: 'r-all' },
    ],
    modulePermission: [
      { id: 'mp-t', roleId: 'r-all', moduleCode: 'tasks', canViewOwn: true, canViewAll: false },
      { id: 'mp-c', roleId: 'r-all', moduleCode: 'crm', canViewOwn: true, canViewAll: false },
    ],
    pushSubscription: [{ id: 'p1', userId: LEAVER }],
    notification: [{ id: 'n1', userId: LEAVER }],
    employee: [{ id: 'e1', userId: LEAVER, fullName: 'علی رضایی', managerId: null }],
    ...extra,
  } as Record<string, unknown[]>;
}

function setup(opts: { seed?: Record<string, unknown[]>; actorRole?: Role; leaverRole?: Role; targetRole?: Role; failOn?: (op: string, table: string) => boolean; otherManagers?: number; modulePermissions?: unknown[] } = {}) {
  const seed = opts.seed ?? baseSeed();
  const { db, tables } = makeFakeTenantDb(seed, { failOn: opts.failOn });
  const memberships = [
    { id: 'm-leaver', globalUserId: 'g-leaver', role: opts.leaverRole ?? 'MEMBER', status: 'ACTIVE' },
    { id: 'm-target', globalUserId: 'g-target', role: opts.targetRole ?? 'MEMBER', status: 'ACTIVE' },
    { id: 'm-other', globalUserId: 'g-other', role: 'MEMBER', status: 'ACTIVE' },
    { id: 'm-actor', globalUserId: 'g-actor', role: opts.actorRole ?? 'OWNER', status: 'ACTIVE' },
  ];
  const controlDb = {
    tenantMembership: {
      findUnique: vi.fn(async ({ where }: { where: { tenantId_globalUserId: { globalUserId: string } } }) => memberships.find((m) => m.globalUserId === where.tenantId_globalUserId.globalUserId) ?? null),
      findMany: vi.fn(async ({ where }: { where: { globalUserId?: { in: string[] }; role?: unknown } }) => {
        if (where.globalUserId) return memberships.filter((m) => where.globalUserId!.in.includes(m.globalUserId));
        return memberships.filter((m) => m.role === 'OWNER');
      }),
      count: vi.fn(async () => (opts.otherManagers ?? 1)),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const m = memberships.find((x) => x.id === where.id)!;
        if (data.status) m.status = data.status as string;
        return m;
      }),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    moduleDefinition: { findMany: vi.fn(async () => []) },
    tenantModule: { findMany: vi.fn(async () => []) },
  };
  const notifications = { notify: vi.fn(async (_db: unknown, _input: unknown) => undefined) };
  const service = new OffboardingService(controlDb as never, notifications as never);
  const ctx = { tenantId: 't1', tenantDb: db, auth: { type: 'tenant_user', sub: 'g-actor', role: opts.actorRole ?? 'OWNER' } } as never;
  return { service, ctx, tables, controlDb, notifications, memberships };
}

const snap = (t: Record<string, unknown[]>) => JSON.stringify(Object.fromEntries(Object.entries(t).filter(([, v]) => v.length > 0).sort(([a], [b]) => a.localeCompare(b))));
const rows = (t: Record<string, unknown[]>, name: string) => (t[name] ?? []) as Array<Record<string, unknown>>;

describe('OffboardingService.offboard — transfer', () => {
  it('moves only open, owned records; keeps authorship (createdBy) and closed records untouched', async () => {
    const { service, ctx, tables } = setup();
    const res = await service.offboard(ctx, LEAVER, { transferToUserId: TARGET, mode: 'deactivate' });
    const t = tables();
    expect(rows(t, 'crmContact').filter((c) => c.ownerUserId === TARGET)).toHaveLength(3);
    expect(rows(t, 'crmDeal').find((d) => d.id === 'd1')!.ownerUserId).toBe(TARGET);
    expect(rows(t, 'crmDeal').find((d) => d.id === 'd2')!.ownerUserId).toBe(LEAVER); // برده‌شده: سابقه
    expect(rows(t, 'task').find((x) => x.id === 't1')!.assignedUserId).toBe(TARGET);
    expect(rows(t, 'task').find((x) => x.id === 't3')!.assignedUserId).toBe(LEAVER); // تأییدشده: سابقه
    expect(rows(t, 'task').every((x) => x.createdByUserId === LEAVER)).toBe(true); // سازنده هرگز عوض نمی‌شود
    expect(res.totals.moved).toBe(2 + 1 + 1 + 1 /* contacts, deal, task, taskAssignee a2 */);
    expect(res.userOutcome).toBe('deactivated');
  });

  it('handles assignee-join unique conflicts: ادغام when target already holds the same assignment', async () => {
    const { service, ctx, tables } = setup();
    const res = await service.offboard(ctx, LEAVER, { transferToUserId: TARGET });
    const assignees = rows(tables(), 'taskAssignee');
    // t1: مقصد از قبل داشت → ردیف علی ادغام (حذف) شد؛ t2: منتقل شد؛ t3 (تأییدشده) دست‌نخورده
    expect(assignees.filter((a) => a.taskId === 't1' && a.userId === TARGET)).toHaveLength(1);
    expect(assignees.some((a) => a.taskId === 't1' && a.userId === LEAVER)).toBe(false);
    expect(assignees.find((a) => a.taskId === 't2')!.userId).toBe(TARGET);
    expect(assignees.find((a) => a.taskId === 't3')!.userId).toBe(LEAVER);
    const entry = res.modules.find((m) => m.moduleCode === 'tasks')!.entries.find((e) => e.key === 'TaskAssignee.userId')!;
    expect(entry).toMatchObject({ moved: 1, merged: 1 });
  });

  it('writes an immutable run record (with ids for the CSV) and an ActivityLog row «انتقال مسئولیت»', async () => {
    const { service, ctx, tables } = setup();
    const res = await service.offboard(ctx, LEAVER, { transferToUserId: TARGET, reason: 'ترک کار' });
    const run = rows(tables(), 'userOffboardingRun')[0];
    expect(run).toMatchObject({ fromUserId: LEAVER, fromUserName: 'علی', toUserId: TARGET, toUserName: 'مهدی', mode: 'deactivate', reason: 'ترک کار', performedByUserId: ACTOR });
    expect(res.runId).toBe(run.id);
    const details = run.details as Array<{ key: string; action: string; ids: string[] }>;
    expect(details.find((d) => d.key === 'CrmContact.ownerUserId')!.ids.sort()).toEqual(['c1', 'c2']);
    const log = rows(tables(), 'activityLog')[0];
    expect(log).toMatchObject({ entityType: 'User', entityId: LEAVER, moduleCode: 'users', action: 'users.offboarded', userId: ACTOR });
    expect(String(log.summary)).toContain('انتقال مسئولیت از «علی» به «مهدی»');
    const csv = await service.buildRunCsv(ctx, run.id as string);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('c1');
    expect(csv).toContain('مهدی');
  });

  it('notifies the target («N رکورد به شما منتقل شد») only after commit', async () => {
    const { service, ctx, notifications } = setup();
    await service.offboard(ctx, LEAVER, { transferToUserId: TARGET });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect((notifications.notify.mock.calls[0] as unknown[])[1]).toMatchObject({ userId: TARGET, type: 'RECORDS_TRANSFERRED', title: '5 رکورد به شما منتقل شد' });
  });

  it('per-module override sends that module to a different user', async () => {
    const { service, ctx, tables, notifications } = setup();
    await service.offboard(ctx, LEAVER, { transferToUserId: TARGET, perModuleOverrides: { crm: OTHER } });
    const t = tables();
    expect(rows(t, 'crmContact').filter((c) => c.ownerUserId === OTHER)).toHaveLength(2);
    expect(rows(t, 'task').find((x) => x.id === 't1')!.assignedUserId).toBe(TARGET);
    expect(notifications.notify.mock.calls.map((c) => ((c as unknown[])[1] as { userId: string }).userId).sort()).toEqual([OTHER, TARGET].sort());
  });

  it('managerOnly responsibilities fall back to managers when the target is not a manager', async () => {
    const seed = baseSeed({
      approvalRequest: [{ id: 'ar1', status: 'PENDING', assigneeUserId: LEAVER }, { id: 'ar2', status: 'APPROVED', assigneeUserId: LEAVER }],
      moduleApprover: [{ id: 'ma1', moduleCode: 'sales', userId: LEAVER }],
    });
    const { service, ctx, tables } = setup({ seed });
    const res = await service.offboard(ctx, LEAVER, { transferToUserId: TARGET });
    expect(rows(tables(), 'approvalRequest').find((r) => r.id === 'ar1')!.assigneeUserId).toBeNull();
    expect(rows(tables(), 'approvalRequest').find((r) => r.id === 'ar2')!.assigneeUserId).toBe(LEAVER);
    expect(rows(tables(), 'moduleApprover')).toHaveLength(0);
    expect(res.totals.unassigned).toBe(2);
  });

  it('a manager target keeps the approver responsibilities', async () => {
    const seed = baseSeed({ moduleApprover: [{ id: 'ma1', moduleCode: 'sales', userId: LEAVER }] });
    const { service, ctx, tables } = setup({ seed, targetRole: 'ADMIN' });
    await service.offboard(ctx, LEAVER, { transferToUserId: TARGET });
    expect(rows(tables(), 'moduleApprover')[0].userId).toBe(TARGET);
  });
});

describe('OffboardingService — dry-run', () => {
  it('returns exactly the counts of the real run and writes nothing', async () => {
    const a = setup();
    const before = snap(a.tables());
    const dry = await a.service.dryRun(a.ctx, LEAVER, { transferToUserId: TARGET });
    expect(snap(a.tables())).toBe(before);
    expect(dry.dryRun).toBe(true);
    expect(dry.runId).toBeNull();

    const b = setup();
    const real = await b.service.offboard(b.ctx, LEAVER, { transferToUserId: TARGET });
    expect(dry.totals).toEqual(real.totals);
    expect(dry.modules).toEqual(real.modules);
    expect(dry.cleanup).toEqual(real.cleanup);
    expect(a.controlDb.tenantMembership.update).not.toHaveBeenCalled();
  });
});

describe('OffboardingService — atomicity & idempotency', () => {
  it('rolls everything back on failure: no partial transfer, no run row, no notification, membership restored', async () => {
    const { service, ctx, tables, controlDb, notifications, memberships } = setup({ failOn: (op, table) => op === 'updateMany' && table === 'crmDeal' });
    const before = snap(tables());
    await expect(service.offboard(ctx, LEAVER, { transferToUserId: TARGET })).rejects.toThrow('injected failure');
    expect(snap(tables())).toBe(before); // contacts که قبل از deal منتقل شده بودند هم برگشتند
    expect(rows(tables(), 'userOffboardingRun')).toHaveLength(0);
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(controlDb.tenantMembership.deleteMany).not.toHaveBeenCalled();
    expect(memberships.find((m) => m.id === 'm-leaver')!.status).toBe('ACTIVE');
  });

  it('is idempotent: re-running after success transfers nothing and needs no target', async () => {
    const { service, ctx, tables } = setup();
    await service.offboard(ctx, LEAVER, { transferToUserId: TARGET });
    const second = await service.offboard(ctx, LEAVER, {});
    expect(second.totals).toEqual({ moved: 0, merged: 0, unassigned: 0, cleanedUp: 0 });
    expect(rows(tables(), 'crmContact').filter((c) => c.ownerUserId === TARGET)).toHaveLength(3);
  });

  it('after a partial failure, a re-run moves the remainder', async () => {
    let fail = true;
    const { service, ctx, tables } = setup({ failOn: (op, table) => fail && op === 'updateMany' && table === 'task' });
    await expect(service.offboard(ctx, LEAVER, { transferToUserId: TARGET })).rejects.toThrow();
    fail = false;
    const res = await service.offboard(ctx, LEAVER, { transferToUserId: TARGET });
    expect(res.totals.moved).toBe(5);
    expect(rows(tables(), 'crmContact').every((c) => c.ownerUserId !== LEAVER)).toBe(true);
  });
});

describe('OffboardingService — account handling', () => {
  it('deactivate: disables membership + bumps token version, removes push subscriptions, detaches employee login, keeps the user row and notifications', async () => {
    const { service, ctx, tables, controlDb } = setup();
    await service.offboard(ctx, LEAVER, { transferToUserId: TARGET, mode: 'deactivate' });
    expect(controlDb.tenantMembership.update).toHaveBeenCalledWith({ where: { id: 'm-leaver' }, data: { status: 'DISABLED', tokenVersion: { increment: 1 } } });
    expect(rows(tables(), 'user').find((u) => u.id === LEAVER)).toMatchObject({ status: 'DISABLED', name: 'علی' });
    expect(rows(tables(), 'pushSubscription')).toHaveLength(0);
    expect(rows(tables(), 'employee')[0].userId).toBeNull();
    expect(rows(tables(), 'notification')).toHaveLength(1); // فقط در حذف کامل پاک می‌شود
    expect(controlDb.tenantMembership.deleteMany).not.toHaveBeenCalled();
  });

  it('transfer-only: moves records but leaves account, sessions and personal data alone', async () => {
    const { service, ctx, tables, controlDb } = setup();
    const res = await service.offboard(ctx, LEAVER, { transferToUserId: TARGET, mode: 'transfer-only' });
    expect(res.userOutcome).toBe('unchanged');
    expect(controlDb.tenantMembership.update).not.toHaveBeenCalled();
    expect(rows(tables(), 'user').find((u) => u.id === LEAVER)!.status).toBe('ACTIVE');
    expect(rows(tables(), 'pushSubscription')).toHaveLength(1);
    expect(rows(tables(), 'employee')[0].userId).toBe(LEAVER);
    expect(rows(tables(), 'activityLog')[0].action).toBe('users.records.transferred');
  });

  it('delete: anonymises the user (history keeps the id), clears personal data, removes the membership (frees the seat)', async () => {
    const seed = baseSeed({ activityLog: [{ id: 'al1', userId: LEAVER }] });
    const { service, ctx, tables, controlDb } = setup({ seed });
    const res = await service.offboard(ctx, LEAVER, { transferToUserId: TARGET, mode: 'delete' });
    expect(res.userOutcome).toBe('anonymised');
    expect(res.freesLicenseSeat).toBe(true);
    expect(rows(tables(), 'user').find((u) => u.id === LEAVER)).toMatchObject({ name: 'کاربر حذف‌شده', status: 'DISABLED', email: null, globalUserId: 'deleted:g-leaver' });
    expect(rows(tables(), 'notification')).toHaveLength(0);
    expect(controlDb.tenantMembership.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 't1', globalUserId: 'g-leaver' } });
  });

  it('delete with zero remaining references removes the row for real', async () => {
    const s = setup({ seed: { user: baseSeed().user, crmContact: [] } as Record<string, unknown[]> });
    const res = await s.service.offboard(s.ctx, LEAVER, { mode: 'delete' });
    expect(res.userOutcome).toBe('deleted');
    expect(rows(s.tables(), 'user').some((u) => u.id === LEAVER)).toBe(false);
  });

  it('delete is idempotent for an already-anonymised user (finishes the control-plane membership removal)', async () => {
    const seed = baseSeed();
    (seed.user as Array<Record<string, unknown>>)[0].globalUserId = 'deleted:g-leaver';
    (seed.user as Array<Record<string, unknown>>)[0].name = 'کاربر حذف‌شده';
    seed.crmContact = [];
    seed.task = [];
    seed.taskAssignee = [];
    seed.crmDeal = [];
    seed.activityLog = [{ id: 'al1', userId: LEAVER }];
    const { service, ctx, controlDb } = setup({ seed });
    const res = await service.offboard(ctx, LEAVER, { mode: 'delete' });
    expect(res.userOutcome).toBe('anonymised');
    expect(controlDb.tenantMembership.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 't1', globalUserId: 'g-leaver' } });
  });
});

describe('OffboardingService — authorisation & validation', () => {
  it('only OWNER/ADMIN may use the engine', async () => {
    const { service, ctx } = setup({ actorRole: 'MEMBER' });
    await expect(service.offboard(ctx, LEAVER, { transferToUserId: TARGET })).rejects.toThrow('فقط مالک یا مدیر');
    await expect(service.preview(ctx, LEAVER)).rejects.toThrow('فقط مالک یا مدیر');
    await expect(service.dryRun(ctx, LEAVER, { transferToUserId: TARGET })).rejects.toThrow('فقط مالک یا مدیر');
  });

  it('blocks the main owner (deactivate/delete) but allows transfer-only', async () => {
    const { service, ctx } = setup({ leaverRole: 'OWNER' });
    await expect(service.offboard(ctx, LEAVER, { transferToUserId: TARGET })).rejects.toThrow('مدیر اصلی');
    await expect(service.offboard(ctx, LEAVER, { transferToUserId: TARGET, mode: 'transfer-only' })).resolves.toBeTruthy();
  });

  it('blocks the last active manager', async () => {
    const { service, ctx } = setup({ leaverRole: 'ADMIN', otherManagers: 0 });
    await expect(service.offboard(ctx, LEAVER, { transferToUserId: TARGET })).rejects.toThrow('آخرین مدیر');
  });

  it('blocks self-removal and peer/upper-level removal by an admin; delete is owner-only', async () => {
    const self = setup();
    await expect(self.service.offboard(self.ctx, ACTOR, { transferToUserId: TARGET })).rejects.toThrow('خودتان');
    const peer = setup({ actorRole: 'ADMIN', leaverRole: 'ADMIN' });
    await expect(peer.service.offboard(peer.ctx, LEAVER, { transferToUserId: TARGET })).rejects.toThrow('مدیر بالادستی');
    const del = setup({ actorRole: 'ADMIN' });
    await expect(del.service.offboard(del.ctx, LEAVER, { transferToUserId: TARGET, mode: 'delete' })).rejects.toThrow('حذف کامل فقط');
  });

  it('requires a target when records exist; rejects inactive / same-as-leaver targets; skips the target when nothing is owned', async () => {
    const s = setup();
    await expect(s.service.offboard(s.ctx, LEAVER, {})).rejects.toThrow('الزامی');
    await expect(s.service.offboard(s.ctx, LEAVER, { transferToUserId: LEAVER })).rejects.toThrow('خودِ کاربر');
    (s.tables().user as Array<Record<string, unknown>>)[1].status = 'DISABLED';
    await expect(s.service.offboard(s.ctx, LEAVER, { transferToUserId: TARGET })).rejects.toThrow('فعال نیست');
    await expect(s.service.offboard(s.ctx, LEAVER, { transferToUserId: 'ghost' })).rejects.toThrow('یافت نشد');

    const empty = setup({ seed: { user: baseSeed().user } });
    await expect(empty.service.offboard(empty.ctx, LEAVER, {})).resolves.toBeTruthy();
  });

  it('rejects unknown module codes in overrides', async () => {
    const s = setup();
    await expect(s.service.offboard(s.ctx, LEAVER, { transferToUserId: TARGET, perModuleOverrides: { nope: OTHER } })).rejects.toThrow('تعریف نشده');
  });

  it('warns (and refuses without explicit confirmation) when the target cannot view a module', async () => {
    const seed = baseSeed();
    seed.modulePermission = [{ id: 'mp1', roleId: 'r-all', moduleCode: 'tasks', canViewOwn: true, canViewAll: false }];
    const s = setup({ seed });
    // تارگت فقط ماژول tasks را می‌بیند؛ مخاطبین CRM را نه
    const dry = await s.service.dryRun(s.ctx, LEAVER, { transferToUserId: TARGET });
    expect(dry.requiresAcceptance).toBe(true);
    expect(dry.warnings.some((w) => w.code === 'TARGET_LACKS_ACCESS' && w.moduleCode === 'crm')).toBe(true);
    expect(dry.warnings.some((w) => w.moduleCode === 'tasks')).toBe(false);
    await expect(s.service.offboard(s.ctx, LEAVER, { transferToUserId: TARGET })).rejects.toMatchObject({ response: { code: 'TARGET_LACKS_ACCESS' } });
    expect(rows(s.tables(), 'crmContact').every((c) => c.ownerUserId !== TARGET || c.id === 'c3')).toBe(true);
    const ok = await s.service.offboard(s.ctx, LEAVER, { transferToUserId: TARGET, acceptTargetWithoutAccess: true });
    expect(ok.totals.moved).toBeGreaterThan(0);
  });
});

describe('OffboardingService.preview', () => {
  it('lists counts per module, blocking issues and suggestions (manager first)', async () => {
    const seed = baseSeed({
      employee: [
        { id: 'e1', userId: LEAVER, fullName: 'علی', managerId: 'e2' },
        { id: 'e2', userId: TARGET, fullName: 'مهدی', managerId: null },
      ],
    });
    const s = setup({ seed, leaverRole: 'OWNER' });
    const p = await s.service.preview(s.ctx, LEAVER);
    expect(p.totalOwned).toBe(2 + 1 + 1 + 2);
    expect(p.modules.map((m) => m.moduleCode).sort()).toEqual(['crm', 'tasks']);
    expect(p.blockingIssues.map((b) => b.code)).toContain('MAIN_OWNER');
    expect(p.suggestedTargets[0]).toEqual({ userId: TARGET, name: 'مهدی', reason: 'manager' });
    expect(p.warnings.map((w) => w.code)).toContain('ACTIVE_SESSIONS');
  });
});
