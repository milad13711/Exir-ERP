import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SubscriptionSummaryService } from './subscription-summary.service.js';

const DAY = 86_400_000;
function make(over: { tenantStatus?: string; sub?: Record<string, unknown> | null; invoices?: unknown[]; license?: unknown } = {}) {
  const now = Date.now();
  const controlDb = {
    tenant: { findUnique: vi.fn().mockResolvedValue({ status: over.tenantStatus ?? 'ACTIVE' }) },
    subscription: {
      findMany: vi.fn().mockResolvedValue(over.sub === null ? [] : [{ status: 'ACTIVE', startedAt: new Date(now - 100 * DAY), currentPeriodEnd: new Date(now + 5 * DAY), lifetime: false, autoRenew: true, plan: { name: 'پرو', code: 'pro' }, ...(over.sub ?? {}) }]),
      findFirst: vi.fn().mockResolvedValue({ id: 's1', status: 'ACTIVE', currentPeriodEnd: new Date(now + 200 * DAY), lifetime: false, plan: { code: 'pro', priceMonthly: 500 } }),
    },
    invoice: { findMany: vi.fn().mockResolvedValue(over.invoices ?? []), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    moduleDefinition: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', code: 'crm', name: 'CRM', isCore: false, priceMonthly: 100 }]) },
    tenantModule: { findMany: vi.fn().mockResolvedValue([{ moduleId: 'm1', status: 'INSTALLED', billingMode: 'MONTHLY', currentPeriodEnd: new Date(now + 3 * DAY), pendingRenewalInvoiceId: null }]) },
    auditLog: { create: vi.fn() },
  };
  (controlDb as never as Record<string, unknown>).$executeRaw = vi.fn().mockResolvedValue(1);
  (controlDb as never as Record<string, unknown>).$transaction = (fn: (tx: unknown) => unknown) => fn(controlDb);
  const license = over.license ? { getStatus: () => over.license } : undefined;
  const moduleRenewal = { requestRenewal: vi.fn().mockResolvedValue({ invoiceId: 'i', status: 'PENDING', created: true }) };
  return { svc: new SubscriptionSummaryService(controlDb as never, moduleRenewal as never, license as never), controlDb, moduleRenewal };
}

describe('SubscriptionSummaryService', () => {
  it('admin gets full detail incl. banner built from tenant + module', async () => {
    const { svc } = make();
    const s = await svc.forTenant('t1', { viewer: 'ADMIN' });
    expect(s.viewer).toBe('ADMIN');
    expect(s.tenant.state).toBe('EXPIRING_SOON');
    expect(s.modules[0]).toMatchObject({ code: 'crm', state: 'EXPIRING_SOON', nextAction: 'REQUEST_INVOICE' });
    expect(s.banner?.scope).toBe('tenant');
  });

  it('member view is redacted (no plan, dates, invoice ids)', async () => {
    const { svc } = make({ sub: { currentPeriodEnd: new Date(Date.now() - 2 * DAY) }, invoices: [{ id: 'secret-inv', amount: 777, status: 'PENDING', purpose: 'PLAN_RENEWAL', items: null, dueAt: new Date(), paidAt: null }] });
    const s = await svc.forTenant('t1', { viewer: 'MEMBER' });
    expect(s.viewer).toBe('MEMBER');
    expect(JSON.stringify(s)).not.toMatch(/secret-inv|777|پرو/);
    expect(s.tenant.state).toBe('GRACE');
  });

  it('on-premise licence overrides a junk cloud row; admin view of another tenant ignores local licence', async () => {
    const lic = { mode: 'on_premise', state: 'valid', daysLeft: null, warningLevel: 0 };
    const { svc } = make({ sub: { status: 'PAST_DUE', currentPeriodEnd: new Date(Date.now() - 400 * DAY) }, license: lic });
    expect((await svc.forTenant('t1', { viewer: 'ADMIN' })).tenant).toMatchObject({ state: 'NO_EXPIRY', source: 'ON_PREMISE_LICENSE' });
    expect((await svc.forTenant('t1', { viewer: 'ADMIN', useLocalLicense: false })).tenant.source).toBe('CLOUD_SUBSCRIPTION');
  });

  it('only reads the requested tenant (no cross-tenant filter gaps)', async () => {
    const { svc, controlDb } = make();
    await svc.forTenant('tenant-A', { viewer: 'ADMIN' });
    expect(controlDb.subscription.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-A');
    expect(controlDb.invoice.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-A');
    expect(controlDb.tenantModule.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-A');
  });

  it('plan renewal request is refused for lifetime and too-early subscriptions; module requests delegate', async () => {
    const lifetime = make();
    lifetime.controlDb.subscription.findFirst.mockResolvedValue({ id: 's1', status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 99999 * DAY), lifetime: true, plan: { code: 'p', priceMonthly: 1 } });
    await expect(lifetime.svc.requestRenewal('t1')).rejects.toBeInstanceOf(BadRequestException);
    const early = make();
    await expect(early.svc.requestRenewal('t1')).rejects.toBeInstanceOf(BadRequestException);
    const m = make();
    await m.svc.requestRenewal('t1', 'crm');
    expect(m.moduleRenewal.requestRenewal).toHaveBeenCalledWith('t1', 'crm');
  });

  it('plan renewal request when due creates a PLAN_RENEWAL invoice (not held for approval) and is idempotent', async () => {
    const a = make();
    a.controlDb.subscription.findFirst.mockResolvedValue({ id: 's1', status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 2 * DAY), lifetime: false, plan: { code: 'pro', priceMonthly: 500 } });
    a.controlDb.invoice.create.mockResolvedValue({ id: 'new' });
    expect(await a.svc.requestRenewal('t1')).toEqual({ invoiceId: 'new', status: 'PENDING', created: true });
    expect(a.controlDb.invoice.create.mock.calls[0][0].data).toMatchObject({ purpose: 'PLAN_RENEWAL', status: 'PENDING', amount: 500 });
    expect((a.controlDb as never as { $executeRaw: { mock: { calls: unknown[] } } }).$executeRaw.mock.calls.length).toBe(1); // advisory lock taken

    const b = make();
    b.controlDb.subscription.findFirst.mockResolvedValue({ id: 's1', status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 2 * DAY), lifetime: false, plan: { code: 'pro', priceMonthly: 500 } });
    b.controlDb.invoice.findFirst.mockResolvedValue({ id: 'existing', status: 'AWAITING_APPROVAL', purpose: 'PLAN_RENEWAL', items: null });
    expect(await b.svc.requestRenewal('t1')).toEqual({ invoiceId: 'existing', status: 'AWAITING_APPROVAL', created: false });
    expect(b.controlDb.invoice.create).not.toHaveBeenCalled();
  });
});
