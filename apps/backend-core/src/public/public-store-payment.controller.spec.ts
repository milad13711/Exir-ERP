import { describe, expect, it, vi } from 'vitest';
import { PublicStorePaymentController } from './public-store-payment.controller.js';

function build(gateway: Record<string, unknown>) {
  const order = { id: 'o1', orderNo: 7, subtotal: 250_000, customerPhone: '09121234567', paidAt: null, zarinpalAuthority: null };
  const tenantDb = { storeOrder: { findUnique: vi.fn().mockResolvedValue(order), update: vi.fn() } };
  const controlDb = { tenant: { findUnique: vi.fn().mockResolvedValue({ id: 't', slug: 'acme', status: 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'd' }) } };
  const tenantPrisma = { forTenant: vi.fn().mockReturnValue(tenantDb) };
  const jwt = { verifyAsync: vi.fn().mockResolvedValue({ type: 'store_order_ticket', tenantSlug: 'acme', phone: '09121234567' }) };
  const storeOrders = { finalizeOnlinePayment: vi.fn() };
  const controller = new PublicStorePaymentController(controlDb as never, tenantPrisma as never, gateway as never, storeOrders as never, jwt as never);
  return { controller, tenantDb, storeOrders };
}

describe('PublicStorePaymentController.pay — tenant gateway', () => {
  it('returns a clear Persian error and never creates a payment when no gateway is configured', async () => {
    const gateway = { isConfigured: vi.fn().mockResolvedValue(false), createPayment: vi.fn() };
    const { controller, tenantDb } = build(gateway);
    const res = await controller.pay('acme', 'o1', { orderToken: 'tok' } as never);
    expect(res).toEqual({ error: 'درگاه پرداخت این کسب‌وکار هنوز تنظیم نشده است' });
    expect(gateway.createPayment).not.toHaveBeenCalled();
    expect(tenantDb.storeOrder.update).not.toHaveBeenCalled();
  });

  it('starts payment via the tenant gateway when configured', async () => {
    const gateway = { isConfigured: vi.fn().mockResolvedValue(true), createPayment: vi.fn().mockResolvedValue({ redirectUrl: 'https://pay/z', authority: 'A1', provider: 'ZARINPAL' }) };
    const { controller, tenantDb } = build(gateway);
    const res = await controller.pay('acme', 'o1', { orderToken: 'tok' } as never);
    expect(res).toEqual({ paymentUrl: 'https://pay/z' });
    expect(gateway.createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 250_000 }));
    expect(tenantDb.storeOrder.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { zarinpalAuthority: 'A1' } });
  });
});
