import { describe, expect, it } from 'vitest';
import { isValidCardNumber, isValidSheba, normalizeSheba } from './iran-bank-validators.js';
import { buildOpeningLines, buildTransactionLines } from './transaction-lines.js';
import { assertBalancedLines } from '../journal-posting.js';
import { leafStatusForCheck } from './cheque-leaf.util.js';

/** تولید شبای معتبر برای تست از روی ۲۲ رقم دلخواه با همان الگوریتم mod-97 */
function makeSheba(body22: string): string {
  const base = `${body22}1827`;
  let rem = 0;
  for (const ch of `${base}00`) rem = (rem * 10 + Number(ch)) % 97;
  const check = String(98 - rem).padStart(2, '0');
  return `IR${check}${body22}`;
}

describe('Sheba (mod-97)', () => {
  it('accepts a generated valid Sheba (also with spaces / Persian digits / lowercase)', () => {
    const s = makeSheba('0170000000100324200001');
    expect(isValidSheba(s)).toBe(true);
    expect(isValidSheba(s.toLowerCase().replace(/(.{4})/g, '$1 '))).toBe(true);
    const persian = s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
    expect(isValidSheba(persian)).toBe(true);
  });
  it('rejects a single flipped digit, wrong length and missing IR', () => {
    const s = makeSheba('0170000000100324200001');
    const bad = s.slice(0, 10) + (s[10] === '1' ? '2' : '1') + s.slice(11);
    expect(isValidSheba(bad)).toBe(false);
    expect(isValidSheba(s.slice(0, -1))).toBe(false);
    expect(isValidSheba(s.slice(2))).toBe(false);
  });
  it('normalizeSheba strips separators', () => {
    expect(normalizeSheba('ir12 3456-78')).toBe('IR12345678');
  });
});

describe('Card number (Luhn)', () => {
  it('accepts valid and rejects invalid', () => {
    expect(isValidCardNumber('4539578763621486')).toBe(true);
    expect(isValidCardNumber('4539 5787 6362 1486')).toBe(true);
    expect(isValidCardNumber('4539578763621487')).toBe(false);
    expect(isValidCardNumber('453957876362148')).toBe(false);
  });
});

describe('bank transaction journal lines', () => {
  it('receipt: Dr bank / Cr counter, balanced', () => {
    const l = buildTransactionLines('RECEIPT', 1_500_000, 'bank', 'ar');
    expect(l).toEqual([
      { accountId: 'bank', debit: 1_500_000n, credit: 0n },
      { accountId: 'ar', debit: 0n, credit: 1_500_000n },
    ]);
    expect(assertBalancedLines(l)).toBe(1_500_000n);
  });
  it('payment: Dr counter / Cr bank', () => {
    const l = buildTransactionLines('PAYMENT', 10, 'bank', 'exp');
    expect(l[0]).toMatchObject({ accountId: 'exp', debit: 10n });
    expect(l[1]).toMatchObject({ accountId: 'bank', credit: 10n });
  });
  it('transfer: Dr destination / Cr source', () => {
    const l = buildTransactionLines('TRANSFER', 77, 'from', 'to');
    expect(l[0]).toMatchObject({ accountId: 'to', debit: 77n });
    expect(l[1]).toMatchObject({ accountId: 'from', credit: 77n });
  });
  it('refuses same account, zero, fractional and unsafe amounts', () => {
    expect(() => buildTransactionLines('TRANSFER', 5, 'a', 'a')).toThrow();
    expect(() => buildTransactionLines('RECEIPT', 0, 'a', 'b')).toThrow();
    expect(() => buildTransactionLines('RECEIPT', 1.5, 'a', 'b')).toThrow();
    expect(() => buildTransactionLines('RECEIPT', 2 ** 60, 'a', 'b')).toThrow();
  });
  it('opening balance: positive Dr holder, negative (overdraft) Cr holder', () => {
    expect(buildOpeningLines(500, 'h', 'e')[0]).toMatchObject({ accountId: 'h', debit: 500n });
    const neg = buildOpeningLines(-500, 'h', 'e');
    expect(neg[1]).toMatchObject({ accountId: 'h', credit: 500n });
    expect(() => buildOpeningLines(0, 'h', 'e')).toThrow();
  });
  it('assertBalancedLines rejects unbalanced / two-sided lines', () => {
    expect(() => assertBalancedLines([{ accountId: 'a', debit: 5n, credit: 0n }, { accountId: 'b', debit: 0n, credit: 4n }])).toThrow(/برابر/);
    expect(() => assertBalancedLines([{ accountId: 'a', debit: 5n, credit: 5n }, { accountId: 'b', debit: 0n, credit: 0n }])).toThrow();
  });
});

describe('cheque leaf status mapping', () => {
  it('maps check status to leaf status', () => {
    expect(leafStatusForCheck('PENDING')).toBe('ISSUED');
    expect(leafStatusForCheck('DEPOSITED')).toBe('ISSUED');
    expect(leafStatusForCheck('CLEARED')).toBe('CLEARED');
    expect(leafStatusForCheck('BOUNCED')).toBe('BOUNCED');
    expect(leafStatusForCheck('CANCELLED')).toBe('VOID');
    expect(leafStatusForCheck('ENDORSED')).toBeNull();
  });
});
