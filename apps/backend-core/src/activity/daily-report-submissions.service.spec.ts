import { describe, expect, it, vi } from 'vitest';
import {
  DailyReportSubmissionService, buildSubmissionRow, onTimeDeadline, parseCutoff, summarizeSubmissions, DEFAULT_CUTOFF,
} from './daily-report-submissions.service.js';

const base = { userId: 'u1', userName: 'علی', ymd: '2026-10-05', date: new Date('2026-10-05T00:00:00Z'), itemsTotal: 4, itemsDone: 3, auto: false };

describe('buildSubmissionRow', () => {
  it('manual report before the default 23:59 cutoff is on time and shows Tehran HH:mm', () => {
    // 17:10 Tehran = 13:40Z
    const r = buildSubmissionRow({ ...base, reportCreatedAt: new Date('2026-10-05T13:40:00Z') }, DEFAULT_CUTOFF, new Date('2026-10-06T10:00:00Z'));
    expect(r).toMatchObject({ submitted: true, status: 'ON_TIME', mode: 'MANUAL', submittedTimeFa: '17:10' });
  });
  it('is late after a configured cutoff', () => {
    const r = buildSubmissionRow({ ...base, reportCreatedAt: new Date('2026-10-05T13:40:00Z') }, { hour: 17, minute: 0 }, new Date('2026-10-06T10:00:00Z'));
    expect(r.status).toBe('LATE');
  });
  it('an auto-filed end-of-day report is AUTO and counts as late even if early', () => {
    const r = buildSubmissionRow({ ...base, auto: true, reportCreatedAt: new Date('2026-10-05T21:05:00Z') }, DEFAULT_CUTOFF, new Date('2026-10-06T10:00:00Z'));
    expect(r).toMatchObject({ mode: 'AUTO', status: 'LATE', submittedTimeFa: '00:35' });
  });
  it('no report: pending until the cutoff passes, then missing', () => {
    expect(buildSubmissionRow({ ...base, reportCreatedAt: null }, DEFAULT_CUTOFF, new Date('2026-10-05T10:00:00Z')).status).toBe('PENDING');
    const m = buildSubmissionRow({ ...base, reportCreatedAt: null }, DEFAULT_CUTOFF, new Date('2026-10-06T10:00:00Z'));
    expect(m).toMatchObject({ status: 'MISSING', submitted: false, submittedAt: null, mode: null });
  });
  it('parses cutoff settings and computes the deadline in Tehran time', () => {
    expect(parseCutoff('18:30')).toEqual({ hour: 18, minute: 30 });
    expect(parseCutoff({ hour: 99, minute: 0 })).toEqual(DEFAULT_CUTOFF);
    expect(parseCutoff(null)).toEqual(DEFAULT_CUTOFF);
    expect(onTimeDeadline('2026-10-05', { hour: 18, minute: 0 }).toISOString()).toBe('2026-10-05T14:30:59.999Z');
  });
});

describe('summarizeSubmissions + compute', () => {
  it('summarizes per person', () => {
    const rows = [
      buildSubmissionRow({ ...base, reportCreatedAt: new Date('2026-10-05T13:40:00Z') }, DEFAULT_CUTOFF, new Date('2026-10-07T00:00:00Z')),
      buildSubmissionRow({ ...base, ymd: '2026-10-04', date: new Date('2026-10-04T00:00:00Z'), reportCreatedAt: null }, DEFAULT_CUTOFF, new Date('2026-10-07T00:00:00Z')),
      buildSubmissionRow({ ...base, ymd: '2026-10-03', date: new Date('2026-10-03T00:00:00Z'), auto: true, reportCreatedAt: new Date('2026-10-03T21:10:00Z') }, DEFAULT_CUTOFF, new Date('2026-10-07T00:00:00Z')),
    ];
    const [s] = summarizeSubmissions(rows);
    expect(s).toMatchObject({ days: 3, onTime: 1, late: 1, missing: 1, manual: 1, auto: 1, avgManualMinutes: 17 * 60 + 10 });
  });

  it('reads Report.createdAt via the day-close marker and flags auto', async () => {
    const d1 = new Date('2026-10-05T00:00:00Z');
    const db = {
      moduleSetting: { findUnique: vi.fn().mockResolvedValue({ value: '20:00' }) },
      dailyChecklistItem: {
        groupBy: vi.fn().mockImplementation(({ where }: { where: { done?: boolean } }) => Promise.resolve(where.done ? [{ userId: 'u1', date: d1, _count: { _all: 2 } }] : [{ userId: 'u1', date: d1, _count: { _all: 3 } }, { userId: 'u2', date: d1, _count: { _all: 1 } }])),
      },
      dailyChecklistDayClose: { findMany: vi.fn().mockResolvedValue([{ userId: 'u1', date: d1, reportId: 'r1', auto: false }]) },
      report: { findMany: vi.fn().mockResolvedValue([{ id: 'r1', createdAt: new Date('2026-10-05T14:00:00Z') }]) }, // 17:30 Tehran
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1', name: 'علی' }, { id: 'u2', name: 'سارا' }]) },
    };
    const out = await new DailyReportSubmissionService().compute(db as never, { from: '2026-10-05', to: '2026-10-05', now: new Date('2026-10-06T10:00:00Z') });
    const u1 = out.rows.find((r) => r.userId === 'u1')!;
    const u2 = out.rows.find((r) => r.userId === 'u2')!;
    expect(u1).toMatchObject({ status: 'ON_TIME', mode: 'MANUAL', submittedTimeFa: '17:30', itemsTotal: 3, itemsDone: 2 });
    expect(u2).toMatchObject({ status: 'MISSING', submitted: false });
    expect(out.cutoff).toEqual({ hour: 20, minute: 0 });
  });

  it('restricts to the given people (query filter)', async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const db = { moduleSetting: { findUnique: vi.fn().mockResolvedValue(null) }, dailyChecklistItem: { groupBy }, dailyChecklistDayClose: { findMany: vi.fn().mockResolvedValue([]) }, report: { findMany: vi.fn() }, user: { findMany: vi.fn() } };
    await new DailyReportSubmissionService().compute(db as never, { userIds: ['u1'] });
    expect(groupBy.mock.calls[0][0].where.userId).toEqual({ in: ['u1'] });
    expect(db.dailyChecklistDayClose.findMany.mock.calls[0][0].where.userId).toEqual({ in: ['u1'] });
  });
});
