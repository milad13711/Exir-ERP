import { describe, expect, it, vi } from 'vitest';
import { DailyChecklistService } from './daily-checklist.service.js';
import { todayTehran } from './checklist-day.util.js';

// تاریخ‌ها باید در بازه‌ی «دیروز تا فردا» باشند؛ پس نسبت به امروز محاسبه می‌شوند.
const TODAY = todayTehran().toISOString().slice(0, 10);
const YESTERDAY = new Date(todayTehran().getTime() - 86_400_000).toISOString().slice(0, 10);

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
    dailyChecklistDayClose: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const reports = { create: vi.fn().mockResolvedValue({ id: 'report-1' }), update: vi.fn().mockResolvedValue({ id: 'report-1' }) };
  const service = new DailyChecklistService(reports as never);
  const ctx = { tenantId: 't', tenantDb, auth: { role: opts.role ?? 'MEMBER', sub: 'g-me' } } as never;
  return { service, ctx, tenantDb, reports };
}

describe('DailyChecklistService — permission boundary', () => {
  it("a plain member can create and list their own checklist without forUserId", async () => {
    const { service, ctx, tenantDb } = setup();
    await service.create(ctx, { title: 'تماس با مشتری', date: TODAY } as never);
    expect(tenantDb.dailyChecklistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'me', createdByUserId: 'me' }) }),
    );
  });

  it('a plain member cannot create an item for someone who is not their subordinate', async () => {
    const { service, ctx } = setup({ myEmployee: { id: 'emp-me' }, visibleIds: [] });
    await expect(service.create(ctx, { title: 'x', date: TODAY, forUserId: 'u-stranger' } as never)).rejects.toThrow(
      'زیردستان',
    );
  });

  it('a manager can create an item for a visible subordinate', async () => {
    const { service, ctx, tenantDb } = setup({ myEmployee: { id: 'emp-me' }, visibleIds: ['sub-1'] });
    await service.create(ctx, { title: 'گزارش موجودی', date: TODAY, forUserId: 'u-sub-1' } as never);
    expect(tenantDb.dailyChecklistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u-sub-1', createdByUserId: 'me' }) }),
    );
  });

  it('OWNER/ADMIN can act for any user without an Employee record', async () => {
    const { service, ctx, tenantDb } = setup({ role: 'OWNER', myEmployee: null });
    await service.create(ctx, { title: 'x', date: TODAY, forUserId: 'anyone' } as never);
    expect(tenantDb.dailyChecklistItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'anyone' }) }));
  });

  it('rejects a malformed date instead of silently shifting days across a server timezone', async () => {
    const { service, ctx } = setup();
    await expect(service.create(ctx, { title: 'x', date: 'not-a-date' } as never)).rejects.toThrow('تاریخ نامعتبر');
  });

  it('parses the date-only string as a calendar day, independent of server timezone', async () => {
    const { service, ctx, tenantDb } = setup();
    await service.create(ctx, { title: 'x', date: TODAY } as never);
    const call = tenantDb.dailyChecklistItem.create.mock.calls[0][0];
    const stored = call.data.date as Date;
    expect(stored.toISOString()).toBe(`${TODAY}T00:00:00.000Z`);
  });
});

