import { describe, expect, it } from 'vitest';
import { buildRemindAt, dueAlerts, isMissed, leadsAlreadyPast, nextOccurrence, normalizeLeads, tehranHHmm, type ReminderLike } from './reminder-logic.js';

const base = (o: Partial<ReminderLike> = {}): ReminderLike => ({
  id: 'r1',
  status: 'PENDING',
  remindAt: new Date('2026-10-14T10:30:00Z'), // 14:00 Tehran
  snoozedUntil: null,
  leadMinutes: [0],
  alertsSentMin: [],
  repeatRule: 'NONE',
  nextSpawned: false,
  ...o,
});
const at = (iso: string) => new Date(iso);

describe('buildRemindAt', () => {
  it('interprets time as Tehran wall-clock', () => {
    expect(buildRemindAt('2026-10-14', '14:00', false).toISOString()).toBe('2026-10-14T10:30:00.000Z');
    expect(tehranHHmm(buildRemindAt('2026-10-14', '07:05', false))).toBe('07:05');
  });
  it('all-day fires at 08:00 Tehran', () => {
    expect(tehranHHmm(buildRemindAt('2026-10-14', undefined, true))).toBe('08:00');
  });
  it('rejects bad time', () => {
    expect(() => buildRemindAt('2026-10-14', '25:00', false)).toThrow();
  });
});

describe('dueAlerts', () => {
  it('not due before the time, due at the time', () => {
    expect(dueAlerts(base(), at('2026-10-14T10:29:59Z'))).toEqual([]);
    expect(dueAlerts(base(), at('2026-10-14T10:30:00Z'))).toEqual([0]);
  });
  it('pre-alerts fire at remindAt - lead and only before the due time', () => {
    const r = base({ leadMinutes: [60, 10, 0] });
    expect(dueAlerts(r, at('2026-10-14T09:30:00Z'))).toEqual([60]);
    expect(dueAlerts(r, at('2026-10-14T10:20:00Z'))).toEqual([60, 10]);
    expect(dueAlerts(r, at('2026-10-14T10:31:00Z'))).toEqual([0]); // پیش‌هشدارهای کهنه حذف
  });
  it('catch-up: fires within 1 hour after downtime, not after', () => {
    expect(dueAlerts(base(), at('2026-10-14T11:29:00Z'))).toEqual([0]);
    expect(dueAlerts(base(), at('2026-10-14T11:30:00Z'))).toEqual([]);
  });
  it('idempotent: already-sent offsets are skipped', () => {
    expect(dueAlerts(base({ alertsSentMin: [0] }), at('2026-10-14T10:31:00Z'))).toEqual([]);
  });
  it('done reminders never fire', () => {
    expect(dueAlerts(base({ status: 'DONE' }), at('2026-10-14T10:31:00Z'))).toEqual([]);
  });
  it('snooze moves the main alarm and suppresses pre-alerts', () => {
    const r = base({ leadMinutes: [10, 0], alertsSentMin: [10, 0], snoozedUntil: at('2026-10-14T10:45:00Z') });
    const re = { ...r, alertsSentMin: [10] }; // snooze پاک‌کننده‌ی ۰
    expect(dueAlerts(re, at('2026-10-14T10:44:00Z'))).toEqual([]);
    expect(dueAlerts(re, at('2026-10-14T10:45:00Z'))).toEqual([0]);
  });
});

describe('leads', () => {
  it('normalizes: unknown dropped, default 0, sorted desc', () => {
    expect(normalizeLeads([10, 7, 1440])).toEqual([1440, 10]);
    expect(normalizeLeads([])).toEqual([0]);
    expect(normalizeLeads(undefined)).toEqual([0]);
  });
  it('leads already past at creation are pre-marked', () => {
    expect(leadsAlreadyPast(at('2026-10-14T10:30:00Z'), [1440, 60, 10, 0], at('2026-10-14T10:00:00Z'))).toEqual([1440, 60]);
  });
});

describe('nextOccurrence', () => {
  const r = at('2026-10-14T10:30:00Z');
  it('daily/weekly keep the Tehran wall-clock time', () => {
    expect(nextOccurrence(r, 'DAILY', r)?.toISOString()).toBe('2026-10-15T10:30:00.000Z');
    expect(nextOccurrence(r, 'WEEKLY', r)?.toISOString()).toBe('2026-10-21T10:30:00.000Z');
  });
  it('monthly clamps to month end', () => {
    expect(nextOccurrence(at('2026-01-31T10:30:00Z'), 'MONTHLY', at('2026-01-31T10:30:00Z'))?.toISOString()).toBe('2026-02-28T10:30:00.000Z');
  });
  it('skips ahead past long downtime', () => {
    expect(nextOccurrence(r, 'DAILY', at('2026-10-20T12:00:00Z'))?.toISOString()).toBe('2026-10-21T10:30:00.000Z');
  });
  it('NONE has no next', () => {
    expect(nextOccurrence(r, 'NONE', r)).toBeNull();
  });
});

describe('isMissed', () => {
  it('only when main alarm never fired and the window has passed', () => {
    expect(isMissed(base(), at('2026-10-14T11:31:00Z'))).toBe(true);
    expect(isMissed(base(), at('2026-10-14T11:00:00Z'))).toBe(false);
    expect(isMissed(base({ alertsSentMin: [0] }), at('2026-10-14T13:00:00Z'))).toBe(false);
  });
});
