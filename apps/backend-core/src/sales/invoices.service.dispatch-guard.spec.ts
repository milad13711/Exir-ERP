import { describe, expect, it, vi } from 'vitest';
import { InvoicesService } from './invoices.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

function build(pendingCount: number) {
  const noop = {} as never;
  const service = new InvoicesService(noop, noop, noop, noop, noop, noop, noop, { tenantModule: { findMany: vi.fn(async () => []) }, moduleDefinition: { findMany: vi.fn(async () => []) } } as never, noop, { closeForEntity: vi.fn(), registerHandler: vi.fn() } as never, noop);
  const tenantDb = {
    salesInvoice: { findUnique: vi.fn(async () => ({ id: 'inv-1', status: 'DRAFT', contactId: 'c1' })), update: vi.fn(), delete: vi.fn() },
    taxInvoice: { findFirst: vi.fn(async () => null) },
    dispatchInvoiceAdjustment: { count: vi.fn(async () => pendingCount) },
    salesInvoiceLine: { deleteMany: vi.fn() },
    crmContact: { findUniqueOrThrow: vi.fn(async () => ({ id: 'c1' })) },
  };
  return { service, tenantDb, ctx: { tenantDb, tenantId: 't' } as unknown as TenantRequestContext };
}

describe('InvoicesService draft edit/delete vs pending dispatch adjustment', () => {
  it('updateDraft is blocked with a clear message and lines are not rebuilt', async () => {
    const { service, tenantDb, ctx } = build(1);
    await expect(service.updateDraft(ctx, 'inv-1', { contactId: 'c1', lines: [] } as never)).rejects.toThrow(/اصلاحیه/);
    expect(tenantDb.salesInvoiceLine.deleteMany).not.toHaveBeenCalled();
    expect(tenantDb.salesInvoice.update).not.toHaveBeenCalled();
    expect(tenantDb.dispatchInvoiceAdjustment.count).toHaveBeenCalledWith({ where: { invoiceId: 'inv-1', status: 'PROPOSED' } });
  });

  it('removeDraft is blocked too', async () => {
    const { service, tenantDb, ctx } = build(2);
    await expect(service.removeDraft(ctx, 'inv-1')).rejects.toThrow(/اصلاحیه/);
    expect(tenantDb.salesInvoice.delete).not.toHaveBeenCalled();
  });
});
