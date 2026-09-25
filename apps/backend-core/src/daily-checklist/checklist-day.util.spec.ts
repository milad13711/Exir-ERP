import { describe, expect, it } from 'vitest';
import { addDays, assertEditableDay, buildDailyReportBody, todayTehran } from './checklist-day.util.js';

describe('checklist day util', () => {
  it('uses the Tehran calendar date, not the UTC one, right around midnight', () => {
    // ۲۰:۳۰ UTC = ۰۰:۰۰ تهران (روز بعد)
    expect(todayTehran(new Date('2026-09-25T20:30:00Z')).toISOString()).toBe('2026-09-26T00:00:00.000Z');
    expect(todayTehran(new Date('2026-09-25T20:29:00Z')).toISOString()).toBe('2026-09-25T00:00:00.000Z');
  });

  it('only allows yesterday, today and tomorrow to be edited', () => {
    const now = new Date('2026-09-25T09:00:00Z');
    const day = (offset: number) => addDays(todayTehran(now), offset);
    for (const off of [-1, 0, 1]) expect(() => assertEditableDay(day(off), now)).not.toThrow();
    for (const off of [-2, 2, 10]) expect(() => assertEditableDay(day(off), now)).toThrow('دیروز، امروز و فردا');
  });

  it('marks carried-over items in the report body', () => {
    const body = buildDailyReportBody('علی', '۱۴۰۵/۰۷/۰۳', [
      { title: 'الف', description: null, done: true },
      { title: 'ب', description: 'توضیح', done: false, carriedOver: true },
    ]);
    expect(body).toContain('انجام‌شده (1 از 2)');
    expect(body).toContain('- ب — توضیح (مانده از قبل)');
  });
});
