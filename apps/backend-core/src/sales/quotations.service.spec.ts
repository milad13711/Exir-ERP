import { describe, expect, it, vi } from 'vitest';
import { QuotationsService } from './quotations.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

function setup(status: string) {
  const q = { id: 'q1', status, contactId: 'c1', discount: 0, subtotal: 300, total: 300, notes: null, validUntil: null, revisionCount: 0, lines: [{ description: 'الف', quantity: 3, unitPrice: 100 }] };
  const updates: Array<Record<string, any>> = [];
  const revisions: Array<Record<string, any>> = [];
  const db: any = {
    salesQuotation: {
      findFirst: vi.fn(async () => q),
      update: vi.fn(async (a: any) => { updates.push(a.data); return { ...q, ...a.data }; }),
      delete: vi.fn(),
    },
    crmContact: { findUniqueOrThrow: vi.fn(async () => ({})) },
    user: { findUnique: vi.fn(async () => ({ id: 'u1', name: 'فروشنده' })) },
    documentRevision: { create: vi.fn(async ({ data }: any) => { revisions.push(data); return data; }) },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const svc = new QuotationsService({} as never, { emit: vi.fn() } as never);
  const ctx = { tenantDb: db, auth: { role: 'OWNER', sub: 'g' }, tenantId: 't' } as unknown as TenantRequestContext;
  return { svc, ctx, db, updates, revisions };
}

describe('QuotationsService edit / void after sending', () => {
  it('draft edit is free (no reason, no revision)', async () => {
    const t = setup('DRAFT');
    await t.svc.update(t.ctx, 'q1', { discount: 50 }, {});
    expect(t.updates[0]).toMatchObject({ discount: 50, subtotal: 300, total: 250 });
    expect(t.revisions).toHaveLength(0);
  });
  it('a sent/accepted quotation needs a reason, goes back to DRAFT, and keeps a revision', async () => {
    const t = setup('ACCEPTED');
    await expect(t.svc.update(t.ctx, 'q1', { discount: 50 }, {})).rejects.toThrow(/دلیل/);
    await t.svc.update(t.ctx, 'q1', { discount: 50, reason: 'تخفیف توافقی' }, {});
    expect(t.updates[0]).toMatchObject({ status: 'DRAFT', acceptedByName: null, total: 250 });
    expect(t.revisions[0]).toMatchObject({ entityType: 'sales_quotation', action: 'EDIT', reason: 'تخفیف توافقی', userName: 'فروشنده' });
  });
  it('converted and cancelled quotations cannot be edited', async () => {
    await expect(setup('CONVERTED').svc.update(setup('CONVERTED').ctx, 'q1', { notes: 'x', reason: 'دلیل' }, {})).rejects.toThrow(/تبدیل/);
    const t = setup('CANCELLED');
    await expect(t.svc.update(t.ctx, 'q1', { notes: 'x', reason: 'دلیل' }, {})).rejects.toThrow(/باطل/);
  });
  it('hard delete only for drafts; others are soft-cancelled with a reason and a VOID revision', async () => {
    const sent = setup('SENT');
    await expect(sent.svc.remove(sent.ctx, 'q1', {})).rejects.toThrow(/ابطال/);
    expect(sent.db.salesQuotation.delete).not.toHaveBeenCalled();
    await sent.svc.cancel(sent.ctx, 'q1', 'مشتری منصرف شد', {});
    expect(sent.updates[0]).toMatchObject({ status: 'CANCELLED', cancelReason: 'مشتری منصرف شد' });
    expect(sent.revisions[0]).toMatchObject({ action: 'VOID' });
    const conv = setup('CONVERTED');
    await expect(conv.svc.cancel(conv.ctx, 'q1', 'دلیل', {})).rejects.toThrow(/تبدیل/);
    const draft = setup('DRAFT');
    await expect(draft.svc.cancel(draft.ctx, 'q1', 'دلیل', {})).rejects.toThrow(/حذف/);
    await draft.svc.remove(draft.ctx, 'q1', {});
    expect(draft.db.salesQuotation.delete).toHaveBeenCalled();
  });
});
