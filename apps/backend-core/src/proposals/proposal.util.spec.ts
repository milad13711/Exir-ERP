import { describe, expect, it } from 'vitest';
import { buildInvoiceNotes, expiryInstant, extractClientIp, isProposalExpired, resolveInvoiceLines } from './proposal.util.js';

describe('proposal util', () => {
  it('a calendar date (UTC midnight) stays valid through the end of that day', () => {
    const validUntil = new Date('2026-10-10T00:00:00.000Z');
    expect(isProposalExpired(validUntil, new Date('2026-10-10T20:00:00.000Z'))).toBe(false);
    expect(isProposalExpired(validUntil, new Date('2026-10-11T00:00:01.000Z'))).toBe(true);
    expect(expiryInstant(validUntil)).toBe(validUntil.getTime() + 24 * 3600 * 1000 - 1);
  });

  it('a date with a time of day expires at that exact instant; null never expires', () => {
    const validUntil = new Date('2026-10-10T08:30:00.000Z');
    expect(isProposalExpired(validUntil, new Date('2026-10-10T08:29:00.000Z'))).toBe(false);
    expect(isProposalExpired(validUntil, new Date('2026-10-10T08:31:00.000Z'))).toBe(true);
    expect(isProposalExpired(null)).toBe(false);
  });

  it('invoice notes carry proposal number, due date, deadline and payment terms', () => {
    const notes = buildInvoiceNotes(
      { proposalNo: 12, title: 'سایت', paymentDeadline: '۷ روز', paymentTerms: '۵۰٪ پیش‌پرداخت', paymentMethodText: 'کارت به کارت' },
      new Date('2026-10-10T00:00:00.000Z'),
    );
    expect(notes).toContain('۱۲');
    expect(notes).toContain('تاریخ سررسید:');
    expect(notes).toContain('مهلت پرداخت: ۷ روز');
    expect(notes).toContain('شرایط پرداخت: ۵۰٪ پیش‌پرداخت');
  });

  it('defaults to one invoice line with the project amount; user-defined lines win', () => {
    const base = { proposalNo: 3, title: 'T', amount: 5_000_000, invoiceLines: null };
    expect(resolveInvoiceLines(base)).toEqual([{ description: expect.stringContaining('T'), quantity: 1, unitPrice: 5_000_000 }]);
    expect(resolveInvoiceLines({ ...base, invoiceLines: [{ description: 'a', quantity: 2, unitPrice: 10 }] })).toEqual([{ description: 'a', quantity: 2, unitPrice: 10 }]);
  });

  it('client ip prefers the first x-forwarded-for hop', () => {
    expect(extractClientIp({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }, '127.0.0.1')).toBe('1.2.3.4');
    expect(extractClientIp({}, '127.0.0.1')).toBe('127.0.0.1');
  });
});
