import { describe, expect, it } from 'vitest';
import { currentHourInTimeZone, dateOnlyInTimeZone, isConfiguredHour, matchesSchedule, matchesScheduleDay, signedOffsetDays } from './schedule-match.util.js';

// 2026-09-29 10:15 به وقت تهران (UTC+3:30) == 2026-09-29T06:45:00Z
const NOW_10AM_TEHRAN = new Date('2026-09-29T06:45:00Z');

describe('signedOffsetDays', () => {
  it('DAYS_BEFORE is a positive offset (target is in the future)', () => {
    expect(signedOffsetDays({ offsetDays: 3, unit: 'DAYS_BEFORE' })).toBe(3);
  });
  it('DAYS_AFTER is a negative offset (target is in the past — overdue)', () => {
    expect(signedOffsetDays({ offsetDays: 3, unit: 'DAYS_AFTER' })).toBe(-3);
  });
  it('SAME_DAY is always zero regardless of offsetDays', () => {
    expect(signedOffsetDays({ offsetDays: 5, unit: 'SAME_DAY' })).toBe(0);
  });
});

describe('currentHourInTimeZone / dateOnlyInTimeZone', () => {
  it('reads the Tehran hour correctly across the UTC+3:30 offset', () => {
    expect(currentHourInTimeZone(NOW_10AM_TEHRAN)).toBe(10);
  });
  it('truncates to the Tehran calendar day', () => {
    expect(dateOnlyInTimeZone(NOW_10AM_TEHRAN).toISOString()).toBe('2026-09-29T00:00:00.000Z');
  });
});

describe('isConfiguredHour', () => {
  it('matches when the hour is equal', () => {
    expect(isConfiguredHour(NOW_10AM_TEHRAN, { hour: 10 })).toBe(true);
  });
  it('does not match a different hour', () => {
    expect(isConfiguredHour(NOW_10AM_TEHRAN, { hour: 9 })).toBe(false);
  });
});

describe('matchesScheduleDay', () => {
  it('DAYS_BEFORE 3: fires when the target is exactly 3 days from now', () => {
    const target = new Date('2026-10-02T12:00:00Z'); // 3 days after 2026-09-29
    expect(matchesScheduleDay(NOW_10AM_TEHRAN, target, { offsetDays: 3, unit: 'DAYS_BEFORE' })).toBe(true);
  });
  it('DAYS_BEFORE 3: does not fire a day early or a day late (boundary)', () => {
    expect(matchesScheduleDay(NOW_10AM_TEHRAN, new Date('2026-10-01T12:00:00Z'), { offsetDays: 3, unit: 'DAYS_BEFORE' })).toBe(false);
    expect(matchesScheduleDay(NOW_10AM_TEHRAN, new Date('2026-10-03T12:00:00Z'), { offsetDays: 3, unit: 'DAYS_BEFORE' })).toBe(false);
  });
  it('SAME_DAY: fires only when the target falls today', () => {
    expect(matchesScheduleDay(NOW_10AM_TEHRAN, new Date('2026-09-29T15:00:00Z'), { offsetDays: 0, unit: 'SAME_DAY' })).toBe(true);
    expect(matchesScheduleDay(NOW_10AM_TEHRAN, new Date('2026-09-28T15:00:00Z'), { offsetDays: 0, unit: 'SAME_DAY' })).toBe(false);
  });
  it('DAYS_AFTER 2: fires when the target date is exactly 2 days in the past (overdue by 2 days)', () => {
    expect(matchesScheduleDay(NOW_10AM_TEHRAN, new Date('2026-09-27T01:00:00Z'), { offsetDays: 2, unit: 'DAYS_AFTER' })).toBe(true);
    expect(matchesScheduleDay(NOW_10AM_TEHRAN, new Date('2026-09-26T01:00:00Z'), { offsetDays: 2, unit: 'DAYS_AFTER' })).toBe(false);
  });
  it('is insensitive to time-of-day on either the now or target side', () => {
    const lateNight = new Date('2026-09-29T20:29:00Z'); // still 2026-09-29 in Tehran (23:59)
    const targetEarlyMorning = new Date('2026-10-02T00:05:00Z'); // still 2026-10-02 in Tehran (03:35)
    expect(matchesScheduleDay(lateNight, targetEarlyMorning, { offsetDays: 3, unit: 'DAYS_BEFORE' })).toBe(true);
  });
});

describe('matchesSchedule (combined hour + day gate)', () => {
  const config = { offsetDays: 3, unit: 'DAYS_BEFORE' as const, hour: 10, minute: 0 };
  it('fires only when both the hour and the day offset match', () => {
    expect(matchesSchedule(NOW_10AM_TEHRAN, new Date('2026-10-02T12:00:00Z'), config)).toBe(true);
  });
  it('does not fire outside the configured hour even if the day matches', () => {
    const wrongHour = new Date('2026-09-29T05:45:00Z'); // 09:15 Tehran
    expect(matchesSchedule(wrongHour, new Date('2026-10-02T12:00:00Z'), config)).toBe(false);
  });
  it('does not fire in the configured hour if the day does not match', () => {
    expect(matchesSchedule(NOW_10AM_TEHRAN, new Date('2026-10-05T12:00:00Z'), config)).toBe(false);
  });
});
