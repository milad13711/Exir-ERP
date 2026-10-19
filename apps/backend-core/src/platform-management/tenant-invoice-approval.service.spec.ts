import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { TenantInvoiceApprovalService } from './tenant-invoice-approval.service.js';
import { invoiceContentHash } from './tenant-invoice-approval.logic.js';
import { ForbiddenException } from '@nestjs/common';

process.env.PLATFORM_TENANT_SLUG = 'eta';
const ctx = { auth: { type: 'tenant_user', sub: 'mgr', role: 'OWNER' }, tenantSlug: 'eta', tenantId: 'parent' } as never;

const DUE = new Date('2026-11-01T00:00:00Z');
const ITEMS = [{ moduleName: 'CRM', billingMode: 'MONTHLY', amount: 100 }];
const baseInvoice = (over: Record<string, unknown> = {}) => ({ id: 'i1', tenantId: 't1', amount: 100, dueAt: DUE, status: 'AWAITING_APPROVAL', purpose: 'MODULE_RENEWAL', items: ITEMS, tenant: { name: 'مشتری' }, approvalHash: invoiceContentHash({ amount: 100, dueAt: DUE, items: ITEMS }), lastEditedById: null, ...over });

function make(o: { settings?: unknown; parent?: boolean; invoice?: Record<string, unknown> | null; claimed?: number } = {}) {
  const parentDb = {
    moduleSetting: { findUnique: vi.fn().mockResolvedValue(o.settings ? { value: o.settings } : null), upsert: vi.fn().mockResolvedValue({}) },
    approvalRequest: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const tenantDb = { user: { findMany: vi.fn().mockResolvedValue([{ id: 'tu1', globalUserId: 'g1' }]) } };
  const controlDb = {
    tenant: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { slug?: string } }) =>
        Promise.resolve(where.slug ? (o.parent === false ? null : { id: 'parent', slug: 'eta', name: 'اکسیرتجارت امین', status: 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'p' }) : { id: 't1', name: 'مشتری', dbHost: 'h', dbPort: 1, dbName: 'c' })),
    },
    invoice: {
      findUnique: vi.fn().mockResolvedValue(o.invoice === undefined ? baseInvoice() : o.invoice),
      updateMany: vi.fn().mockResolvedValue({ count: o.claimed ?? 1 }),
      update: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ amount: 70, dueAt: DUE }),
      findMany: vi.fn().mockResolvedValue([{ id: 'i1' }]),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    tenantMembership: { findMany: vi.fn().mockResolvedValue([{ globalUserId: 'g1', globalUser: { phone: '0912' } }]), findFirst: vi.fn().mockResolvedValue({ globalUser: { phone: '0912' } }) },
  };
  const tenantPrisma = { forTenant: vi.fn().mockImplementation((c: { dbName: string }) => (c.dbName === 'p' ? parentDb : tenantDb)) };
  const approvals = { registerHandler: vi.fn(), request: vi.fn().mockResolvedValue({ id: 'ar1' }) };
  const notify = vi.fn().mockResolvedValue(undefined);
  const sms = { isConfigured: () => true, sendSms: vi.fn().mockResolvedValue({ success: true }) };
  (ctx as unknown as { tenantDb: unknown }).tenantDb = parentDb;
  const svc = new TenantInvoiceApprovalService(controlDb as never, tenantPrisma as never, approvals as never, { notify } as never, sms as never);
  return { svc, controlDb, approvals, notify, sms, parentDb };
}

