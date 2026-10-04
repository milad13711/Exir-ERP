import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { InvoicesController } from './invoices.controller.js';

function setup(opts: { scope: Record<string, unknown>; found: boolean }) {
  const perms = {
    assertEdit: vi.fn(),
    assertDelete: vi.fn(),
    viewScope: vi.fn(async () => opts.scope),
  } as any;
  const invoices = { confirm: vi.fn(async () => 'ok'), recordPayment: vi.fn(async () => 'ok'), removeDraft: vi.fn(async () => 'ok'), detail: vi.fn(async () => ({})) } as any;
  const ctx = { tenantDb: { salesInvoice: { findFirst: vi.fn(async () => (opts.found ? { id: 'i1' } : null)) } } } as any;
  const c = new (InvoicesController as any)(invoices, perms, {}, {}) as InvoicesController;
  return { c, invoices, ctx };
}

describe('InvoicesController — by-id actions respect view-own scope', () => {
  it('blocks confirm/payment/delete on another user invoice (404, service never called)', async () => {
    const { c, invoices, ctx } = setup({ scope: { createdByUserId: 'me' }, found: false });
    await expect(c.confirm('i1', ctx)).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.recordPayment('i1', {} as any, ctx)).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.removeDraft('i1', ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(invoices.confirm).not.toHaveBeenCalled();
    expect(invoices.recordPayment).not.toHaveBeenCalled();
    expect(invoices.removeDraft).not.toHaveBeenCalled();
  });

  it('allows the action on an own invoice and queries with the owner field', async () => {
    const { c, invoices, ctx } = setup({ scope: { createdByUserId: 'me' }, found: true });
    await expect(c.confirm('i1', ctx)).resolves.toBe('ok');
    expect(ctx.tenantDb.salesInvoice.findFirst).toHaveBeenCalledWith({ where: { id: 'i1', createdByUserId: 'me' }, select: { id: true } });
    expect(invoices.confirm).toHaveBeenCalled();
  });

  it('view-all users skip the extra lookup', async () => {
    const { c, ctx } = setup({ scope: {}, found: false });
    await expect(c.confirm('i1', ctx)).resolves.toBe('ok');
    expect(ctx.tenantDb.salesInvoice.findFirst).not.toHaveBeenCalled();
  });
});
