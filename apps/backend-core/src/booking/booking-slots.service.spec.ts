import { describe, expect, it, vi } from 'vitest';
import { BookingSlotsService } from './booking-slots.service.js';
import { BookingBlocksService } from './booking-blocks.service.js';
import { fromTehran, tehranParts } from './tehran-time.js';

describe('tehran-time', () => {
  it('converts between Tehran wall-clock and absolute time', () => {
    const d = fromTehran('2027-01-10', 12 * 60);
    expect(d.toISOString()).toBe('2027-01-10T08:30:00.000Z');
    expect(tehranParts(d)).toMatchObject({ dateKey: '2027-01-10', minutes: 720 });
  });
});

type Opts = {
  slots?: Array<{ userId: string; weekday: number; startMinute: number; endMinute: number }>;
  busy?: Array<{ providerUserId: string | null; startAt: Date; endAt: Date }>;
  manual?: Array<Record<string, unknown>>;
  prefs?: Array<Record<string, unknown>>;
  assignees?: Array<Record<string, unknown>>;
  sessions?: Array<Record<string, unknown>>;
  leaves?: Array<Record<string, unknown>>;
};

function ctxWith(opts: Opts) {
  return {
    tenantDb: {
      serviceType: { findUnique: vi.fn().mockResolvedValue({ id: 's', durationMinutes: 60 }) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1' }]) },
      staffAvailabilitySlot: { findMany: vi.fn().mockResolvedValue(opts.slots ?? []) },
      appointment: { findMany: vi.fn().mockResolvedValue(opts.busy ?? []) },
      staffTimeBlock: { findMany: vi.fn().mockResolvedValue(opts.manual ?? []) },
      staffBookingPreference: { findMany: vi.fn().mockResolvedValue(opts.prefs ?? []) },
      taskAssignee: { findMany: vi.fn().mockResolvedValue(opts.assignees ?? []) },
      mentoringSession: { findMany: vi.fn().mockResolvedValue(opts.sessions ?? []) },
      leaveRequest: { findMany: vi.fn().mockResolvedValue(opts.leaves ?? []) },
    },
  } as never;
}

describe('BookingSlotsService', () => {
  const service = new BookingSlotsService(new BookingBlocksService());
  // 2027-01-12 (سه‌شنبه): روز کاری معمولی، تعطیل رسمی نیست

  it('offers only times inside the provider weekly window', async () => {
    const date = '2027-01-12';
    const weekday = tehranParts(fromTehran(date, 720)).weekday;
    const slots = await service.listFreeSlots(ctxWith({ slots: [{ userId: 'u1', weekday, startMinute: 600, endMinute: 720 }] }), { serviceTypeId: 's', date });
    expect(slots.map((s) => s.time)).toEqual(['10:00', '10:30', '11:00']);
  });

  it('removes times that overlap an existing appointment of that provider', async () => {
    const date = '2027-01-12';
    const weekday = tehranParts(fromTehran(date, 720)).weekday;
    const busy = [{ providerUserId: 'u1', startAt: fromTehran(date, 630), endAt: fromTehran(date, 690) }];
    const slots = await service.listFreeSlots(ctxWith({ slots: [{ userId: 'u1', weekday, startMinute: 600, endMinute: 780 }], busy }), { serviceTypeId: 's', date });
    expect(slots.map((s) => s.time)).toEqual(['11:30', '12:00']);
  });

  it('is empty on Friday with default working hours', async () => {
    let friday = '2027-01-15';
    for (let i = 0; i < 7 && tehranParts(fromTehran(friday, 720)).weekday !== 5; i++) friday = `2027-01-${16 + i}`;
    const slots = await service.listFreeSlots(ctxWith({}), { serviceTypeId: 's', date: friday });
    expect(slots).toEqual([]);
  });

  describe('automatic and manual blocks', () => {
    const date = '2027-01-12';
    const weekday = tehranParts(fromTehran(date, 720)).weekday;
    const window = [{ userId: 'u1', weekday, startMinute: 600, endMinute: 780 }]; // 10:00-13:00
    const run = (o: Opts) => service.listFreeSlots(ctxWith({ slots: window, ...o }), { serviceTypeId: 's', date }).then((r) => r.map((x) => x.time));

    it('a manual all-day block removes every slot of that day, other days unaffected', async () => {
      const manual = [{ id: 'b', userId: 'u1', startDate: date, endDate: date, startMinute: null, endMinute: null, weekdays: [], reason: null }];
      expect(await run({ manual })).toEqual([]);
    });

    it('a manual hour block removes overlapping slots only', async () => {
      const manual = [{ id: 'b', userId: 'u1', startDate: '2027-01-10', endDate: '2027-01-20', startMinute: 660, endMinute: 720, weekdays: [], reason: 'جلسه' }];
      expect(await run({ manual })).toEqual(['10:00', '12:00']);
    });

    it('a manual block restricted to other weekdays does not apply', async () => {
      const other = (weekday + 1) % 7;
      const manual = [{ id: 'b', userId: 'u1', startDate: date, endDate: date, startMinute: null, endMinute: null, weekdays: [other], reason: null }];
      expect((await run({ manual })).length).toBe(5);
    });

    it('a task with startAt+dueAt blocks, and the reason is never exposed in the slot', async () => {
      const assignees = [{ userId: 'u1', task: { number: 123, status: 'IN_PROGRESS', isPublished: true, startAt: fromTehran(date, 600), dueAt: fromTehran(date, 660) } }];
      const slots = await service.listFreeSlots(ctxWith({ slots: window, assignees }), { serviceTypeId: 's', date });
      expect(slots.map((s) => s.time)).toEqual(['11:00', '11:30', '12:00']);
      expect(JSON.stringify(slots)).not.toContain('TASK');
    });

    it('a task without startAt, or longer than 12h, or inactive, does not block', async () => {
      const t = (over: Record<string, unknown>) => [{ userId: 'u1', task: { number: 1, status: 'NEW', isPublished: true, startAt: fromTehran(date, 600), dueAt: fromTehran(date, 700), ...over } }];
      expect((await run({ assignees: t({ startAt: null }) })).length).toBe(5);
      expect((await run({ assignees: t({ dueAt: new Date(fromTehran(date, 600).getTime() + 13 * 3_600_000) }) })).length).toBe(5);
      expect((await run({ assignees: t({ status: 'APPROVED' }) })).length).toBe(5);
    });

    it('a scheduled mentoring session blocks the advisor', async () => {
      const sessions = [{ status: 'SCHEDULED', scheduledAt: fromTehran(date, 720), durationMinutes: 60, engagement: { advisorUserId: 'u1', title: 'x' } }];
      expect(await run({ sessions })).toEqual(['10:00', '10:30', '11:00']);
    });

    it('approved leave blocks the whole day', async () => {
      const leaves = [{ status: 'APPROVED', startDate: new Date(`${date}T00:00:00Z`), endDate: new Date(`${date}T00:00:00Z`), employee: { userId: 'u1' } }];
      expect(await run({ leaves })).toEqual([]);
    });

    it('per-provider preference flags switch each automatic source off (manual stays)', async () => {
      const assignees = [{ userId: 'u1', task: { number: 1, status: 'NEW', isPublished: true, startAt: fromTehran(date, 600), dueAt: fromTehran(date, 780) } }];
      const sessions = [{ status: 'SCHEDULED', scheduledAt: fromTehran(date, 600), durationMinutes: 180, engagement: { advisorUserId: 'u1', title: null } }];
      const leaves = [{ status: 'APPROVED', startDate: new Date(`${date}T00:00:00Z`), endDate: new Date(`${date}T00:00:00Z`), employee: { userId: 'u1' } }];
      expect(await run({ assignees, sessions, leaves })).toEqual([]);
      const prefs = [{ userId: 'u1', blockFromTasks: false, blockFromCalendar: false, blockFromLeave: false }];
      expect((await run({ assignees, sessions, leaves, prefs })).length).toBe(5);
      const manual = [{ id: 'b', userId: 'u1', startDate: date, endDate: date, startMinute: null, endMinute: null, weekdays: [], reason: null }];
      expect(await run({ prefs, manual })).toEqual([]);
    });

    it('does not run per-provider queries (one batched query per source)', async () => {
      const ctx = ctxWith({ slots: window });
      await service.listFreeSlots(ctx, { serviceTypeId: 's', date });
      const db = (ctx as unknown as { tenantDb: Record<string, { findMany: ReturnType<typeof vi.fn> }> }).tenantDb;
      for (const k of ['staffTimeBlock', 'taskAssignee', 'mentoringSession', 'leaveRequest', 'staffBookingPreference']) expect(db[k].findMany).toHaveBeenCalledTimes(1);
    });
  });
});
