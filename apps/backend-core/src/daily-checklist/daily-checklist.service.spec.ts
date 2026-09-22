import { describe, expect, it, vi } from 'vitest';
import { DailyChecklistService } from './daily-checklist.service.js';

function setup(opts: { role?: 'OWNER' | 'ADMIN' | 'MEMBER'; myEmployee?: { id: string } | null; visibleIds?: string[] } = {}) {
  const items = new Map<string, Record<string, unknown>>();
  const tenantDb = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'me', globalUserId: 'g-me' }), findMany: vi.fn() },
    employee: {
      findUnique: vi.fn().mockResolvedValue(opts.myEmployee ?? null),
      findMany: vi.fn().mockResolvedValue((opts.visibleIds ?? []).map((id) => ({ id, fullName: `کارمند ${id}`, userId: `u-${id}` }))),
    },
    department: { findMany: vi.fn().mockResolvedValue([]) },
    dailyChecklistItem: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn((args: { where: { id: string } }) => Promise.resolve(items.get(args.where.id) ?? null)),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        const row = { id: 'item-1', ...args.data };
        items.set(row.id, row);
        return Promise.resolve(row);
      }),
      update: vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) => Promise.resolve({ ...items.get(args.where.id), ...args.data })),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  const reports = { create: vi.fn().mockResolvedValue({ id: 'report-1' }) };
  const service = new DailyChecklistService(reports as never);
  const ctx = { tenantId: 't', tenantDb, auth: { role: opts.role ?? 'MEMBER', sub: 'g-me' } } as never;
  return { service, ctx, tenantDb, reports };
}

describe('DailyChecklistService — permission boundary', () => {
  it("a plain member can create and list their own checklist without forUserId", async () => {
    const { service, ctx, tenantDb } = setup();
    await service.create(ctx, { title: 'تماس با مشتری', date: '2026-09-22' } as never);
    expect(tenantDb.dailyChecklistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'me', createdByUserId: 'me' }) }),
    );
  });

  it('a plain member cannot create an item for someone who is not their subordinate', async () => {
    const { service, ctx } = setup({ myEmployee: { id: 'emp-me' }, visibleIds: [] });
    await expect(service.create(ctx, { title: 'x', date: '2026-09-22', forUserId: 'u-stranger' } as never)).rejects.toThrow(
      'زیردستان',
    );
  });

  it('a manager can create an item for a visible subordinate', async () => {
    const { service, ctx, tenantDb } = setup({ myEmployee: { id: 'emp-me' }, visibleIds: ['sub-1'] });
    await service.create(ctx, { title: 'گزارش موجودی', date: '2026-09-22', forUserId: 'u-sub-1' } as never);
    expect(tenantDb.dailyChecklistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u-sub-1', createdByUserId: 'me' }) }),
    );
  });

  it('OWNER/ADMIN can act for any user without an Employee record', async () => {
    const { service, ctx, tenantDb } = setup({ role: 'OWNER', myEmployee: null });
    await service.create(ctx, { title: 'x', date: '2026-09-22', forUserId: 'anyone' } as never);
    expect(tenantDb.dailyChecklistItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'anyone' }) }));
  });

  it('rejects a malformed date instead of silently shifting days across a server timezone', async () => {
    const { service, ctx } = setup();
    await expect(service.create(ctx, { title: 'x', date: 'not-a-date' } as never)).rejects.toThrow('تاریخ نامعتبر');
  });

  it('parses the date-only string as a calendar day, independent of server timezone', async () => {
    const { service, ctx, tenantDb } = setup();
    await service.create(ctx, { title: 'x', date: '2026-01-05' } as never);
    const call = tenantDb.dailyChecklistItem.create.mock.calls[0][0];
    const stored = call.data.date as Date;
    expect(stored.toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });
});

describe('DailyChecklistService.generateReport', () => {
  it('refuses to generate a report for an empty day', async () => {
    const { service, ctx } = setup();
    await expect(service.generateReport(ctx, { date: '2026-09-22' } as never)).rejects.toThrow('خالی است');
  });

  it('compiles done/pending items into a report body and delegates to ReportsService', async () => {
    const { service, ctx, tenantDb, reports } = setup();
    tenantDb.dailyChecklistItem.findMany = vi.fn().mockResolvedValue([
      { id: '1', title: 'تماس با مشتری', description: null, done: true },
      { id: '2', title: 'ارسال فاکتور', description: 'برای شرکت الف', done: false },
    ]);
    // اولین صدا resolveTenantUserId (بر اساس globalUserId) است؛ دومی نام کاربر برای متن گزارش.
    tenantDb.user.findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'me', globalUserId: 'g-me' })
      .mockResolvedValueOnce({ name: 'علی رضایی' });
    await service.generateReport(ctx, { date: '2026-09-22' } as never);
    expect(reports.create).toHaveBeenCalledTimes(1);
    const body = reports.create.mock.calls[0][1].body as string;
    expect(body).toContain('تماس با مشتری');
    expect(body).toContain('ارسال فاکتور — برای شرکت الف');
    expect(body).toContain('انجام‌شده (1 از 2)');
  });
});
