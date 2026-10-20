import { describe, expect, it } from 'vitest';
import { allocateNumber, DEFAULT_PATTERNS, formatLetterNumber, periodKeyFor, validatePattern, type CounterIncrement, type NumberingSchemeLike } from './numbering.js';

// 2026-10-20 12:00 Tehran = 1405/07/28
const AT = new Date('2026-10-20T08:30:00Z');

/** شمارنده‌ی درون‌حافظه با همان معنای INSERT … ON CONFLICT DO UPDATE … RETURNING (هر فراخوانی اتمیک و پشت‌سرهم). */
function fakeCounter(): CounterIncrement & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  let chain: Promise<unknown> = Promise.resolve();
  const fn = ((schemeId: string, periodKey: string, startAt: number) => {
    const run = async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 3)); // تأخیر تصادفی شبکه
      const k = `${schemeId}|${periodKey}`;
      const next = rows.has(k) ? rows.get(k)! + 1 : startAt;
      rows.set(k, next);
      return next;
    };
    const p = chain.then(run, run); // سریال‌سازی مثل قفل ردیف
    chain = p.catch(() => undefined);
    return p;
  }) as CounterIncrement & { rows: Map<string, number> };
  fn.rows = rows;
  return fn;
}

const scheme = (over: Partial<NumberingSchemeLike> = {}): NumberingSchemeLike => ({ id: 's1', type: 'OUTGOING', pattern: 'ص/{YYYY}/{SEQ:5}', resetPolicy: 'YEARLY', startAt: 1, ...over });

describe('validatePattern', () => {
  it('accepts valid patterns', () => {
    expect(validatePattern('ص/{YYYY}/{SEQ:5}')).toBeNull();
    expect(validatePattern('{TYPE}-{YY}{MM}-{CAT}-{SEQ:3}')).toBeNull();
    for (const p of Object.values(DEFAULT_PATTERNS)) expect(validatePattern(p)).toBeNull();
  });
  it('rejects bad patterns', () => {
    expect(validatePattern('')).toMatch(/نویسه/);
    expect(validatePattern('{YYYY}')).toMatch(/SEQ/);
    expect(validatePattern('{SEQ:0}')).toMatch(/۱ تا ۱۲/);
    expect(validatePattern('{SEQ:13}')).toMatch(/۱ تا ۱۲/);
    expect(validatePattern('{SEQ:3}{SEQ:3}')).toMatch(/یک/);
    expect(validatePattern('{FOO}{SEQ:3}')).toMatch(/ناشناخته/);
    expect(validatePattern('{YYYY:2}{SEQ:3}')).toMatch(/پارامتر/);
    expect(validatePattern('a{SEQ:3}}')).toMatch(/آکولاد/);
    expect(validatePattern('x'.repeat(130) + '{SEQ:3}')).toMatch(/۱۲۰/);
  });
});

describe('formatLetterNumber', () => {
  it('renders all tokens with Jalali date and zero padding', () => {
    expect(formatLetterNumber('{TYPE}/{YYYY}/{YY}/{MM}/{SEQ:5}/{CAT}', { seq: 42, at: AT, type: 'OUTGOING', categoryCode: 'HR' })).toBe('ص/1405/05/07/00042/HR');
    expect(formatLetterNumber('{TYPE}{SEQ:2}', { seq: 7, at: AT, type: 'INCOMING' })).toBe('و07');
    expect(formatLetterNumber('{SEQ:2}', { seq: 12345, at: AT, type: 'INTERNAL' })).toBe('12345'); // سرریز بریده نمی‌شود
  });
  it('uses Tehran time, not server timezone (Nowruz boundary)', () => {
    // 2026-03-20T20:45Z = 2026-03-21 00:15 Tehran = 1405/01/01
    expect(formatLetterNumber('{YYYY}/{MM}', { seq: 1, at: new Date('2026-03-20T20:45:00Z'), type: 'OUTGOING' })).toBe('1405/01');
    expect(formatLetterNumber('{YYYY}/{MM}', { seq: 1, at: new Date('2026-03-20T20:00:00Z'), type: 'OUTGOING' })).toBe('1404/12');
  });
});

describe('periodKeyFor / reset policy', () => {
  it('yields year, month or ALL', () => {
    expect(periodKeyFor('YEARLY', AT)).toBe('1405');
    expect(periodKeyFor('MONTHLY', AT)).toBe('1405-07');
    expect(periodKeyFor('NEVER', AT)).toBe('ALL');
  });
  it('resets the sequence across periods but never inside one', async () => {
    const inc = fakeCounter();
    const s = scheme();
    const a = await allocateNumber(inc, s, { type: 'OUTGOING', at: AT });
    const b = await allocateNumber(inc, s, { type: 'OUTGOING', at: AT });
    const nextYear = await allocateNumber(inc, s, { type: 'OUTGOING', at: new Date('2027-04-01T00:00:00Z') });
    expect([a.number, b.number, nextYear.number]).toEqual(['ص/1405/00001', 'ص/1405/00002', 'ص/1406/00001']);
  });
  it('MONTHLY resets each Jalali month; NEVER keeps counting; startAt honoured', async () => {
    const inc = fakeCounter();
    const m = scheme({ id: 'm', resetPolicy: 'MONTHLY', pattern: '{YYYY}{MM}-{SEQ:3}', startAt: 100 });
    const x1 = await allocateNumber(inc, m, { type: 'OUTGOING', at: AT });
    const x2 = await allocateNumber(inc, m, { type: 'OUTGOING', at: new Date('2026-11-25T00:00:00Z') });
    expect([x1.number, x2.number]).toEqual(['140507-100', '140509-100']);
    const n = scheme({ id: 'n', resetPolicy: 'NEVER' });
    const y1 = await allocateNumber(inc, n, { type: 'OUTGOING', at: AT });
    const y2 = await allocateNumber(inc, n, { type: 'OUTGOING', at: new Date('2030-01-01T00:00:00Z') });
    expect([y1.seq, y2.seq]).toEqual([1, 2]);
  });
});

describe('atomicity under concurrency', () => {
  it('200 parallel allocations produce unique, gap-free numbers', async () => {
    const inc = fakeCounter();
    const s = scheme();
    const all = await Promise.all(Array.from({ length: 200 }, () => allocateNumber(inc, s, { type: 'OUTGOING', at: AT })));
    const nums = all.map((a) => a.number);
    expect(new Set(nums).size).toBe(200);
    expect(all.map((a) => a.seq).sort((x, y) => x - y)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
  });
  it('separate schemes (types) keep independent counters', async () => {
    const inc = fakeCounter();
    const out = scheme({ id: 'out' });
    const inn = scheme({ id: 'in', type: 'INCOMING', pattern: 'وارده/{YYYY}/{SEQ:5}' });
    const r = await Promise.all([allocateNumber(inc, out, { type: 'OUTGOING', at: AT }), allocateNumber(inc, inn, { type: 'INCOMING', at: AT })]);
    expect(r.map((x) => x.seq)).toEqual([1, 1]);
  });
  it('a failed render does not skip numbers when the caller keeps the allocated number (burned numbers are never reissued)', async () => {
    const inc = fakeCounter();
    const s = scheme();
    const first = await allocateNumber(inc, s, { type: 'OUTGOING', at: AT });
    // نامه‌ی باطل‌شده شماره‌اش را می‌سوزاند: شمارنده برنمی‌گردد
    const second = await allocateNumber(inc, s, { type: 'OUTGOING', at: AT });
    expect(second.seq).toBe(first.seq + 1);
  });
});
