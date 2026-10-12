import { describe, expect, it } from 'vitest';
import {
  attentionScore,
  buildCsv,
  buildTrend,
  clampDays,
  computeRangeStats,
  computeWorkload,
  counterFromStatuses,
  csvCell,
  parseRange,
  rankAttention,
  sortWorkload,
  startOfTehranWeek,
  tehranDayKey,
  workloadChips,
  type WorkloadTask,
} from './operations-logic.js';

const H = 3_600_000;
const D = 24 * H;
const now = new Date('2026-10-12T09:00:00Z'); // دوشنبه ۲۰ مهر ۱۴۰۵، ۱۲:۳۰ تهران

describe('time helpers', () => {
  it('week starts on Saturday (Tehran)', () => {
    // 2026-10-12 is a Monday → Saturday 2026-10-10 00:00 Tehran = 2026-10-09T20:30Z
    expect(startOfTehranWeek(now).toISOString()).toBe('2026-10-09T20:30:00.000Z');
    // Saturday itself maps to itself
    expect(startOfTehranWeek(new Date('2026-10-10T05:00:00Z')).toISOString()).toBe('2026-10-09T20:30:00.000Z');
  });
  it('day key uses Tehran calendar', () => {
    expect(tehranDayKey(new Date('2026-10-12T21:00:00Z'))).toBe('2026-10-13');
  });
  it('parseRange defaults, swaps invalid and caps at a year', () => {
    const r = parseRange(undefined, undefined, now);
    expect(r.to).toEqual(now);
    expect(now.getTime() - r.from.getTime()).toBe(30 * D);
    const bad = parseRange('2027-01-01', '2026-01-01', now);
    expect(bad.from.getTime()).toBeLessThan(bad.to.getTime());
    const big = parseRange('2000-01-01', '2026-01-01', now);
    expect(big.to.getTime() - big.from.getTime()).toBe(366 * D);
    expect(clampDays('1000')).toBe(90);
    expect(clampDays('abc')).toBe(30);
    expect(clampDays('2')).toBe(7);
  });
});

describe('counters and range stats', () => {
  it('maps status groups; legacy OPEN counts as NEW', () => {
    const c = counterFromStatuses({ NEW: 2, OPEN: 1, SEEN: 3, IN_PROGRESS: 4, DONE: 5, RETURNED_FOR_FIX: 6, HAS_PROBLEM: 7 }, { overdue: 8, extensionPending: 9, scheduled: 1 });
    expect(c).toEqual({ new: 3, seenNotStarted: 3, inProgress: 4, overdue: 8, awaitingApproval: 5, returnedForFix: 6, hasProblem: 7, extensionPending: 9, scheduled: 1 });
  });
  it('computes completion, average time and on-time rate', () => {
    const base = new Date('2026-10-01T00:00:00Z');
    const s = computeRangeStats(4, [
      { createdAt: base, completedAt: new Date(base.getTime() + 10 * H), dueAt: new Date(base.getTime() + 12 * H) },
      { createdAt: base, completedAt: new Date(base.getTime() + 20 * H), dueAt: new Date(base.getTime() + 12 * H) },
      { createdAt: base, completedAt: new Date(base.getTime() + 30 * H), dueAt: null },
    ]);
    expect(s.completed).toBe(3);
    expect(s.completionRate).toBe(0.75);
    expect(s.avgCompletionHours).toBe(20);
    expect(s.onTimeRate).toBe(0.5);
  });
  it('returns nulls when empty and never exceeds 100%', () => {
    expect(computeRangeStats(0, [])).toEqual({ created: 0, completed: 0, completionRate: null, avgCompletionHours: null, onTimeRate: null });
    expect(computeRangeStats(1, [{ createdAt: now, completedAt: now, dueAt: null }, { createdAt: now, completedAt: now, dueAt: null }]).completionRate).toBe(1);
  });
});