describe('DailyChecklistService.create — day already closed', () => {
  // باگ واقعی که این تست بازتولید می‌کند: گزارش روز به‌اشتباه خیلی زود (مثلاً چند دقیقه
  // بعد از نیمه‌شب) ثبت شده و روز را «بسته» کرده؛ بعد در ادامه‌ی همان روز آیتم‌های
  // واقعی (از جمله فوری‌ها) اضافه می‌شوند — و چون closeDays روزهای rolledOver را دیگر
  // بررسی نمی‌کند، این آیتم‌ها بدون این رفتار هرگز به فردا منتقل نمی‌شدند.
  it('immediately forwards a copy of the new item to tomorrow when its day was already closed', async () => {
    const { service, ctx, tenantDb } = setup();
    (tenantDb.dailyChecklistDayClose.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ rolledOver: true });
    await service.create(ctx, { title: 'پیگیری قرارداد فوری', date: TODAY, priority: 'URGENT' } as never);

    const calls = tenantDb.dailyChecklistItem.create.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].data).toMatchObject({ date: new Date(`${TODAY}T00:00:00.000Z`), title: 'پیگیری قرارداد فوری' });
    const tomorrow = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() + 86_400_000);
    expect(calls[1][0].data).toMatchObject({ date: tomorrow, title: 'پیگیری قرارداد فوری', carriedOver: true, priority: 'URGENT' });
    // نباید وضعیت «بسته‌بودن» روز را دست بزند — همان‌طور که هست باقی می‌ماند تا جاروب بعدی گزارش را به‌روزرسانی کند، نه دوباره‌سازی.
    expect(tenantDb.dailyChecklistDayClose.upsert).not.toHaveBeenCalled();
  });

  it('does not forward the item when the day is still open (normal case)', async () => {
    const { service, ctx, tenantDb } = setup();
    await service.create(ctx, { title: 'کار عادی', date: TODAY } as never);
    expect(tenantDb.dailyChecklistItem.create).toHaveBeenCalledTimes(1);
  });
});

