import { describe, expect, it } from 'vitest';
import {
  fiscalYearMonths,
  fiscalYearOf,
  fiscalYearRange,
  jalaliMonthRange,
  monthsEndingAt,
  parsePeriodKey,
  resolveAsOf,
  resolvePeriod,
  shiftMonth,
  toJalaliTehran,
} from './jalali-periods.js';

const DAY = 86_400_000;

describe('jalali month ranges (Tehran time, UTC instants)', () => {
  it('1 Farvardin 1405 starts at Tehran midnight of 21 March 2026', () => {
    expect(jalaliMonthRange(1405, 1).from.toISOString()).toBe('2026-03-20T20:30:00.000Z');
  });

  it('month lengths: 31 for 1-6, 30 for 7-11', () => {
    for (let m = 1; m <= 11; m += 1) {
      const r = jalaliMonthRange(1405, m);
      expect(Math.round((r.toExclusive.getTime() - r.from.getTime()) / DAY)).toBe(m <= 6 ? 31 : 30);
    }
  });

  it('Esfand is 30 days in leap year 1403 and 29 in 1404', () => {
    const e1403 = jalaliMonthRange(1403, 12);
    const e1404 = jalaliMonthRange(1404, 12);
    expect(Math.round((e1403.toExclusive.getTime() - e1403.from.getTime()) / DAY)).toBe(30);
    expect(Math.round((e1404.toExclusive.getTime() - e1404.from.getTime()) / DAY)).toBe(29);
  });

  it('twelve months tile the year with no gaps or overlaps', () => {
    for (const y of [1403, 1404, 1405]) {
      let cursor = jalaliMonthRange(y, 1).from.getTime();
      for (let m = 1; m <= 12; m += 1) {
        const r = jalaliMonthRange(y, m);
        expect(r.from.getTime()).toBe(cursor);
        cursor = r.toExclusive.getTime();
      }
      expect(cursor).toBe(jalaliMonthRange(y + 1, 1).from.getTime());
    }
  });

  it('boundary instants belong to exactly one month (1 ms before = previous month)', () => {
    const aban = jalaliMonthRange(1405, 8);
    expect(toJalaliTehran(new Date(aban.from.getTime() - 1))).toMatchObject({ year: 1405, month: 7, day: 30 });
    expect(toJalaliTehran(aban.from)).toMatchObject({ year: 1405, month: 8, day: 1 });
  });

  it('last second of Esfand 29 (1404) is still Esfand; next instant is Farvardin 1405', () => {
    const e = jalaliMonthRange(1404, 12);
    expect(toJalaliTehran(new Date(e.toExclusive.getTime() - 1))).toMatchObject({ year: 1404, month: 12, day: 29 });
    expect(toJalaliTehran(e.toExclusive)).toMatchObject({ year: 1405, month: 1, day: 1 });
  });

  it('Esfand 30 exists in 1403', () => {
    const e = jalaliMonthRange(1403, 12);
    expect(toJalaliTehran(new Date(e.toExclusive.getTime() - 1))).toMatchObject({ year: 1403, month: 12, day: 30 });
  });
});

describe('fiscal year', () => {
  it('default (Farvardin start) spans the calendar year', () => {
    const r = fiscalYearRange(1405, 1);
    expect(r.from.getTime()).toBe(jalaliMonthRange(1405, 1).from.getTime());
    expect(r.toExclusive.getTime()).toBe(jalaliMonthRange(1406, 1).from.getTime());
  });

  it('Mehr start: fiscal year 1405 = Mehr 1405 .. Shahrivar 1406', () => {
    const months = fiscalYearMonths(1405, 7);
    expect(months[0]).toMatchObject({ year: 1405, month: 7 });
    expect(months[5]).toMatchObject({ year: 1405, month: 12 });
    expect(months[6]).toMatchObject({ year: 1406, month: 1 });
    expect(months[11]).toMatchObject({ year: 1406, month: 6 });
  });

  it('fiscalYearOf follows the start month', () => {
    const aban1405 = jalaliMonthRange(1405, 8).from;
    const farvardin1406 = jalaliMonthRange(1406, 1).from;
    expect(fiscalYearOf(aban1405, 1)).toBe(1405);
    expect(fiscalYearOf(aban1405, 7)).toBe(1405);
    expect(fiscalYearOf(farvardin1406, 7)).toBe(1405);
    expect(fiscalYearOf(farvardin1406, 1)).toBe(1406);
  });
});

describe('resolvePeriod', () => {
  const now = new Date('2026-10-28T10:00:00Z'); // 6 Aban 1405

  it('defaults to the current Jalali month', () => {
    const p = resolvePeriod({}, { now });
    expect(p.mode).toBe('month');
    expect(p.key).toBe('1405-08');
    expect(p.label).toContain('آبان');
    expect(p.from.getTime()).toBe(jalaliMonthRange(1405, 8).from.getTime());
  });

  it('period=YYYY-MM selects that month; fiscalYearStart is Farvardin 1405', () => {
    const p = resolvePeriod({ period: '1405-07' });
    expect(p.key).toBe('1405-07');
    expect(p.toExclusive.getTime()).toBe(jalaliMonthRange(1405, 8).from.getTime());
    expect(p.fiscalYearStart.getTime()).toBe(jalaliMonthRange(1405, 1).from.getTime());
  });

  it('period=all is cumulative with no fiscal opening', () => {
    const p = resolvePeriod({ period: 'all' });
    expect(p.mode).toBe('all');
    expect(p.from.getTime()).toBe(0);
    expect(p.fiscalYearStart.getTime()).toBe(0);
  });

  it('fiscalYear param covers the full fiscal year', () => {
    const p = resolvePeriod({ fiscalYear: '1405' }, { startMonth: 7 });
    expect(p.from.getTime()).toBe(jalaliMonthRange(1405, 7).from.getTime());
    expect(p.toExclusive.getTime()).toBe(jalaliMonthRange(1406, 7).from.getTime());
  });

  it('custom date-only `to` includes the whole Tehran day', () => {
    const p = resolvePeriod({ from: '2026-10-23', to: '2026-10-23' });
    expect(p.toExclusive.getTime() - p.from.getTime()).toBe(DAY);
    expect(p.from.toISOString()).toBe('2026-10-22T20:30:00.000Z');
  });

  it('rejects inverted ranges and bad keys', () => {
    expect(() => resolvePeriod({ from: '2026-10-30', to: '2026-10-01' })).toThrow();
    expect(() => parsePeriodKey('1405-13')).toThrow();
    expect(() => parsePeriodKey('abc')).toThrow();
  });

  it('asOf resolves to end of the selected period', () => {
    const r = resolveAsOf({ period: '1405-07' });
    expect(r.asOfExclusive.getTime()).toBe(jalaliMonthRange(1405, 8).from.getTime());
  });
});

describe('month helpers', () => {
  it('monthsEndingAt crosses the year boundary', () => {
    expect(monthsEndingAt({ year: 1405, month: 2 }, 4)).toEqual([
      { year: 1404, month: 11 },
      { year: 1404, month: 12 },
      { year: 1405, month: 1 },
      { year: 1405, month: 2 },
    ]);
  });
  it('shiftMonth -12 = same month last year', () => {
    expect(shiftMonth({ year: 1405, month: 8 }, -12)).toEqual({ year: 1404, month: 8 });
    expect(shiftMonth({ year: 1405, month: 1 }, -1)).toEqual({ year: 1404, month: 12 });
  });
});
