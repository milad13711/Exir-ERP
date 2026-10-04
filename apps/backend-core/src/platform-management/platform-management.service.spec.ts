import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PlatformManagementService } from './platform-management.service.js';

const ctx = { auth: { type: 'tenant_user', sub: 'u1', role: 'OWNER' }, tenantSlug: 'eta', tenantId: 't0' } as never;

function make(db: Record<string, unknown>, tenants: Record<string, unknown> = {}, gateway: Record<string, unknown> = {}) {
  const controlDb = { globalUser: { findUnique: vi.fn().mockResolvedValue({ name: 'مدیر' }) }, auditLog: { create: vi.fn().mockResolvedValue({}) }, ...db };
  const svc = new PlatformManagementService(controlDb as never, {} as never, tenants as never, gateway as never, {} as never);
  return { svc, controlDb };
}

describe('PlatformManagementService', () => {
  it('refuses to cancel a PAID invoice', async () => {
    const { svc } = make({ invoice: { findUnique: vi.fn().mockResolvedValue({ id: 'i', status: 'PAID', tenantId: 't1', amount: 1 }) } });
    await expect(svc.cancelInvoice(ctx, 'i')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancels a pending invoice, releases the renewal lock and audits with parent-tenant source', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'i', status: 'FAILED' });
    const updateMany = vi.fn().mockResolvedValue({});
    const { svc, controlDb } = make({ invoice: { findUnique: vi.fn().mockResolvedValue({ id: 'i', status: 'PENDING', tenantId: 't1', amount: 5 }), update }, tenantModule: { updateMany } });
    await svc.cancelInvoice(ctx, 'i');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(updateMany).toHaveBeenCalledWith({ where: { pendingRenewalInvoiceId: 'i' }, data: { pendingRenewalInvoiceId: null } });
    const audit = controlDb.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ actorType: 'global_user', actorId: 'u1', tenantId: 't1', action: 'invoice.updated' });
    expect(audit.metadata).toMatchObject({ source: 'parent-tenant', parentTenantSlug: 'eta', actorName: 'مدیر' });
  });

  it('mark-paid reuses TenantsService settlement with parent-tenant audit tagging', async () => {
    const markInvoicePaid = vi.fn().mockResolvedValue({ id: 'i', status: 'PAID' });
    const { svc } = make({ invoice: { findUnique: vi.fn().mockResolvedValue({ id: 'i' }) } }, { markInvoicePaid });
    await svc.markInvoicePaid(ctx, 'i');
    expect(markInvoicePaid).toHaveBeenCalledWith('i', 'u1', { actorType: 'global_user', metadata: expect.objectContaining({ source: 'parent-tenant' }) });
  });

  it('module invoice uses catalog pricing helpers per billing mode', async () => {
    const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'inv', ...data }));
    const mod = { code: 'crm', name: 'CRM', priceMonthly: 100, priceYearly: null };
    const { svc } = make({
      tenant: { findUnique: vi.fn().mockResolvedValue({ id: 't1', dbHost: 'h', dbPort: 1, dbName: 'd' }) },
      moduleDefinition: { findMany: vi.fn().mockResolvedValue([mod]) },
      invoice: { create },
    });
    (svc as never as { notifyInvoiceIssued: () => Promise<void> }).notifyInvoiceIssued = async () => undefined;
    const inv = await svc.createModuleInvoice(ctx, 't1', { items: [{ code: 'crm', billingMode: 'YEARLY' }, { code: 'crm', billingMode: 'MONTHLY' }] });
    expect(inv.amount).toBe(500 + 100);
    expect(inv.purpose).toBe('MODULE_PURCHASE');
  });

  it('ticket reply is stored as ADMIN message (tenant sees it like an admin reply) and broadcast', async () => {
    const ticket = { id: 'tk', tenantId: 't1' };
    const message = { id: 'm1' };
    const create = vi.fn().mockResolvedValue(message);
    const notifyNewMessage = vi.fn();
    const { svc } = make({ supportTicket: { findUnique: vi.fn().mockResolvedValue(ticket) }, supportMessage: { create } }, {}, { notifyNewMessage });
    await svc.replyToTicket(ctx, 'tk', 'سلام');
    expect(create).toHaveBeenCalledWith({ data: { ticketId: 'tk', senderType: 'ADMIN', senderId: 'u1', body: 'سلام' } });
    expect(notifyNewMessage).toHaveBeenCalledWith(ticket, message);
  });
});
