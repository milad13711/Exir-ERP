import { describe, expect, it, vi } from 'vitest';
import { ModuleRenewalService } from './module-renewal.service.js';

const future = new Date(Date.now() + 5 * 86_400_000);
const past = new Date(Date.now() - 86_400_000);

function make(initialStatus: 'PENDING' | 'AWAITING_APPROVAL', expiredPendingStatus?: string) {
  const controlDb = {
    tenantModule: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { currentPeriodEnd?: { lt?: Date } } }) =>
        Promise.resolve(
          where.currentPeriodEnd?.lt
            ? [{ id: 'tm2', tenantId: 't1', moduleId: 'm1', pendingRenewalInvoiceId: expiredPendingStatus ? 'inv0' : null, module: { code: 'crm' }, currentPeriodEnd: past }]
            : [{ id: 'tm1', tenantId: 't1', billingMode: 'MONTHLY', currentPeriodEnd: future, module: { code: 'crm', name: 'CRM', priceMonthly: 100, priceYearly: null }, tenant: { name: 'مشتری' } }],
        ),
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    invoice: {
      create: vi.fn().mockResolvedValue({ id: 'inv1' }),
      findUnique: vi.fn().mockResolvedValue({ status: expiredPendingStatus }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    tenantMembership: { findFirst: vi.fn().mockResolvedValue({ globalUser: { phone: '0912' } }) },
  };
  const sms = { isConfigured: () => true, sendSms: vi.fn().mockResolvedValue({ success: true }) };
  const approval = {
    initialState: vi.fn().mockResolvedValue({ status: initialStatus, issueSource: 'AUTO' }),
    submit: vi.fn().mockResolvedValue(true),
    resubmitMissing: vi.fn().mockResolvedValue(0),
  };
  const svc = new ModuleRenewalService(controlDb as never, sms as never, approval as never);
  return { svc, controlDb, sms, approval };
}

describe('ModuleRenewalService with manager approval', () => {
  it('auto renewal invoice is created AWAITING_APPROVAL, submitted to the inbox, and the owner is NOT texted yet', async () => {
    const { svc, controlDb, sms, approval } = make('AWAITING_APPROVAL');
    await svc.run();
    expect(controlDb.invoice.create.mock.calls[0][0].data).toMatchObject({ status: 'AWAITING_APPROVAL', issueSource: 'AUTO', purpose: 'MODULE_RENEWAL' });
    expect(approval.submit).toHaveBeenCalledWith('inv1');
    expect(sms.sendSms).not.toHaveBeenCalled();
    // قفل تمدید روی همین فاکتور ثبت می‌شود تا cron دوباره نسازد
    expect(controlDb.tenantModule.update).toHaveBeenCalledWith({ where: { id: 'tm1' }, data: { pendingRenewalInvoiceId: 'inv1' } });
  });

  it('with the setting off, behaves as before: PENDING invoice + immediate owner SMS', async () => {
    const { svc, sms, approval, controlDb } = make('PENDING');
    await svc.run();
    expect(controlDb.invoice.create.mock.calls[0][0].data.status).toBe('PENDING');
    expect(approval.submit).not.toHaveBeenCalled();
    expect(sms.sendSms).toHaveBeenCalledTimes(1);
  });

  it('does not disable an expired module while its renewal invoice awaits manager approval', async () => {
    const { svc, controlDb } = make('PENDING', 'AWAITING_APPROVAL');
    await svc.run();
    expect(controlDb.tenantModule.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'DISABLED' } }));
  });

  it('still disables an expired module whose renewal invoice is a real unpaid PENDING one', async () => {
    const { svc, controlDb } = make('PENDING', 'PENDING');
    await svc.run();
    expect(controlDb.tenantModule.update).toHaveBeenCalledWith({ where: { id: 'tm2' }, data: { status: 'DISABLED' } });
  });
});