describe('DailyChecklistService.generateReport', () => {
  it('refuses to generate a report for an empty day', async () => {
    const { service, ctx } = setup();
    await expect(service.generateReport(ctx, { date: TODAY } as never)).rejects.toThrow('خالی است');
  });

  it('compiles done/pending items into a report body and rolls pending work forward, for a day that is actually over', async () => {
    const { service, ctx, tenantDb, reports } = setup();
    const all = [
      { id: '1', title: 'تماس با مشتری', description: null, done: true },
      { id: '2', title: 'ارسال فاکتور', description: 'برای شرکت الف', done: false, createdByUserId: 'me' },
    ];
    tenantDb.dailyChecklistItem.findMany = vi.fn(async (args?: { where?: { done?: boolean } }) => (args?.where?.done === false ? all.filter((i) => !i.done) : all)) as never;
    (tenantDb.dailyChecklistItem as unknown as Record<string, unknown>).findFirst = vi.fn().mockResolvedValue(null);
    (tenantDb.dailyChecklistItem as unknown as Record<string, unknown>).createMany = vi.fn().mockResolvedValue({ count: 1 });
    // اولین صدا resolveTenantUserId (بر اساس globalUserId) است؛ دومی نام کاربر برای متن گزارش.
    tenantDb.user.findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'me', globalUserId: 'g-me' })
      .mockResolvedValueOnce({ name: 'علی رضایی' });
    const dayClose = { upsert: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) };
    (tenantDb as unknown as { dailyChecklistDayClose: typeof dayClose }).dailyChecklistDayClose = dayClose;
    await service.generateReport(ctx, { date: YESTERDAY } as never);
    expect(reports.create).toHaveBeenCalledTimes(1);
    expect(dayClose.upsert).toHaveBeenCalledTimes(1);
    expect(dayClose.upsert.mock.calls[0][0].create).toMatchObject({ rolledOver: true });
    // کار انجام‌نشده همان لحظه به فردا منتقل می‌شود — چون این روز واقعاً تمام شده
    const createMany = (tenantDb.dailyChecklistItem as unknown as { createMany: ReturnType<typeof vi.fn> }).createMany;
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0].data[0]).toMatchObject({ carriedOver: true, title: 'ارسال فاکتور' });
    const body = reports.create.mock.calls[0][1].body as string;
    expect(body).toContain('تماس با مشتری');
    expect(body).toContain('ارسال فاکتور — برای شرکت الف');
    expect(body).toContain('انجام‌شده (1 از 2)');
  });

  it('updates the existing report instead of creating a duplicate when the day was already reported', async () => {
    const { service, ctx, tenantDb, reports } = setup();
    const all = [{ id: '1', title: 'تماس با مشتری', description: null, done: true }];
    tenantDb.dailyChecklistItem.findMany = vi.fn().mockResolvedValue(all) as never;
    tenantDb.user.findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'me', globalUserId: 'g-me' })
      .mockResolvedValueOnce({ name: 'علی رضایی' });
    const dayClose = {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ reportId: 'report-1', rolledOver: true }),
    };
    (tenantDb as unknown as { dailyChecklistDayClose: typeof dayClose }).dailyChecklistDayClose = dayClose;
    const report = await service.generateReport(ctx, { date: YESTERDAY } as never);
    expect(reports.create).not.toHaveBeenCalled();
    expect(reports.update).toHaveBeenCalledTimes(1);
    expect(reports.update.mock.calls[0][1]).toBe('report-1');
    expect(report).toEqual({ id: 'report-1' });
    expect(dayClose.upsert.mock.calls[0][0].update).toMatchObject({ reportId: 'report-1', rolledOver: true });
  });

  // باگ گزارش‌شده: کاربر چند بار در طول روز دکمه‌ی «ثبت گزارش» را زد، و بعد از آخرین
  // کلیک هم کار تازه اضافه کرد؛ سیستم باید حتماً آخر شب (توسط خودِ کرون، نه این کلیک‌های
  // دستی) دوباره گزارش را با وضعیت واقعیِ نهایی به‌روز کند. پس ثبتِ دستی برای «امروز»
  // نباید روز را قفل کند یا الان چیزی را به فردا منتقل کند — فقط یک پیش‌نمایش زنده است.
  it('a manual report for TODAY only previews the report — does not close the day or roll anything forward yet', async () => {
    const { service, ctx, tenantDb, reports } = setup();
    const all = [
      { id: '1', title: 'تماس با مشتری', description: null, done: true },
      { id: '2', title: 'کار فوری باقی‌مانده', description: null, done: false, priority: 'URGENT' },
    ];
    tenantDb.dailyChecklistItem.findMany = vi.fn().mockResolvedValue(all) as never;
    tenantDb.user.findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'me', globalUserId: 'g-me' })
      .mockResolvedValueOnce({ name: 'علی رضایی' });
    const dayClose = { upsert: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) };
    (tenantDb as unknown as { dailyChecklistDayClose: typeof dayClose }).dailyChecklistDayClose = dayClose;
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    (tenantDb.dailyChecklistItem as unknown as Record<string, unknown>).createMany = createMany;

    await service.generateReport(ctx, { date: TODAY } as never);

    expect(reports.create).toHaveBeenCalledTimes(1); // گزارش ساخته/به‌روز می‌شود...
    expect(createMany).not.toHaveBeenCalled(); // ...ولی چیزی به فردا منتقل نمی‌شود...
    expect(dayClose.upsert.mock.calls[0][0].create).toMatchObject({ rolledOver: false }); // ...و روز «باز» می‌ماند تا کرون آخر شب واقعاً ببندش.
  });

  it('a second manual click the same day for TODAY still just updates the same report, still without closing the day', async () => {
    const { service, ctx, tenantDb, reports } = setup();
    const all = [{ id: '1', title: 'کار جدید', description: null, done: false }];
    tenantDb.dailyChecklistItem.findMany = vi.fn().mockResolvedValue(all) as never;
    tenantDb.user.findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'me', globalUserId: 'g-me' })
      .mockResolvedValueOnce({ name: 'علی رضایی' });
    // یک ثبتِ دستیِ قبلیِ همین «امروز» — گزارش دارد ولی rolledOver هنوز false است.
    const dayClose = {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ reportId: 'report-1', rolledOver: false }),
    };
    (tenantDb as unknown as { dailyChecklistDayClose: typeof dayClose }).dailyChecklistDayClose = dayClose;
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    (tenantDb.dailyChecklistItem as unknown as Record<string, unknown>).createMany = createMany;

    await service.generateReport(ctx, { date: TODAY } as never);

    expect(reports.update).toHaveBeenCalledTimes(1);
    expect(reports.update.mock.calls[0][1]).toBe('report-1');
    expect(createMany).not.toHaveBeenCalled();
    expect(dayClose.upsert.mock.calls[0][0].update).toMatchObject({ rolledOver: false });
  });
});
