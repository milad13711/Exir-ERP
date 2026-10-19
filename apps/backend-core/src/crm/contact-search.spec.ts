import { describe, expect, it, vi } from 'vitest';
import { buildContactSearchWhere, clampLimit, nameVariants, searchContacts, toLatinDigits } from './contact-search.js';

describe('contact search', () => {
  it('normalises Persian digits and Arabic letters', () => {
    expect(toLatinDigits('۰۹۱۲۳')).toBe('09123');
    expect(nameVariants('علي')).toEqual(expect.arrayContaining(['علي', 'علی']));
  });
  it('empty query keeps only the kind filter', () => {
    expect(buildContactSearchWhere(undefined, 'supplier')).toEqual({ isSupplier: true });
    expect(buildContactSearchWhere('  ', 'customer')).toEqual({ isCustomer: true });
    expect(buildContactSearchWhere('', 'all')).toEqual({});
  });
  it('numeric terms search phone and national/economic/legal ids, ignoring leading zero', () => {
    const w = buildContactSearchWhere('۰۹۱۲۳۴۵', 'all') as { OR: Array<Record<string, any>> };
    expect(w.OR).toEqual(expect.arrayContaining([{ phone: { contains: '91234' + '5' } }, { nationalId: { contains: '0912345' } }, { economicCode: { contains: '0912345' } }]));
  });
  it('text terms search name and company', () => {
    const w = buildContactSearchWhere('شرکت الف', 'customer') as { isCustomer: boolean; OR: Array<Record<string, any>> };
    expect(w.isCustomer).toBe(true);
    expect(w.OR.some((c) => c.company)).toBe(true);
    expect(w.OR.some((c) => c.name)).toBe(true);
  });
  it('limit is clamped', () => {
    expect(clampLimit(undefined)).toBe(15);
    expect(clampLimit('5')).toBe(5);
    expect(clampLimit(9999)).toBe(30);
    expect(clampLimit(-1)).toBe(15);
  });
  it('applies the caller scope and a take limit', async () => {
    const findMany = vi.fn(async () => []);
    await searchContacts({ crmContact: { findMany } } as never, { q: 'علی', scope: { ownerUserId: 'u1' }, limit: 500 });
    const arg = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown>; take: number }])[0];
    expect(arg.where.ownerUserId).toBe('u1');
    expect(arg.take).toBe(30);
  });
});
