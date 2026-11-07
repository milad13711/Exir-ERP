import { describe, expect, it, vi } from 'vitest';
import { PaymentGatewayService } from './payment-gateway.service.js';
import type { PaymentGatewaySettingsService, PaymentGatewaySettings } from './payment-gateway-settings.service.js';
import type { ZarinpalGatewayProvider } from './providers/zarinpal.provider.js';
import type { BitpayGatewayProvider } from './providers/bitpay.provider.js';

const ctx = { tenantId: 't1' } as never;

function makeSettings(overrides: Partial<PaymentGatewaySettings>): PaymentGatewaySettingsService {
  const settings: PaymentGatewaySettings = {
    activeProvider: null,
    zarinpal: { merchantId: '', sandbox: true },
    bitpay: { apiKey: '', testMode: true },
    ...overrides,
  };
  return { get: vi.fn().mockResolvedValue(settings) } as unknown as PaymentGatewaySettingsService;
}

describe('PaymentGatewayService dispatch', () => {
  it('createPayment() returns null when no provider is active — never touches either gateway', async () => {
    const zarinpal = { create: vi.fn(), verify: vi.fn() } as unknown as ZarinpalGatewayProvider;
    const bitpay = { create: vi.fn(), verify: vi.fn() } as unknown as BitpayGatewayProvider;
    const svc = new PaymentGatewayService(makeSettings({ activeProvider: null }), zarinpal, bitpay);

    const result = await svc.createPayment({ ctx, amount: 1000, description: 'd', callbackUrl: 'https://cb' });

    expect(result).toBeNull();
    expect(zarinpal.create).not.toHaveBeenCalled();
    expect(bitpay.create).not.toHaveBeenCalled();
  });

  it('createPayment() dispatches to Zarinpal when it is the active provider, and tags the result', async () => {
    const zarinpal = {
      create: vi.fn().mockResolvedValue({ authority: 'AUTH', redirectUrl: 'https://zarinpal/pay/AUTH' }),
      verify: vi.fn(),
    } as unknown as ZarinpalGatewayProvider;
    const bitpay = { create: vi.fn(), verify: vi.fn() } as unknown as BitpayGatewayProvider;
    const settings = makeSettings({ activeProvider: 'ZARINPAL', zarinpal: { merchantId: 'm-1', sandbox: true } });
    const svc = new PaymentGatewayService(settings, zarinpal, bitpay);

    const result = await svc.createPayment({ ctx, amount: 1000, description: 'd', callbackUrl: 'https://cb' });

    expect(result).toEqual({ authority: 'AUTH', redirectUrl: 'https://zarinpal/pay/AUTH', provider: 'ZARINPAL' });
    expect(zarinpal.create).toHaveBeenCalledWith(expect.objectContaining({ merchantId: 'm-1', sandbox: true, amountToman: 1000 }));
    expect(bitpay.create).not.toHaveBeenCalled();
  });

  it('createPayment() dispatches to Bitpay when it is the active provider, and tags the result', async () => {
    const zarinpal = { create: vi.fn(), verify: vi.fn() } as unknown as ZarinpalGatewayProvider;
    const bitpay = {
      create: vi.fn().mockResolvedValue({ authority: 'ID123', redirectUrl: 'https://bitpay.ir/payment/gateway-ID123' }),
      verify: vi.fn(),
    } as unknown as BitpayGatewayProvider;
    const settings = makeSettings({ activeProvider: 'BITPAY', bitpay: { apiKey: 'k-1', testMode: true } });
    const svc = new PaymentGatewayService(settings, zarinpal, bitpay);

    const result = await svc.createPayment({ ctx, amount: 2000, description: 'd', callbackUrl: 'https://cb' });

    expect(result).toEqual({ authority: 'ID123', redirectUrl: 'https://bitpay.ir/payment/gateway-ID123', provider: 'BITPAY' });
    expect(bitpay.create).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'k-1', amountToman: 2000 }));
    expect(zarinpal.create).not.toHaveBeenCalled();
  });

  it('createPayment() returns null when the dispatched provider itself fails to create', async () => {
    const zarinpal = { create: vi.fn().mockResolvedValue(null), verify: vi.fn() } as unknown as ZarinpalGatewayProvider;
    const bitpay = { create: vi.fn(), verify: vi.fn() } as unknown as BitpayGatewayProvider;
    const settings = makeSettings({ activeProvider: 'ZARINPAL', zarinpal: { merchantId: 'm-1', sandbox: true } });
    const svc = new PaymentGatewayService(settings, zarinpal, bitpay);

    const result = await svc.createPayment({ ctx, amount: 1000, description: 'd', callbackUrl: 'https://cb' });
    expect(result).toBeNull();
  });

  it('verifyPayment() dispatches to the active provider and tags the result', async () => {
    const zarinpal = { create: vi.fn(), verify: vi.fn().mockResolvedValue({ success: true, refId: '999' }) } as unknown as ZarinpalGatewayProvider;
    const bitpay = { create: vi.fn(), verify: vi.fn() } as unknown as BitpayGatewayProvider;
    const settings = makeSettings({ activeProvider: 'ZARINPAL', zarinpal: { merchantId: 'm-1', sandbox: true } });
    const svc = new PaymentGatewayService(settings, zarinpal, bitpay);

    const result = await svc.verifyPayment({ ctx, authority: 'AUTH', amount: 1000 });
    expect(result).toEqual({ success: true, refId: '999', provider: 'ZARINPAL' });
  });

  it('verifyPayment() returns null when no provider is active', async () => {
    const zarinpal = { create: vi.fn(), verify: vi.fn() } as unknown as ZarinpalGatewayProvider;
    const bitpay = { create: vi.fn(), verify: vi.fn() } as unknown as BitpayGatewayProvider;
    const svc = new PaymentGatewayService(makeSettings({ activeProvider: null }), zarinpal, bitpay);

    const result = await svc.verifyPayment({ ctx, authority: 'AUTH', amount: 1000 });
    expect(result).toBeNull();
    expect(zarinpal.verify).not.toHaveBeenCalled();
    expect(bitpay.verify).not.toHaveBeenCalled();
  });
});

