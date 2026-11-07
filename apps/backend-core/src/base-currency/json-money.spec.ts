import { describe, expect, it } from 'vitest';
import { scaleJsonDoc } from './json-money.js';
import { parseRate } from './rational.js';

describe('scaleJsonDoc', () => {
  const x10 = parseRate('10');
  const d10 = parseRate('0.1');
  it('فقط فیلدهای نامبرده بازمقیاس می‌شوند، بقیه دست‌نخورده', () => {
    const doc = [{ description: 'الف', quantity: 2, unitPrice: 1500 }, { description: 'ب', quantity: 1, unitPrice: 20 }];
    const r = scaleJsonDoc(doc, ['unitPrice'], x10);
    expect(r.doc).toEqual([{ description: 'الف', quantity: 2, unitPrice: 15000 }, { description: 'ب', quantity: 1, unitPrice: 200 }]);
    expect(r.cells).toBe(2);
    expect(r.lossy).toBe(0);
  });
  it('رفت‌وبرگشت دقیق', () => {
    const doc = [{ unitPrice: 123_456, quantity: 3 }];
    const up = scaleJsonDoc(doc, ['unitPrice'], x10).doc;
    expect(scaleJsonDoc(up, ['unitPrice'], d10).doc).toEqual(doc);
  });
  it('نامضرب شمرده و (در ROUND) گرد می‌شود', () => {
    const r = scaleJsonDoc([{ unitPrice: 1235 }, { unitPrice: 1230 }], ['unitPrice'], d10);
    expect(r.lossy).toBe(1);
    expect(r.doc).toEqual([{ unitPrice: 124 }, { unitPrice: 123 }]);
  });
  it('ورودی نامعتبر (غیرآرایه، عنصر غیرشیء، فیلد غیرعدد/اعشاری) بی‌خطر است', () => {
    expect(scaleJsonDoc(null, ['a'], x10).cells).toBe(0);
    expect(scaleJsonDoc({ a: 1 }, ['a'], x10).doc).toEqual({ a: 1 });
    const r = scaleJsonDoc([5, { a: '12' }, { a: 1.5 }], ['a'], x10);
    expect(r.doc).toEqual([5, { a: '12' }, { a: 1.5 }]);
    expect(r.skipped).toBe(1);
  });
  it('سرریز عدد امن: فیلد دست‌نخورده می‌ماند و skipped شمرده می‌شود', () => {
    const r = scaleJsonDoc([{ a: Number.MAX_SAFE_INTEGER - 1 }], ['a'], x10);
    expect(r.skipped).toBe(1);
    expect(r.doc).toEqual([{ a: Number.MAX_SAFE_INTEGER - 1 }]);
  });
});
