import { describe, expect, it } from 'vitest';
import { computeProjectProgress } from './project-progress.js';

const st = (status: string, extra: Record<string, unknown> = {}) => ({ status, ...extra });

describe('computeProjectProgress', () => {
  it('no stages = 0% and hasStages=false', () => {
    expect(computeProjectProgress([])).toEqual({ progressPercent: 0, doneStages: 0, totalStages: 0, hasStages: false });
  });

  it('equal weight per stage; in-progress counts 0', () => {
    const r = computeProjectProgress([st('DONE'), st('IN_PROGRESS'), st('PENDING'), st('AWAITING_APPROVAL')]);
    expect(r).toMatchObject({ progressPercent: 25, doneStages: 1, totalStages: 4, hasStages: true });
  });

  it('rounds to the nearest integer', () => {
    expect(computeProjectProgress([st('DONE'), st('PENDING'), st('PENDING')]).progressPercent).toBe(33);
    expect(computeProjectProgress([st('DONE'), st('DONE'), st('PENDING')]).progressPercent).toBe(67);
    expect(computeProjectProgress([st('DONE'), st('PENDING'), st('PENDING'), st('PENDING'), st('PENDING'), st('PENDING'), st('PENDING'), st('PENDING'), st('PENDING')]).progressPercent).toBe(11);
  });

  it('all done = 100, none done = 0', () => {
    expect(computeProjectProgress([st('DONE'), st('DONE')]).progressPercent).toBe(100);
    expect(computeProjectProgress([st('PENDING'), st('REJECTED')]).progressPercent).toBe(0);
  });

  it('cancelled / skipped stages are excluded from the denominator', () => {
    const r = computeProjectProgress([st('DONE'), st('CANCELLED'), st('SKIPPED'), st('PENDING')]);
    expect(r).toMatchObject({ progressPercent: 50, doneStages: 1, totalStages: 2 });
    // فقط مرحله‌های لغوشده = بدون مرحله
    expect(computeProjectProgress([st('CANCELLED')])).toMatchObject({ progressPercent: 0, totalStages: 0, hasStages: false });
  });

  it('uses weights when present', () => {
    const r = computeProjectProgress([st('DONE', { weight: 3 }), st('PENDING', { weight: 1 })]);
    expect(r.progressPercent).toBe(75);
  });

  it('unweighted stages count 1 next to weighted ones; invalid weights fall back to 1', () => {
    expect(computeProjectProgress([st('DONE', { weight: 3 }), st('PENDING')]).progressPercent).toBe(75);
    expect(computeProjectProgress([st('DONE', { weight: -5 }), st('PENDING', { weight: 0 })]).progressPercent).toBe(50);
    expect(computeProjectProgress([st('DONE', { weight: Number.NaN }), st('PENDING', { weight: null })]).progressPercent).toBe(50);
  });

  it('inner progress of an in-progress stage counts, clamped to 0..100', () => {
    expect(computeProjectProgress([st('IN_PROGRESS', { progress: 50 }), st('PENDING')]).progressPercent).toBe(25);
    expect(computeProjectProgress([st('IN_PROGRESS', { progress: 250 })]).progressPercent).toBe(100);
    expect(computeProjectProgress([st('IN_PROGRESS', { progress: -10 })]).progressPercent).toBe(0);
    // پیشرفت درونی فقط برای مرحله‌ی در حال اجرا
    expect(computeProjectProgress([st('PENDING', { progress: 90 })]).progressPercent).toBe(0);
  });
});