describe('PaymentGatewayService — ارز پایه ریال', () => {
  const rialCtx = {
    tenantId: 't-rial',
    tenantDb: { moduleSetting: { findUnique: vi.fn().mockResolvedValue({ value: { code: 'IRR', label: 'ریال', tomanPerUnitNum: '1', tomanPerUnitDen: '10' } }) } },
  } as never;

  it('مبلغ ریالی قبل از درگاه ÷۱۰ می‌شود (درگاه تومان می‌گیرد)، برای create و verify', async () => {
    const zarinpal = {
      create: vi.fn().mockResolvedValue({ authority: 'A', redirectUrl: 'u' }),
      verify: vi.fn().mockResolvedValue({ success: true, refId: '1' }),
    } as unknown as ZarinpalGatewayProvider;
    const bitpay = { create: vi.fn(), verify: vi.fn() } as unknown as BitpayGatewayProvider;
    const svc = new PaymentGatewayService(makeSettings({ activeProvider: 'ZARINPAL', zarinpal: { merchantId: 'm', sandbox: true } }), zarinpal, bitpay);
    await svc.createPayment({ ctx: rialCtx, amount: 1_500_000, description: 'd', callbackUrl: 'https://cb' });
    await svc.verifyPayment({ ctx: rialCtx, authority: 'A', amount: 1_500_000 });
    expect((zarinpal.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].amountToman).toBe(150_000);
    expect((zarinpal.verify as ReturnType<typeof vi.fn>).mock.calls[0]![0].amountToman).toBe(150_000);
  });

  it('مبلغ ریالیِ نامضرب ۱۰ رد می‌شود و به درگاه نمی‌رسد', async () => {
    const zarinpal = { create: vi.fn(), verify: vi.fn() } as unknown as ZarinpalGatewayProvider;
    const svc = new PaymentGatewayService(makeSettings({ activeProvider: 'ZARINPAL', zarinpal: { merchantId: 'm', sandbox: true } }), zarinpal, { create: vi.fn(), verify: vi.fn() } as never);
    await expect(svc.createPayment({ ctx: rialCtx, amount: 1_500_005, description: 'd', callbackUrl: 'https://cb' })).rejects.toThrow();
    expect(zarinpal.create).not.toHaveBeenCalled();
  });

  it('وسط تبدیل ارز پایه، ساخت و تأیید پرداخت با ۴۲۳ رد می‌شود و به درگاه نمی‌رسد', async () => {
    const zarinpal = { create: vi.fn(), verify: vi.fn() } as unknown as ZarinpalGatewayProvider;
    const svc = new PaymentGatewayService(makeSettings({ activeProvider: 'ZARINPAL', zarinpal: { merchantId: 'm', sandbox: true } }), zarinpal, { create: vi.fn(), verify: vi.fn() } as never);
    const busy = { tenantId: 't-busy', tenantDb: { baseCurrencyConversion: { count: vi.fn().mockResolvedValue(1) }, moduleSetting: { findUnique: vi.fn().mockResolvedValue(null) } } } as never;
    await expect(svc.createPayment({ ctx: busy, amount: 1000, description: 'd', callbackUrl: 'https://cb' })).rejects.toMatchObject({ status: 423 });
    await expect(svc.verifyPayment({ ctx: busy, authority: 'A', amount: 1000 })).rejects.toMatchObject({ status: 423 });
    expect(zarinpal.create).not.toHaveBeenCalled();
    expect(zarinpal.verify).not.toHaveBeenCalled();
  });
});
