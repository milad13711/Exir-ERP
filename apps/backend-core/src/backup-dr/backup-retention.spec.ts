import { describe, expect, it } from 'vitest';
import { DEFAULT_RETENTION, retentionFromEnv, selectDeleteDates, selectKeepDates } from './backup-retention.js';

function daysBack(end: string, n: number): string[] {
  const out: string[] = [];
  const e = new Date(`${end}T00:00:00Z`);
  for (let i = 0; i < n; i++) out.push(new Date(e.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

describe('GFS retention', () => {
  it('keeps everything when fewer than N daily', () => {
    const d = daysBack('2026-10-08', 5);
    expect(selectDeleteDates(d, DEFAULT_RETENTION)).toEqual([]);
  });

  it('keeps 7 daily + weekly + monthly and deletes the rest over a year of daily backups', () => {
    const d = daysBack('2026-10-08', 365);
    const keep = selectKeepDates(d, DEFAULT_RETENTION);
    // 7 newest are present
    for (const x of daysBack('2026-10-08', 7)) expect(keep.has(x)).toBe(true);
    expect(keep.size).toBeLessThanOrEqual(DEFAULT_RETENTION.daily + DEFAULT_RETENTION.weekly + DEFAULT_RETENTION.monthly);
    expect(keep.size).toBeGreaterThanOrEqual(12);
    // Sundays and 1st-of-month are the representatives
    const weeklyKept = [...keep].filter((x) => new Date(`${x}T00:00:00Z`).getUTCDay() === 0);
    expect(weeklyKept.length).toBeGreaterThanOrEqual(4);
    expect(keep.has('2026-10-01')).toBe(true);
    expect(keep.has('2026-05-01')).toBe(true);
    expect(keep.has('2026-04-01')).toBe(false);
  });

  it('weekly falls back to the last available backup of a week when Sunday is missing', () => {
    const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-30', '2026-10-08'];
    const keep = selectKeepDates(dates, { daily: 1, weekly: 3, monthly: 0 });
    expect(keep.has('2026-09-18')).toBe(true); // last of its week
    expect(keep.has('2026-09-15')).toBe(false);
  });

  it('always keeps the newest backup even with a degenerate policy', () => {
    const keep = selectKeepDates(['2026-01-01', '2026-01-02'], { daily: 0, weekly: 0, monthly: 0 });
    expect([...keep]).toEqual(['2026-01-02']);
  });

  it('reads env and rejects garbage, never allowing daily < 1', () => {
    expect(retentionFromEnv({ BACKUP_KEEP_DAILY: '3', BACKUP_KEEP_WEEKLY: '2', BACKUP_KEEP_MONTHLY: '12' })).toEqual({ daily: 3, weekly: 2, monthly: 12 });
    expect(retentionFromEnv({ BACKUP_KEEP_DAILY: 'abc', BACKUP_KEEP_WEEKLY: '-1' })).toEqual(DEFAULT_RETENTION);
    expect(retentionFromEnv({ BACKUP_KEEP_DAILY: '0' }).daily).toBe(1);
  });
});
