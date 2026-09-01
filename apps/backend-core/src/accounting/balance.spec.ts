import { describe, expect, it } from 'vitest';
import { accountBalance } from './balance.js';

describe('accountBalance', () => {
  it('ASSET grows on debit', () => {
    expect(accountBalance('ASSET', [{ debit: 100, credit: 0 }])).toBe(100);
    expect(accountBalance('ASSET', [{ debit: 0, credit: 40 }])).toBe(-40);
  });

  it('EXPENSE grows on debit, same as ASSET', () => {
    expect(accountBalance('EXPENSE', [{ debit: 100, credit: 30 }])).toBe(70);
  });

  it('LIABILITY grows on credit', () => {
    expect(accountBalance('LIABILITY', [{ debit: 0, credit: 100 }])).toBe(100);
    expect(accountBalance('LIABILITY', [{ debit: 40, credit: 0 }])).toBe(-40);
  });

  it('EQUITY and REVENUE also grow on credit', () => {
    expect(accountBalance('EQUITY', [{ debit: 10, credit: 50 }])).toBe(40);
    expect(accountBalance('REVENUE', [{ debit: 0, credit: 250_000_000 }])).toBe(250_000_000);
  });

  it('sums multiple lines and nets to zero for a fully offset account', () => {
    const lines = [
      { debit: 100, credit: 0 },
      { debit: 0, credit: 60 },
      { debit: 0, credit: 40 },
    ];
    expect(accountBalance('ASSET', lines)).toBe(0);
  });

  it('returns 0 for an account with no lines', () => {
    expect(accountBalance('ASSET', [])).toBe(0);
  });
});
