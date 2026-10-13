import { describe, expect, it } from 'vitest';
import { applyPreferences, expandManualBlock, isBlocked, leaveToBusyRange, mentoringSessionToBusyRange, overlaps, taskToBusyRange, validateManualBlockInput, type ManualBlockRow } from './booking-blocks.js';
import { fromTehran, tehranParts } from './tehran-time.js';

const d = (iso: string) => new Date(iso);

describe('overlaps / isBlocked', () => {
  it('half-open intervals: touching ends do not overlap', () => {
    expect(overlaps(d('2027-01-01T10:00Z'), d('2027-01-01T11:00Z'), d('2027-01-01T11:00Z'), d('2027-01-01T12:00Z'))).toBe(false);
    expect(overlaps(d('2027-01-01T10:00Z'), d('2027-01-01T11:01Z'), d('2027-01-01T11:00Z'), d('2027-01-01T12:00Z'))).toBe(true);
    expect(overlaps(d('2027-01-01T08:00Z'), d('2027-01-01T20:00Z'), d('2027-01-01T11:00Z'), d('2027-01-01T12:00Z'))).toBe(true);
  });
  it('isBlocked checks any range', () => {
    expect(isBlocked([{ start: d('2027-01-01T10:00Z'), end: d('2027-01-01T11:00Z') }], d('2027-01-01T10:30Z'), d('2027-01-01T11:30Z'))).toBe(true);
    expect(isBlocked([], d('2027-01-01T10:30Z'), d('2027-01-01T11:30Z'))).toBe(false);
  });
});

const base: ManualBlockRow = { id: 'b', userId: 'u', startDate: '2027-01-10', endDate: '2027-01-12', startMinute: 600, endMinute: 660, weekdays: [], reason: null };

describe('expandManualBlock', () => {
  it('expands one range per day inside the requested window (Tehran time)', () => {
    const r = expandManualBlock(base, '2027-01-01', '2027-01-31');
    expect(r).toHaveLength(3);
    expect(r[0].start.toISOString()).toBe(fromTehran('2027-01-10', 600).toISOString());
    expect(r[0].end.toISOString()).toBe(fromTehran('2027-01-10', 660).toISOString());
  });
  it('clips to the window', () => {
    expect(expandManualBlock(base, '2027-01-11', '2027-01-11')).toHaveLength(1);
    expect(expandManualBlock(base, '2027-02-01', '2027-02-02')).toHaveLength(0);
  });
  it('all-day covers 24h of the Tehran day', () => {
    const [r] = expandManualBlock({ ...base, startMinute: null, endMinute: null, endDate: '2027-01-10' }, '2027-01-10', '2027-01-10');
    expect(r.end.getTime() - r.start.getTime()).toBe(24 * 3_600_000);
    expect(tehranParts(r.start)).toMatchObject({ dateKey: '2027-01-10', minutes: 0 });
  });
  it('weekday filter keeps only matching weekdays', () => {
    const wd = tehranParts(fromTehran('2027-01-11', 720)).weekday;
    const r = expandManualBlock({ ...base, weekdays: [wd] }, '2027-01-01', '2027-01-31');
    expect(r).toHaveLength(1);
    expect(tehranParts(r[0].start).dateKey).toBe('2027-01-11');
  });
  it('reason text is carried for manager view', () => {
    const [r] = expandManualBlock({ ...base, reason: 'سفر' }, '2027-01-10', '2027-01-10');
    expect(r.reason).toContain('سفر');
  });
});

