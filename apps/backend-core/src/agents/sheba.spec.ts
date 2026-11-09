import { describe, expect, it } from 'vitest';
import { assertValidSheba, isValidSheba, maskSheba, normalizeSheba } from './sheba.js';

/** مرجع مستقل با BigInt برای ساخت شبای معتبر. */
function make(bban: string): string {
  const n = BigInt(`${bban}182700`.replace(/\D/g, ''));
  const chk = String(98n - (n % 97n)).padStart(2, '0');
  return `IR${chk}${bban}`;
}

describe('sheba mod-97', () => {
  const ok = make('0170000000100324200001');
  it('accepts a valid IBAN, with spaces / lowercase / Persian digits', () => {
    expect(isValidSheba(ok)).toBe(true);
    expect(isValidSheba(ok.toLowerCase())).toBe(true);
    expect(isValidSheba(`${ok.slice(0, 4)} ${ok.slice(4, 8)}-${ok.slice(8)}`)).toBe(true);
    const fa = ok.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);
    expect(isValidSheba(fa)).toBe(true);
    expect(normalizeSheba(fa)).toBe(ok);
  });
  it('rejects wrong check digit, wrong length, wrong country, junk', () => {
    const bad = ok.slice(0, 2) + (ok.slice(2, 4) === '99' ? '98' : '99') + ok.slice(4);
    expect(isValidSheba(bad)).toBe(false);
    expect(isValidSheba(ok.slice(0, -1))).toBe(false);
    expect(isValidSheba(`${ok}0`)).toBe(false);
    expect(isValidSheba(ok.replace('IR', 'DE'))).toBe(false);
    expect(isValidSheba('')).toBe(false);
    expect(isValidSheba('IR' + 'x'.repeat(24))).toBe(false);
  });
  it('detects a single-digit typo anywhere in the account part', () => {
    for (let i = 4; i < ok.length; i++) {
      const d = ok[i] === '9' ? '8' : String(Number(ok[i]) + 1);
      expect(isValidSheba(ok.slice(0, i) + d + ok.slice(i + 1)), `pos ${i}`).toBe(false);
    }
  });
  it('assertValidSheba returns normalized value or throws a Persian message', () => {
    expect(assertValidSheba(` ${ok.toLowerCase()} `)).toBe(ok);
    expect(() => assertValidSheba('IR000')).toThrow(/شبا/);
  });
  it('masks the middle', () => {
    expect(maskSheba(ok)).toMatch(/^IR\d{2}•+\d{4}$/);
    expect(maskSheba(null)).toBeNull();
  });
});