describe('workload', () => {
  const range = { from: new Date(now.getTime() - 30 * D), to: now };
  const t = (o: Partial<WorkloadTask>): WorkloadTask => ({
    status: 'IN_PROGRESS',
    dueAt: null,
    isPublished: true,
    createdAt: new Date(now.getTime() - 5 * D),
    completedAt: null,
    assigneeIds: ['a'],
    ...o,
  });
  const tasks: WorkloadTask[] = [
    t({ assigneeIds: ['a', 'b'], dueAt: new Date(now.getTime() - H) }),
    t({ assigneeIds: ['a'], status: 'NEW' }),
    t({ assigneeIds: ['b'], status: 'APPROVED', completedAt: new Date(now.getTime() - 2 * D), createdAt: new Date(now.getTime() - 3 * D) }),
    t({ assigneeIds: ['b'], status: 'DONE', completedAt: new Date(now.getTime() - D), createdAt: new Date(now.getTime() - 2 * D) }),
    t({ assigneeIds: ['a'], status: 'IN_PROGRESS', isPublished: false, dueAt: new Date(now.getTime() - H) }),
  ];

  it('counts multi-assignee tasks for each person, overdue only when published', () => {
    const rows = computeWorkload(tasks, range, now, new Map());
    const a = rows.find((r) => r.userId === 'a')!;
    const b = rows.find((r) => r.userId === 'b')!;
    expect(a.openCount).toBe(3);
    expect(a.overdueCount).toBe(1);
    expect(a.chips).toContain('has_overdue');
    expect(b.openCount).toBe(1);
    expect(b.doneInRange).toBe(2);
    expect(b.awaitingApprovalCount).toBe(1);
    expect(b.avgCompletionHours).toBe(24);
  });
  it('non-manager view contains only the caller row (even when empty)', () => {
    const rows = computeWorkload(tasks, range, now, new Map(), 'b');
    expect(rows.map((r) => r.userId)).toEqual(['b']);
    expect(computeWorkload([], range, now, new Map(), 'zzz').map((r) => r.userId)).toEqual(['zzz']);
    expect(computeWorkload([], range, now, new Map(), 'zzz')[0].chips).toEqual(['idle']);
  });
  it('chips and sorting', () => {
    expect(workloadChips({ openCount: 9, overdueCount: 0 })).toEqual(['overloaded']);
    expect(workloadChips({ openCount: 2, overdueCount: 0 })).toEqual(['ok']);
    const rows = computeWorkload(tasks, range, now, new Map()).map((r) => ({ ...r, name: r.userId }));
    expect(sortWorkload(rows, 'open', 'desc')[0].userId).toBe('a');
    expect(sortWorkload(rows, 'done', 'desc')[0].userId).toBe('b');
    expect(sortWorkload(rows, 'name', 'asc')[0].userId).toBe('a');
  });
});

describe('attention ranking', () => {
  it('problems outrank approvals; urgency and age raise the score; deterministic', () => {
    const items = [
      { kind: 'approval' as const, taskId: 'x1', since: new Date(now.getTime() - 2 * H), priority: 'NORMAL' as const },
      { kind: 'problem' as const, taskId: 'x2', since: new Date(now.getTime() - H), priority: 'NORMAL' as const },
      { kind: 'approval' as const, taskId: 'x3', since: new Date(now.getTime() - 2 * H), priority: 'URGENT' as const },
      { kind: 'scheduled' as const, taskId: 'x4', since: now, priority: 'NORMAL' as const },
    ];
    const r = rankAttention(items, now);
    expect(r.map((i) => i.taskId)).toEqual(['x2', 'x3', 'x1', 'x4']);
    expect(attentionScore(items[0], now)).toBe(52);
    expect(rankAttention(items, now, 2)).toHaveLength(2);
  });
  it('caps the age bonus', () => {
    const old = { kind: 'unseen' as const, taskId: 'o', since: new Date(now.getTime() - 900 * H), priority: 'NORMAL' as const };
    expect(attentionScore(old, now)).toBe(30 + 48);
  });
});

describe('trend', () => {
  it('buckets by Tehran day, fills empty days, splits by priority', () => {
    const tr = buildTrend(
      [
        { createdAt: new Date('2026-10-12T05:00:00Z'), completedAt: new Date('2026-10-12T08:00:00Z'), priority: 'URGENT', status: 'APPROVED' },
        { createdAt: new Date('2026-10-11T05:00:00Z'), completedAt: null, priority: 'NORMAL', status: 'NEW' },
        { createdAt: new Date('2026-01-01T05:00:00Z'), completedAt: null, priority: 'MEDIUM', status: 'NEW' },
        { createdAt: new Date('2026-10-10T05:00:00Z'), completedAt: new Date('2026-10-12T05:00:00Z'), priority: 'MEDIUM', status: 'CANCELLED' },
      ],
      7,
      now,
    );
    expect(tr.series).toHaveLength(7);
    expect(tr.series[6]).toEqual({ date: '2026-10-12', created: 1, completed: 1 });
    expect(tr.series[5]).toEqual({ date: '2026-10-11', created: 1, completed: 0 });
    expect(tr.byPriority.URGENT).toEqual({ created: 1, completed: 1 });
    expect(tr.byPriority.MEDIUM).toEqual({ created: 1, completed: 0 });
    expect(tr.series.reduce((s, d) => s + d.created, 0)).toBe(3);
  });
});

describe('csv', () => {
  it('escapes quotes/newlines and neutralizes formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(null)).toBe('');
  });
  it('starts with a UTF-8 BOM and flags late tasks', () => {
    const csv = buildCsv(
      [
        { code: 'TASK-000001', title: 'نمونه', status: 'IN_PROGRESS', priority: 'URGENT', assignees: ['علی', 'رضا'], creator: 'مدیر', createdAt: new Date('2026-10-01T00:00:00Z'), dueAt: new Date('2026-10-05T00:00:00Z'), completedAt: null },
      ],
      now,
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('در حال انجام');
    expect(lines[1].endsWith('بله')).toBe(true);
  });
});