describe('TenantInvoiceApprovalService', () => {
  it('registers the TENANT_INVOICE handler in the approvals inbox', () => {
    const { svc, approvals } = make();
    svc.onModuleInit();
    expect(approvals.registerHandler).toHaveBeenCalledWith('TENANT_INVOICE', expect.objectContaining({ approve: expect.any(Function), reject: expect.any(Function), describe: expect.any(Function) }));
  });

  it('auto invoices start as AWAITING_APPROVAL; manual/checkout stay PENDING; no parent = PENDING', async () => {
    expect((await make().svc.initialState('AUTO')).status).toBe('AWAITING_APPROVAL');
    expect((await make().svc.initialState('MANUAL')).status).toBe('PENDING');
    expect((await make().svc.initialState('CHECKOUT')).status).toBe('PENDING');
    expect((await make({ parent: false }).svc.initialState('AUTO')).status).toBe('PENDING');
    expect((await make({ settings: { requireForAuto: false } }).svc.initialState('AUTO')).status).toBe('PENDING');
  });

  it('submit puts a TENANT_INVOICE request into the parent tenant approvals inbox', async () => {
    const { svc, approvals } = make();
    expect(await svc.submit('i1')).toBe(true);
    const [reqCtx, input] = approvals.request.mock.calls[0];
    expect(reqCtx.tenantId).toBe('parent');
    expect(input).toMatchObject({ entityType: 'TENANT_INVOICE', entityId: 'i1', moduleCode: 'platform' });
  });

  it('submit is a no-op for a non-awaiting invoice', async () => {
    const { svc, approvals } = make({ invoice: { id: 'i1', status: 'PENDING', tenant: { name: 'x' }, amount: 1 } });
    expect(await svc.submit('i1')).toBe(false);
    expect(approvals.request).not.toHaveBeenCalled();
  });

  it('approve opens the invoice for payment, audits, and notifies the tenant managers (+renewal SMS)', async () => {
    const { svc, controlDb, notify, sms } = make();
    await svc.approve(ctx, 'i1', 'ok');
    expect(controlDb.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'i1', status: 'AWAITING_APPROVAL' }), data: expect.objectContaining({ status: 'PENDING', approvalNote: 'ok' }) }));
    expect(controlDb.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'invoice.approved', tenantId: 't1', actorId: 'mgr' });
    await new Promise((r) => setTimeout(r, 0));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toMatchObject({ userId: 'tu1', type: 'billing.invoice_issued' });
    expect(sms.sendSms).toHaveBeenCalledTimes(1);
  });

  it('double approval notifies only once (atomic claim)', async () => {
    const { svc, notify } = make({ claimed: 0 });
    await svc.approve(ctx, 'i1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('reject marks FAILED with the reason and keeps the renewal lock (no daily re-issue loop)', async () => {
    const { svc, controlDb } = make();
    await svc.reject(ctx, 'i1', 'مبلغ اشتباه');
    expect(controlDb.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FAILED', approvalNote: 'مبلغ اشتباه' } }));
    expect(controlDb.auditLog.create.mock.calls[0][0].data.action).toBe('invoice.rejected');
  });

  it('edit is only allowed while awaiting approval and recomputes totals', async () => {
    const paid = make({ invoice: { id: 'i1', status: 'PENDING' } });
    await expect(paid.svc.editAwaiting({ sub: 'm', tenantSlug: 'eta' }, 'i1', { amount: 5 })).rejects.toBeInstanceOf(BadRequestException);
    const { svc, controlDb } = make();
    await svc.editAwaiting({ sub: 'm', tenantSlug: 'eta' }, 'i1', { lines: [{ index: 0, amount: 70 }] });
    const w = controlDb.invoice.updateMany.mock.calls[0][0];
    expect(w.where).toMatchObject({ id: 'i1', status: 'AWAITING_APPROVAL' });
    expect(w.data).toMatchObject({ amount: 70, lastEditedById: 'm' });
  });

  it('holdIfRequired moves a fresh staff invoice to awaiting only when the toggle is on', async () => {
    const off = make();
    expect(await off.svc.holdIfRequired('i1', 'STAFF')).toBe(false);
    const on = make({ settings: { requireForStaff: true } });
    expect(await on.svc.holdIfRequired('i1', 'STAFF')).toBe(true);
    expect(on.controlDb.invoice.updateMany).toHaveBeenCalled();
  });

  it('edit loses the race: if the status changed meanwhile, nothing is written and it errors', async () => {
    const { svc, controlDb, parentDb } = make();
    controlDb.invoice.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.editAwaiting({ sub: 'm', tenantSlug: 'eta' }, 'i1', { lines: [{ index: 0, amount: 70 }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(parentDb.approvalRequest.updateMany).not.toHaveBeenCalled();
  });

  it('a successful edit supersedes the old inbox request and re-submits with a fresh hash', async () => {
    const { svc, parentDb, approvals } = make();
    await svc.editAwaiting({ sub: 'm', tenantSlug: 'eta' }, 'i1', { lines: [{ index: 0, amount: 70 }] });
    expect(parentDb.approvalRequest.updateMany.mock.calls[0][0].where).toMatchObject({ entityType: 'TENANT_INVOICE', entityId: 'i1', status: 'PENDING' });
    expect(approvals.request).toHaveBeenCalled();
  });

  it('approve is refused when the invoice content no longer matches what the manager saw', async () => {
    const { svc, controlDb } = make({ invoice: baseInvoice({ amount: 999 }) });
    await expect(svc.approve(ctx, 'i1')).rejects.toThrow('فاکتور تغییر کرده است');
    expect(controlDb.invoice.updateMany).not.toHaveBeenCalled();
    const noHash = make({ invoice: baseInvoice({ approvalHash: null }) });
    await expect(noHash.svc.approve(ctx, 'i1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approve/reject are refused outside the parent tenant', async () => {
    const { svc } = make();
    const other = { ...(ctx as object), tenantSlug: 'evil' } as never;
    await expect(svc.approve(other, 'i1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.reject(other, 'i1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maker-checker: editor cannot approve their own edit when requireDifferentApprover is on', async () => {
    const on = make({ settings: { requireDifferentApprover: true }, invoice: baseInvoice({ lastEditedById: 'mgr' }) });
    await expect(on.svc.approve(ctx, 'i1')).rejects.toBeInstanceOf(ForbiddenException);
    const off = make({ invoice: baseInvoice({ lastEditedById: 'mgr' }) });
    await expect(off.svc.approve(ctx, 'i1')).resolves.toBeUndefined();
  });
});
