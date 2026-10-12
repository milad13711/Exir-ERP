import { describe, expect, it } from 'vitest';
import {
  humanizeMinutes,
  selectDueForPublish,
  selectOverdueToNotify,
  selectRecurringDue,
  selectReminders,
  selectToExpire,
  startOfTehranDay,
} from './task-cron-logic.js';
import { nextOccurrence, shiftDates } from './task-recurrence.js';
import type { TaskStatusValue } from './task-state.js';

const NOW = new Date('2026-10-12T10:00:00Z');
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
function t(over: Partial<{ id: string; status: TaskStatusValue; dueAt: Date | null; isPublished: boolean; sendAt: Date | null; reminderOffsetsMin: number[]; remindersSentMin: number[]; overdueNotifiedAt: Date | null; recurrence: string; nextRecurAt: Date | null }> = {}) {
  return { id: 'x', status: 'NEW' as TaskStatusValue, dueAt: null, isPublished: true, sendAt: null, reminderOffsetsMin: [], remindersSentMin: [], overdueNotifiedAt: null, ...over };
}

describe('scheduled publish', () => {
  it('selects only unpublished tasks whose sendAt has arrived', () => {
    const rows = [
      t({ id: 'a', isPublished: false, sendAt: min(-1) }),
      t({ id: 'b', isPublished: false, sendAt: min(30) }),
      t({ id: 'c', isPublished: true, sendAt: min(-5) }),
      t({ id: 'd', isPublished: false, sendAt: min(-5), status: 'CANCELLED' }),
    ];
    expect(selectDueForPublish(rows, NOW).map((r) => r.id)).toEqual(['a']);
  });
});

describe('reminders', () => {
  it('fires when due - offset has passed, once, and only before the deadline', () => {
    const rows = [
      t({ id: 'a', dueAt: min(50), reminderOffsetsMin: [60] }),
      t({ id: 'b', dueAt: min(90), reminderOffsetsMin: [60] }),
      t({ id: 'c', dueAt: min(50), reminderOffsetsMin: [60], remindersSentMin: [60] }),
      t({ id: 'd', dueAt: min(-10), reminderOffsetsMin: [60] }),
      t({ id: 'e', dueAt: min(50), reminderOffsetsMin: [60], isPublished: false }),
      t({ id: 'f', dueAt: min(50), reminderOffsetsMin: [60], status: 'DONE' }),
    ];
    expect(selectReminders(rows, NOW).map((r) => r.task.id)).toEqual(['a']);
  });

  it('with several due offsets sends only the closest one but marks all', () => {
    const [r] = selectReminders([t({ dueAt: min(20), reminderOffsetsMin: [1440, 60, 15] })], NOW);
    expect(r.fire).toBe(60);
    expect(r.mark.sort((a, b) => a - b)).toEqual([60, 1440]);
  });
});

describe('overdue', () => {
  const rows = [
    t({ id: 'new', status: 'NEW', dueAt: min(-5) }),
    t({ id: 'prog', status: 'IN_PROGRESS', dueAt: min(-5) }),
    t({ id: 'prob', status: 'HAS_PROBLEM', dueAt: min(-5) }),
    t({ id: 'done', status: 'DONE', dueAt: min(-5) }),
    t({ id: 'appr', status: 'APPROVED', dueAt: min(-5) }),
    t({ id: 'future', status: 'NEW', dueAt: min(5) }),
    t({ id: 'notified', status: 'NEW', dueAt: min(-5), overdueNotifiedAt: min(-1) }),
    t({ id: 'unpub', status: 'NEW', dueAt: min(-5), isPublished: false }),
  ];
  it('notifies once for every open overdue task, including ones with a problem', () => {
    expect(selectOverdueToNotify(rows, NOW).map((r) => r.id).sort()).toEqual(['new', 'prob', 'prog']);
  });
  it('expires only tasks still being worked on', () => {
    expect(selectToExpire(rows, NOW).map((r) => r.id).sort()).toEqual(['new', 'notified', 'prog']);
  });
});

describe('recurrence', () => {
  it('daily/weekly add fixed intervals', () => {
    const base = new Date('2026-10-12T08:00:00Z');
    expect(nextOccurrence(base, 'DAILY', 1)?.toISOString()).toBe('2026-10-13T08:00:00.000Z');
    expect(nextOccurrence(base, 'DAILY', 3)?.toISOString()).toBe('2026-10-15T08:00:00.000Z');
    expect(nextOccurrence(base, 'WEEKLY', 2)?.toISOString()).toBe('2026-10-26T08:00:00.000Z');
    expect(nextOccurrence(base, 'NONE')).toBeNull();
  });

  it('monthly follows Jalali months and keeps the time of day', () => {
    const base = new Date(2026, 9, 12, 8, 30); // 20 Mehr 1405 (local time)
    const next = nextOccurrence(base, 'MONTHLY', 1)!;
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(30);
    const days = Math.round((next.getTime() - base.getTime()) / 86_400_000);
    expect(days).toBe(30); // Mehr has 30 days
  });

  it('selects recurring templates whose next occurrence arrived', () => {
    const rows = [
      t({ id: 'a', recurrence: 'DAILY', nextRecurAt: min(-1) }),
      t({ id: 'b', recurrence: 'DAILY', nextRecurAt: min(60) }),
      t({ id: 'c', recurrence: 'NONE', nextRecurAt: min(-1) }),
      t({ id: 'd', recurrence: 'DAILY', nextRecurAt: min(-1), status: 'CANCELLED' }),
    ];
    expect(selectRecurringDue(rows, NOW).map((r) => r.id)).toEqual(['a']);
  });

  it('shifts start/due by the same delta', () => {
    const anchor = new Date('2026-10-01T00:00:00Z');
    const next = new Date('2026-10-02T00:00:00Z');
    const s = shiftDates({ startAt: null, dueAt: new Date('2026-10-01T12:00:00Z') }, anchor, next);
    expect(s.startAt).toBeNull();
    expect(s.dueAt?.toISOString()).toBe('2026-10-02T12:00:00.000Z');
  });
});

describe('helpers', () => {
  it('startOfTehranDay is local midnight (UTC+03:30)', () => {
    expect(startOfTehranDay(new Date('2026-10-12T10:00:00Z')).toISOString()).toBe('2026-10-11T20:30:00.000Z');
    expect(startOfTehranDay(new Date('2026-10-12T21:00:00Z')).toISOString()).toBe('2026-10-12T20:30:00.000Z');
  });
  it('humanizes reminder offsets', () => {
    expect(humanizeMinutes(30)).toBe('30 دقیقه');
    expect(humanizeMinutes(120)).toBe('2 ساعت');
    expect(humanizeMinutes(2880)).toBe('2 روز');
  });
});