describe('source mappings', () => {
  const t = { number: 123, status: 'IN_PROGRESS', isPublished: true, startAt: d('2027-01-10T06:00Z'), dueAt: d('2027-01-10T08:00Z') };
  it('task: active+published+both dates+<=12h blocks with TASK-000123 reason', () => {
    const r = taskToBusyRange(t, 'u');
    expect(r).toMatchObject({ source: 'task', userId: 'u', reason: 'به‌دلیل وظیفه TASK-000123' });
    expect(r!.start).toEqual(t.startAt);
  });
  it.each(['NEW', 'SEEN', 'IN_PROGRESS', 'RETURNED_FOR_FIX', 'HAS_PROBLEM'])('task status %s blocks', (status) => {
    expect(taskToBusyRange({ ...t, status }, 'u')).not.toBeNull();
  });
  it.each(['DONE', 'APPROVED', 'EXPIRED', 'CANCELLED', 'OPEN'])('task status %s does not block', (status) => {
    expect(taskToBusyRange({ ...t, status }, 'u')).toBeNull();
  });
  it('task: unpublished, missing startAt/dueAt, inverted, or >12h do not block; exactly 12h does', () => {
    expect(taskToBusyRange({ ...t, isPublished: false }, 'u')).toBeNull();
    expect(taskToBusyRange({ ...t, startAt: null }, 'u')).toBeNull();
    expect(taskToBusyRange({ ...t, dueAt: null }, 'u')).toBeNull();
    expect(taskToBusyRange({ ...t, dueAt: t.startAt }, 'u')).toBeNull();
    expect(taskToBusyRange({ ...t, dueAt: d('2027-01-10T18:00:01Z') }, 'u')).toBeNull();
    expect(taskToBusyRange({ ...t, dueAt: d('2027-01-10T18:00:00Z') }, 'u')).not.toBeNull();
  });
  it('mentoring: only SCHEDULED sessions, with duration', () => {
    const s = { status: 'SCHEDULED', scheduledAt: d('2027-01-10T06:00Z'), durationMinutes: 45, engagementTitle: 'برنامه' };
    const r = mentoringSessionToBusyRange(s, 'adv');
    expect(r).toMatchObject({ source: 'calendar', userId: 'adv' });
    expect(r!.end.toISOString()).toBe('2027-01-10T06:45:00.000Z');
    expect(mentoringSessionToBusyRange({ ...s, status: 'CANCELLED' }, 'adv')).toBeNull();
    expect(mentoringSessionToBusyRange({ ...s, status: 'COMPLETED' }, 'adv')).toBeNull();
  });
  it('leave: approved only, inclusive all-day Tehran range', () => {
    const l = { status: 'APPROVED', startDate: d('2027-01-10T00:00:00Z'), endDate: d('2027-01-11T00:00:00Z') };
    const r = leaveToBusyRange(l, 'u')!;
    expect(r.source).toBe('leave');
    expect(r.start.toISOString()).toBe(fromTehran('2027-01-10', 0).toISOString());
    expect(r.end.toISOString()).toBe(new Date(fromTehran('2027-01-11', 0).getTime() + 24 * 3_600_000).toISOString());
    expect(leaveToBusyRange({ ...l, status: 'PENDING' }, 'u')).toBeNull();
    expect(leaveToBusyRange({ ...l, status: 'REJECTED' }, 'u')).toBeNull();
  });
});

describe('applyPreferences', () => {
  const mk = (source: 'manual' | 'task' | 'calendar' | 'leave', userId = 'u') => ({ userId, start: new Date(), end: new Date(), source, reason: '' });
  const all = [mk('manual'), mk('task'), mk('calendar'), mk('leave')];
  it('defaults to everything on', () => {
    expect(applyPreferences(all, new Map())).toHaveLength(4);
  });
  it('each flag drops only its source; manual always stays; prefs are per user', () => {
    const prefs = new Map([['u', { blockFromTasks: false, blockFromCalendar: true, blockFromLeave: false }]]);
    expect(applyPreferences(all, prefs).map((r) => r.source)).toEqual(['manual', 'calendar']);
    expect(applyPreferences([mk('task', 'other')], prefs)).toHaveLength(1);
  });
});

describe('validateManualBlockInput', () => {
  const ok = { startDate: '2027-01-10', endDate: '2027-01-12', startMinute: 600, endMinute: 660, weekdays: [1, 2], reason: 'x' };
  it('accepts valid input and all-day', () => {
    expect(validateManualBlockInput(ok)).toBeNull();
    expect(validateManualBlockInput({ ...ok, startMinute: null, endMinute: null })).toBeNull();
  });
  it('rejects bad dates, end<start, huge ranges', () => {
    expect(validateManualBlockInput({ ...ok, startDate: '1405/01/01' })).toBeTruthy();
    expect(validateManualBlockInput({ ...ok, startDate: '2027-13-40' })).toBeTruthy();
    expect(validateManualBlockInput({ ...ok, endDate: '2027-01-09' })).toBeTruthy();
    expect(validateManualBlockInput({ ...ok, endDate: '2029-01-12' })).toBeTruthy();
  });
  it('rejects bad time ranges, half-specified times, bad weekdays, long reason', () => {
    expect(validateManualBlockInput({ ...ok, endMinute: 600 })).toBeTruthy();
    expect(validateManualBlockInput({ ...ok, endMinute: 1500 })).toBeTruthy();
    expect(validateManualBlockInput({ ...ok, endMinute: null })).toBeTruthy();
    expect(validateManualBlockInput({ ...ok, weekdays: [7] })).toBeTruthy();
    expect(validateManualBlockInput({ ...ok, weekdays: [1, 1] })).toBeTruthy();
    expect(validateManualBlockInput({ ...ok, reason: 'x'.repeat(201) })).toBeTruthy();
  });
});
