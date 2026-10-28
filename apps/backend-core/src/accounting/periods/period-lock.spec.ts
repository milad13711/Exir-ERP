import { describe, expect, it, vi } from 'vitest';
import { assertPeriodOpen, assertPeriodsOpen, periodKeyOfDate } from './period-lock.js';
import { jalaliMonthRange } from './jalali-periods.js';

const dbWith = (lockedKeys: string[]) =>
  ({
    accountingPeriodLock: {
      findUnique: vi.fn(async ({ where }: any) => (lockedKeys.includes(where.periodKey) ? { isLocked: true } : null)),
    },
  }) as any;

describe('assertPeriodOpen', () => {
  const inAban = new Date(jalaliMonthRange(1405, 8).from.getTime() + 3_600_000);

  it('passes when the month is not locked', async () => {
    await expect(assertPeriodOpen(dbWith([]), inAban)).resolves.toBeUndefined();
  });

  it('rejects a date inside a locked Jalali month with a Persian 409 naming the month', async () => {
    await expect(assertPeriodOpen(dbWith(['1405-08']), inAban)).rejects.toThrow(/آبان/);
    await expect(assertPeriodOpen(dbWith(['1405-08']), inAban)).rejects.toMatchObject({ status: 409 });
  });

  it('is exact at the boundary: last ms of Mehr is Mehr, first instant of Aban is Aban', async () => {
    const aban = jalaliMonthRange(1405, 8).from;
    const db = dbWith(['1405-08']);
    await expect(assertPeriodOpen(db, new Date(aban.getTime() - 1))).resolves.toBeUndefined();
    await expect(assertPeriodOpen(db, aban)).rejects.toThrow();
  });

  it('an unlocked row (isLocked=false) does not block', async () => {
    const db = { accountingPeriodLock: { findUnique: vi.fn(async () => ({ isLocked: false })) } } as any;
    await expect(assertPeriodOpen(db, inAban)).resolves.toBeUndefined();
  });

  it('rejects invalid dates', async () => {
    await expect(assertPeriodOpen(dbWith([]), 'not-a-date')).rejects.toThrow(/نامعتبر/);
  });

  it('assertPeriodsOpen checks each distinct month once', async () => {
    const db = dbWith([]);
    await assertPeriodsOpen(db, [inAban, new Date(inAban.getTime() + 1000), jalaliMonthRange(1405, 9).from]);
    expect(db.accountingPeriodLock.findUnique).toHaveBeenCalledTimes(2);
  });

  it('periodKeyOfDate uses Tehran time', () => {
    expect(periodKeyOfDate(new Date('2026-10-22T20:29:59Z')).key).toBe('1405-07');
    expect(periodKeyOfDate(new Date('2026-10-22T20:30:00Z')).key).toBe('1405-08');
  });
});
