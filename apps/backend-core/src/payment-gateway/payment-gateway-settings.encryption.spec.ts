import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentGatewaySettingsService } from './payment-gateway-settings.service.js';
import { isSealed } from '../security/app-secrets.js';

function makeCtx(initial?: unknown) {
  let stored: { value: unknown } | null = initial === undefined ? null : { value: initial };
  const moduleSetting = {
    findUnique: vi.fn().mockImplementation(async () => stored),
    upsert: vi.fn().mockImplementation(async ({ create, update }: { create: { value: unknown }; update: { value: unknown } }) => {
      stored = { value: stored ? update.value : create.value };
      return stored;
    }),
  };
  return { ctx: { tenantId: 'tenant-1', auth: { role: 'OWNER' }, tenantDb: { moduleSetting } } as never, moduleSetting, read: () => stored?.value as Record<string, any> };
}

describe('PaymentGatewaySettingsService — secrets encrypted at rest', () => {
  const saved = process.env.APP_SECRETS_KEY;
  beforeEach(() => { process.env.APP_SECRETS_KEY = randomBytes(32).toString('hex'); });
  afterEach(() => { if (saved === undefined) delete process.env.APP_SECRETS_KEY; else process.env.APP_SECRETS_KEY = saved; });
  const svc = new PaymentGatewaySettingsService();

  it('update() stores ciphertext only, get() returns plaintext for internal use, getView() masks', async () => {
    const { ctx, read } = makeCtx();
    await svc.update(ctx, { activeProvider: 'ZARINPAL', zarinpalMerchantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', bitpayApiKey: 'BITPAY-API-KEY-12345' });
    expect(isSealed(read().zarinpal.merchantId)).toBe(true);
    expect(isSealed(read().bitpay.apiKey)).toBe(true);
    expect(JSON.stringify(read())).not.toContain('aaaaaaaa-bbbb');
    expect(JSON.stringify(read())).not.toContain('BITPAY-API-KEY');
    const plain = await svc.get(ctx);
    expect(plain.zarinpal.merchantId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    const view = await svc.getView(ctx);
    expect(view.zarinpal.merchantId).toMatch(/^•+eeee$/);
    expect(JSON.stringify(view)).not.toContain('aaaaaaaa-bbbb');
  });

  it('lazily migrates a legacy plaintext row on first read', async () => {
    const { ctx, read, moduleSetting } = makeCtx({ activeProvider: 'ZARINPAL', zarinpal: { merchantId: 'LEGACY-PLAIN-MERCHANT', sandbox: false }, bitpay: { apiKey: '', testMode: true } });
    const s = await svc.get(ctx);
    expect(s.zarinpal.merchantId).toBe('LEGACY-PLAIN-MERCHANT');
    expect(moduleSetting.upsert).toHaveBeenCalled();
    expect(isSealed(read().zarinpal.merchantId)).toBe(true);
    expect(JSON.stringify(read())).not.toContain('LEGACY-PLAIN-MERCHANT');
    expect((await svc.get(ctx)).zarinpal.merchantId).toBe('LEGACY-PLAIN-MERCHANT'); // still readable after migration
  });

  it('without APP_SECRETS_KEY: legacy rows stay readable (no outage) but saving a secret fails closed and writes nothing', async () => {
    delete process.env.APP_SECRETS_KEY;
    const legacy = makeCtx({ activeProvider: 'ZARINPAL', zarinpal: { merchantId: 'LEGACY', sandbox: true }, bitpay: { apiKey: '', testMode: true } });
    expect((await svc.get(legacy.ctx)).zarinpal.merchantId).toBe('LEGACY');
    expect(legacy.moduleSetting.upsert).not.toHaveBeenCalled();
    const fresh = makeCtx();
    await expect(svc.update(fresh.ctx, { zarinpalMerchantId: 'new-merchant', activeProvider: 'ZARINPAL' })).rejects.toMatchObject({ status: 503 });
    expect(fresh.moduleSetting.upsert).not.toHaveBeenCalled();
  });

  it('a sealed blob from one tenant does not decrypt under another tenant', async () => {
    const a = makeCtx();
    await svc.update(a.ctx, { activeProvider: 'ZARINPAL', zarinpalMerchantId: 'tenant-a-merchant' });
    const b = makeCtx(a.read());
    (b.ctx as { tenantId: string }).tenantId = 'tenant-2';
    await expect(svc.get(b.ctx)).rejects.toThrow();
  });
});
