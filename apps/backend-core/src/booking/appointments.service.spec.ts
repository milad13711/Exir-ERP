import { describe, expect, it, vi } from 'vitest';
import { AppointmentsService } from './appointments.service.js';

function setup(existingContact: { id: string } | null, serviceOverrides: Record<string, unknown> = {}) {
  const serviceType = {
    id: 'svc-1', name: 'مشاوره', durationMinutes: 60, price: 500_000, isActive: true,
    requiresCoordination: false, requiresDeposit: false, depositAmount: null, requiresFullPayment: false,
    description: null, location: null, linkToMentoring: false, ...serviceOverrides,
  };
  const created = { id: 'ap-1', serviceType, startAt: new Date('2026-09-25T08:30:00Z'), endAt: new Date('2026-09-25T09:30:00Z'), publicToken: 'tok-1', location: null, contactId: 'c-1', providerUserId: null, customerName: 'علی', customerPhone: '09121234567', paymentStatus: 'NONE', depositAmount: null, isFullPayment: false, status: 'SCHEDULED' };
  const tenantDb = {
    serviceType: { findUnique: vi.fn().mockResolvedValue(serviceType) },
    appointment: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...created, paymentStatus: data.paymentStatus, depositAmount: data.depositAmount, isFullPayment: data.isFullPayment })) },
    crmContact: { findFirst: vi.fn().mockResolvedValue(existingContact), create: vi.fn().mockResolvedValue({ id: 'c-new' }) },
    crmActivity: { create: vi.fn().mockResolvedValue({}) },
    moduleSetting: { findUnique: vi.fn().mockResolvedValue({ value: 'تهران، خیابان آزادی' }) },
    mentoringSession: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
  };
  const sms = { sendSms: vi.fn().mockResolvedValue({ success: true }) };
  const service = new AppointmentsService({ emit: vi.fn() } as never, sms as never, { isConfigured: vi.fn().mockResolvedValue(true) } as never, {} as never, { findSlot: vi.fn().mockResolvedValue({ startAt: '2026-09-25T08:30:00Z', time: '12:00', providerIds: [] }) } as never, {} as never);
  const ctx = { tenantId: 't', tenantSlug: 'acme', tenantDb, auth: { role: 'OWNER', sub: 'g' } } as never;
  return { service, ctx, tenantDb, sms };
}

describe('AppointmentsService.createPublic — CRM link + confirmation message', () => {
  it('links to an existing CRM contact by normalized phone and logs history instead of creating a contact', async () => {
    const { service, ctx, tenantDb } = setup({ id: 'c-existing' });
    await service.createPublic(ctx, { serviceTypeId: 'svc-1', customerName: 'علی', customerPhone: '+989121234567', startAt: '2026-09-25T08:30:00Z' } as never);
    expect(tenantDb.crmContact.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { phone: { contains: '9121234567' } } }));
    expect(tenantDb.crmContact.create).not.toHaveBeenCalled();
    expect(tenantDb.crmActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ contactId: 'c-existing', type: 'MEETING' }) });
  });

  it('creates a new contact when the phone is unknown', async () => {
    const { service, ctx, tenantDb } = setup(null);
    await service.createPublic(ctx, { serviceTypeId: 'svc-1', customerName: 'علی', customerPhone: '09121234567', startAt: '2026-09-25T08:30:00Z' } as never);
    expect(tenantDb.crmContact.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ phone: '09121234567', source: 'رزرو نوبت' }) }));
  });

  it('SMS carries Tehran-time date/time, the office address and the public details link', async () => {
    const { service, ctx, sms } = setup(null);
    await service.createPublic(ctx, { serviceTypeId: 'svc-1', customerName: 'علی', customerPhone: '09121234567', startAt: '2026-09-25T08:30:00Z' } as never);
    const message = sms.sendSms.mock.calls[0][2] as string;
    expect(message).toContain('۱۲:۰۰');
    expect(message).toContain('تهران، خیابان آزادی');
    expect(message).toContain('/book/acme/a/tok-1');
  });

  it('a full-payment service creates the appointment as pending payment of the whole price', async () => {
    const { service, ctx, tenantDb, sms } = setup(null, { requiresFullPayment: true });
    await service.createPublic(ctx, { serviceTypeId: 'svc-1', customerName: 'علی', customerPhone: '09121234567', startAt: '2026-09-25T08:30:00Z' } as never);
    expect(tenantDb.appointment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paymentStatus: 'PENDING', depositAmount: 500_000, isFullPayment: true }) }));
    expect(sms.sendSms.mock.calls[0][2]).toContain('مبلغ قابل پرداخت');
  });
});

describe('AppointmentsService deposit payment — tenant gateway', () => {
  function build(gateway: Record<string, unknown>) {
    const appt = { id: 'ap-1', paymentStatus: 'PENDING', depositAmount: 100_000, isFullPayment: false, customerName: 'علی', customerPhone: '09121234567', zarinpalAuthority: 'AUTH1', serviceType: { name: 'مشاوره' } };
    const tenantDb = { appointment: { findUnique: vi.fn().mockResolvedValue(appt), update: vi.fn().mockResolvedValue({}) } };
    const service = new AppointmentsService({ emit: vi.fn() } as never, {} as never, gateway as never, {} as never, {} as never, {} as never);
    return { service, ctx: { tenantId: 't', tenantDb } as never, tenantDb };
  }

  it('refuses to start payment (never falls back to the platform merchant) when the tenant has no gateway', async () => {
    const gateway = { isConfigured: vi.fn().mockResolvedValue(false), createPayment: vi.fn() };
    const { service, ctx, tenantDb } = build(gateway);
    const result = await service.initiateDepositPayment(ctx, 'ap-1', 'http://cb');
    expect(result).toEqual({ error: 'درگاه پرداخت این کسب‌وکار هنوز تنظیم نشده است' });
    expect(gateway.createPayment).not.toHaveBeenCalled();
    expect(tenantDb.appointment.update).not.toHaveBeenCalled();
  });

  it('creates through the tenant gateway and stores the authority when configured', async () => {
    const gateway = { isConfigured: vi.fn().mockResolvedValue(true), createPayment: vi.fn().mockResolvedValue({ redirectUrl: 'https://pay/x', authority: 'AUTH1', provider: 'BITPAY' }) };
    const { service, ctx, tenantDb } = build(gateway);
    const result = await service.initiateDepositPayment(ctx, 'ap-1', 'http://cb');
    expect(result).toEqual({ paymentUrl: 'https://pay/x' });
    expect(gateway.createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 100_000, callbackUrl: 'http://cb' }));
    expect(tenantDb.appointment.update).toHaveBeenCalledWith({ where: { id: 'ap-1' }, data: { zarinpalAuthority: 'AUTH1' } });
  });

  it('verify fails closed when the gateway is gone (verifyPayment returns null)', async () => {
    const gateway = { isConfigured: vi.fn(), verifyPayment: vi.fn().mockResolvedValue(null) };
    const { service, ctx } = build(gateway);
    expect(await service.verifyDepositPayment(ctx, 'ap-1', 'AUTH1')).toEqual({ success: false });
  });
});
