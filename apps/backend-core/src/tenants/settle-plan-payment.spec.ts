import { describe, expect, it, vi } from 'vitest';
import { TenantsService } from './tenants.service.js';

const DAY = 86_400_000;

function make(sub: Record<string, unknown> | null, invoice: Record<string, unknown>, tenantStatus = 'ACTIVE') {
  const controlDb = {
    invoice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue({ id: 'i1', tenantId: 't1', status: 'PENDING', amount: 5, purpose: null, items: null, ...invoice }), update: vi.fn().mockResolvedValue({ id: 'i1' }) },
    tenant: { findUnique: vi.fn().mockResolvedValue({ status: tenantStatus }), update: vi.fn() },
    auditLog: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    subscription: { findFirst: vi.fn().mockResolvedValue(sub), update: vi.fn() },
    $transaction: vi.fn(),
    tenantSmsWallet: { upsert: vi.fn() },
  };
  controlDb.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(controlDb));
  const svc = new TenantsService(controlDb as never, {} as never, {} as never, { onInvoicePaid: vi.fn() } as never);
  return { svc, controlDb };
}
const trial = (endOffsetDays: number) => ({ id: 's1', status: 'TRIAL', lifetime: false, currentPeriodEnd: new Date(Date.now() + endOffsetDays * DAY) });

describe('paying a plan-level invoice keeps the subscription record in sync', () => {
  it('paid during the free trial -> ACTIVE with ~1 month (no later trial-expiry lock)', async () => {
    const { svc, controlDb } = make(trial(0.5), {});
    await svc.markInvoicePaidByGateway('i1', 123);
    const data = controlDb.subscription.update.mock.calls[0][0].data;
    expect(data.status).toBe('ACTIVE');
    expect(data.currentPeriodEnd.getTime() - Date.now()).toBeGreaterThan(27 * DAY);
  });

  it('unlocking a PENDING_PAYMENT tenant (PAST_DUE, expired) -> ACTIVE with a fresh period', async () => {
    const { svc, controlDb } = make({ id: 's1', status: 'PAST_DUE', lifetime: false, currentPeriodEnd: new Date(Date.now() - 3 * DAY) }, {}, 'PENDING_PAYMENT');
    await svc.markInvoicePaidByGateway('i1', 1);
    expect(controlDb.subscription.update.mock.calls[0][0].data.status).toBe('ACTIVE');
    expect(controlDb.subscription.update.mock.calls[0][0].data.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now() + 27 * DAY);
  });

  it('PLAN_RENEWAL on a healthy ACTIVE subscription extends from its current end', async () => {
    const end = new Date(Date.now() + 5 * DAY);
    const { svc, controlDb } = make({ id: 's1', status: 'ACTIVE', lifetime: false, currentPeriodEnd: end }, { purpose: 'PLAN_RENEWAL' });
    await svc.markInvoicePaidByGateway('i1', 1);
    const newEnd: Date = controlDb.subscription.update.mock.calls[0][0].data.currentPeriodEnd;
    expect(newEnd.getTime() - end.getTime()).toBeGreaterThan(27 * DAY);
  });

  it('manual pre-invoice on a healthy ACTIVE subscription and lifetime subscriptions are untouched', async () => {
    const a = make({ id: 's1', status: 'ACTIVE', lifetime: false, currentPeriodEnd: new Date(Date.now() + 5 * DAY) }, {});
    await a.svc.markInvoicePaidByGateway('i1', 1);
    expect(a.controlDb.subscription.update).not.toHaveBeenCalled();
    const b = make({ id: 's1', status: 'PAST_DUE', lifetime: true, currentPeriodEnd: new Date(Date.now() - DAY) }, {});
    await b.svc.markInvoicePaidByGateway('i1', 1);
    expect(b.controlDb.subscription.update).not.toHaveBeenCalled();
  });

  it('module invoices never touch the plan subscription', async () => {
    const { svc, controlDb } = make(trial(0.5), { purpose: 'MODULE_PURCHASE', items: [] });
    // items خالی ولی purpose ماژولی ⇒ فاکتور سطح پلن نیست
    await svc.markInvoicePaidByGateway('i1', 1).catch(() => undefined);
    expect(controlDb.subscription.update).not.toHaveBeenCalled();
  });

  it('lost race (updateMany count 0, e.g. double gateway callback) runs no side effects', async () => {
    const { svc, controlDb } = make({ id: 's1', status: 'ACTIVE', lifetime: false, currentPeriodEnd: new Date(Date.now() + 5 * DAY) }, { purpose: 'PLAN_RENEWAL' });
    controlDb.invoice.updateMany.mockResolvedValue({ count: 0 });
    await svc.markInvoicePaidByGateway('i1', 1);
    expect(controlDb.subscription.update).not.toHaveBeenCalled();
    expect(controlDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('re-paying an invoice after markInvoiceUnpaid does not extend the subscription twice', async () => {
    const { svc, controlDb } = make({ id: 's1', status: 'ACTIVE', lifetime: false, currentPeriodEnd: new Date(Date.now() + 5 * DAY) }, { purpose: 'PLAN_RENEWAL' });
    controlDb.auditLog.findFirst.mockResolvedValue({ id: 'a1' });
    await svc.markInvoicePaidByGateway('i1', 1);
    expect(controlDb.subscription.update).not.toHaveBeenCalled();
  });

  it('SMS package credits are applied once per invoice', async () => {
    const a = make(null, { purpose: 'SMS_PACKAGE', items: { credits: 100 } });
    await a.svc.markInvoicePaidByGateway('i1', 1);
    expect(a.controlDb.tenantSmsWallet.upsert).toHaveBeenCalledTimes(1);
    const b = make(null, { purpose: 'SMS_PACKAGE', items: { credits: 100 } });
    b.controlDb.auditLog.findFirst.mockResolvedValue({ id: 'x' });
    await b.svc.markInvoicePaidByGateway('i1', 1);
    expect(b.controlDb.tenantSmsWallet.upsert).not.toHaveBeenCalled();
  });
});
