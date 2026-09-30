import { describe, expect, it, vi } from 'vitest';
import { BitpayGatewayProvider } from './bitpay.provider.js';

function textResponse(text: string) {
  return { text: async () => text } as Response;
}

describe('BitpayGatewayProvider', () => {
  const provider = new BitpayGatewayProvider();

  it('create() returns null when apiKey is empty (no HTTP call made)', async () => {
    const fetchImpl = vi.fn();
    const result = await provider.create(
      { apiKey: '', amountToman: 1000, description: 'x', callbackUrl: 'https://x' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('create() parses "1,{id_get}" as success, converts Toman to Rial, and builds the redirect URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('1,168874073'));
    const result = await provider.create(
      { apiKey: 'key-1', amountToman: 5000, description: 'desc', callbackUrl: 'https://cb' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ authority: '168874073', redirectUrl: 'https://bitpay.ir/payment/gateway-168874073' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://bitpay.ir/payment/gateway-send');
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get('amount')).toBe('50000'); // 5000 Toman -> 50000 Rial
    expect(body.get('api')).toBe('key-1');
  });

  it('create() returns null on an error response (status != 1)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('-1'));
    const result = await provider.create(
      { apiKey: 'key-1', amountToman: 100, description: 'd', callbackUrl: 'https://cb' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toBeNull();
  });

  it('create() returns null when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await provider.create(
      { apiKey: 'key-1', amountToman: 100, description: 'd', callbackUrl: 'https://cb' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toBeNull();
  });

  it('verify() succeeds on a "1,..." response and carries extra fields into refId', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('1,50000,6104xxxxxxxxxxxx'));
    const r = await provider.verify({ apiKey: 'key-1', authority: '168874073' }, fetchImpl as unknown as typeof fetch);
    expect(r.success).toBe(true);
    expect(r.refId).toBe('168874073:50000,6104xxxxxxxxxxxx');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://bitpay.ir/payment/gateway-result-second');
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get('id_get')).toBe('168874073');
    // transId not supplied -> falls back to authority
    expect(body.get('trans_id')).toBe('168874073');
  });

  it('verify() uses an explicit transId when given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('1,50000'));
    await provider.verify({ apiKey: 'key-1', authority: '168874073', transId: 'CB-99' }, fetchImpl as unknown as typeof fetch);
    const body = new URLSearchParams((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.get('trans_id')).toBe('CB-99');
  });

  it('verify() fails on a non-1 status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('-4'));
    const r = await provider.verify({ apiKey: 'key-1', authority: 'A' }, fetchImpl as unknown as typeof fetch);
    expect(r).toEqual({ success: false });
  });

  it('verify() returns failure without an HTTP call when apiKey or authority is missing', async () => {
    const fetchImpl = vi.fn();
    expect(await provider.verify({ apiKey: '', authority: 'A' }, fetchImpl as unknown as typeof fetch)).toEqual({ success: false });
    expect(await provider.verify({ apiKey: 'k', authority: '' }, fetchImpl as unknown as typeof fetch)).toEqual({ success: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
