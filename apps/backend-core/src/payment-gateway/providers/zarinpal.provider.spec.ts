import { describe, expect, it, vi } from 'vitest';
import { ZarinpalGatewayProvider } from './zarinpal.provider.js';

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('ZarinpalGatewayProvider', () => {
  const provider = new ZarinpalGatewayProvider();

  it('create() returns null when merchantId is empty (no HTTP call made)', async () => {
    const fetchImpl = vi.fn();
    const result = await provider.create(
      { merchantId: '', sandbox: true, amountToman: 1000, description: 'x', callbackUrl: 'https://x' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('create() converts Toman to Rial (×10) and builds the sandbox StartPay URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { code: 100, authority: 'AUTH123' } }));
    const result = await provider.create(
      { merchantId: 'm-1', sandbox: true, amountToman: 5000, description: 'desc', callbackUrl: 'https://cb' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ authority: 'AUTH123', redirectUrl: 'https://sandbox.zarinpal.com/pg/StartPay/AUTH123' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sandbox.zarinpal.com/pg/v4/payment/request.json');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.amount).toBe(50000); // 5000 Toman -> 50000 Rial
    expect(body.merchant_id).toBe('m-1');
  });

  it('create() uses the live base URL when sandbox=false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { code: 100, authority: 'A' } }));
    await provider.create(
      { merchantId: 'm-1', sandbox: false, amountToman: 100, description: 'd', callbackUrl: 'https://cb' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.zarinpal.com/pg/v4/payment/request.json');
  });

  it('create() returns null when the gateway responds with a non-100 code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { code: 102 } }));
    const result = await provider.create(
      { merchantId: 'm-1', sandbox: true, amountToman: 100, description: 'd', callbackUrl: 'https://cb' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toBeNull();
  });

  it('create() returns null when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await provider.create(
      { merchantId: 'm-1', sandbox: true, amountToman: 100, description: 'd', callbackUrl: 'https://cb' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toBeNull();
  });

  it('verify() treats both code 100 (fresh) and 101 (already verified) as success', async () => {
    const fetchImpl100 = vi.fn().mockResolvedValue(jsonResponse({ data: { code: 100, ref_id: 999 } }));
    const r1 = await provider.verify({ merchantId: 'm', sandbox: true, amountToman: 100, authority: 'A' }, fetchImpl100 as unknown as typeof fetch);
    expect(r1).toEqual({ success: true, refId: '999' });

    const fetchImpl101 = vi.fn().mockResolvedValue(jsonResponse({ data: { code: 101, ref_id: 888 } }));
    const r2 = await provider.verify({ merchantId: 'm', sandbox: true, amountToman: 100, authority: 'A' }, fetchImpl101 as unknown as typeof fetch);
    expect(r2).toEqual({ success: true, refId: '888' });
  });

  it('verify() fails for any other code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { code: 102 } }));
    const r = await provider.verify({ merchantId: 'm', sandbox: true, amountToman: 100, authority: 'A' }, fetchImpl as unknown as typeof fetch);
    expect(r).toEqual({ success: false });
  });

  it('verify() returns failure without an HTTP call when merchantId is missing', async () => {
    const fetchImpl = vi.fn();
    const r = await provider.verify({ merchantId: '', sandbox: true, amountToman: 100, authority: 'A' }, fetchImpl as unknown as typeof fetch);
    expect(r).toEqual({ success: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
