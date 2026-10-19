import { describe, expect, it } from 'vitest';
import { diffSnapshots, invoiceEditBlock, invoiceVoidBlock, netStockDeltas, reverseJournalLines, snapshotInvoice, type AmendableInvoice } from './invoice-amendment.js';
import { quotationEditBlock, quotationVoidBlock } from './quotation-rules.js';

const ok: AmendableInvoice = {
  status: 'CONFIRMED', paidAmount: 0, signedAt: null, deliveryConfirmedAt: null,
  paymentsCount: 0, checksCount: 0, returnsCount: 0, activeShipmentsCount: 0,
};

describe('invoiceEditBlock — state rules', () => {
  it('allows a confirmed, unpaid, undelivered invoice', () => {
    expect(invoiceEditBlock(ok)).toBeNull();
    expect(invoiceVoidBlock(ok)).toBeNull();
  });
  it.each([
    ['paid', { status: 'PAID', paidAmount: 100 }, /برگشت از فروش/],
    ['partially paid', { status: 'PARTIALLY_PAID', paidAmount: 10 }, /پرداخت دارد/],
    ['payment rows but status confirmed', { paymentsCount: 1 }, /پرداخت دارد/],
    ['cheque attached', { checksCount: 1 }, /چک/],
    ['has returns', { returnsCount: 1 }, /مرجوعی/],
    ['delivery confirmed', { deliveryConfirmedAt: new Date() }, /تحویل/],
    ['signed', { signedAt: new Date() }, /امضا/],
    ['active shipment', { activeShipmentsCount: 1 }, /بار/],
    ['cancelled', { status: 'CANCELLED' }, /باطل/],
    ['draft', { status: 'DRAFT' }, /پیش‌نویس/],
  ])('blocks edit when %s', (_n, patch, msg) => {
    expect(invoiceEditBlock({ ...ok, ...patch })).toMatch(msg);
  });
  it('void: signed invoices may still be voided, but paid/delivered/shipped/returned may not', () => {
    expect(invoiceVoidBlock({ ...ok, signedAt: new Date() })).toBeNull();
    expect(invoiceVoidBlock({ ...ok, paidAmount: 5 })).toMatch(/پرداخت/);
    expect(invoiceVoidBlock({ ...ok, deliveryConfirmedAt: new Date() })).toMatch(/تحویل/);
    expect(invoiceVoidBlock({ ...ok, activeShipmentsCount: 2 })).toMatch(/بار/);
    expect(invoiceVoidBlock({ ...ok, returnsCount: 1 })).toMatch(/مرجوعی/);
    expect(invoiceVoidBlock({ ...ok, status: 'CANCELLED' })).toMatch(/قبلاً باطل/);
  });
});

describe('netStockDeltas', () => {
  it('posts only the net difference per product', () => {
    const d = netStockDeltas(
      [{ productId: 'a', quantity: 5 }, { productId: 'b', quantity: 2 }, { productId: null, quantity: 9 }],
      [{ productId: 'a', quantity: 8 }, { productId: 'b', quantity: 2 }, { productId: 'c', quantity: 1 }],
    );
    expect(d).toEqual([{ productId: 'a', issueDelta: 3 }, { productId: 'c', issueDelta: 1 }]);
  });
  it('returns stock when a quantity drops or a line is removed', () => {
    expect(netStockDeltas([{ productId: 'a', quantity: 5 }], [])).toEqual([{ productId: 'a', issueDelta: -5 }]);
    expect(netStockDeltas([{ productId: 'a', quantity: 5 }, { productId: 'a', quantity: 1 }], [{ productId: 'a', quantity: 2 }])).toEqual([{ productId: 'a', issueDelta: -4 }]);
  });
});

describe('reverseJournalLines', () => {
  it('swaps debit and credit so the reversal nets the original to zero', () => {
    const orig = [
      { accountId: 'ar', debit: 1000n, credit: 0n },
      { accountId: 'rev', debit: 0n, credit: 1000n },
    ];
    const rev = reverseJournalLines(orig);
    const sum = (ls: Array<{ debit: bigint; credit: bigint }>) => ({ d: ls.reduce((s, l) => s + l.debit, 0n), c: ls.reduce((s, l) => s + l.credit, 0n) });
    expect(rev[0]).toMatchObject({ accountId: 'ar', debit: 0n, credit: 1000n });
    expect(sum([...orig, ...rev]).d).toBe(sum([...orig, ...rev]).c);
    expect(sum(rev).d).toBe(sum(orig).c);
  });
});

describe('diffSnapshots', () => {
  const base = snapshotInvoice({
    contactId: 'c1', contact: { name: 'الف' }, dueAt: null, discount: 0, subtotal: 100, taxRate: null, taxAmount: 0, total: 100,
    notes: null, paymentMethod: 'CASH', paymentBankInfo: null, lines: [{ productId: 'p', description: 'کالا', quantity: 1, unitPrice: 100 }],
  });
  it('is empty for identical snapshots', () => {
    expect(diffSnapshots(base, structuredClone(base))).toEqual([]);
  });
  it('reports totals, line quantity changes, added and removed lines', () => {
    const after = { ...structuredClone(base), total: 250, subtotal: 250, lines: [{ productId: 'p', description: 'کالا', quantity: 2, unitPrice: 100 }, { productId: null, description: 'حمل', quantity: 1, unitPrice: 50 }] };
    const fields = diffSnapshots(base, after).map((c) => c.field);
    expect(fields).toContain('مبلغ نهایی');
    expect(fields).toContain('قلم «کالا»');
    expect(fields).toContain('قلم «حمل»');
    const removed = diffSnapshots(base, { ...structuredClone(base), lines: [] }).find((c) => c.field === 'قلم «کالا»');
    expect(removed?.to).toBeNull();
  });
});

describe('quotation rules', () => {
  it('edit: converted/cancelled blocked, everything else allowed', () => {
    expect(quotationEditBlock('CONVERTED')).toMatch(/تبدیل/);
    expect(quotationEditBlock('CANCELLED')).toMatch(/باطل/);
    for (const s of ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']) expect(quotationEditBlock(s)).toBeNull();
  });
  it('void: draft is deleted instead; converted/cancelled blocked', () => {
    expect(quotationVoidBlock('DRAFT')).toMatch(/حذف/);
    expect(quotationVoidBlock('CONVERTED')).toMatch(/تبدیل/);
    expect(quotationVoidBlock('CANCELLED')).toMatch(/قبلاً/);
    expect(quotationVoidBlock('SENT')).toBeNull();
    expect(quotationVoidBlock('ACCEPTED')).toBeNull();
  });
});
