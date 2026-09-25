import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_KEY_PATTERN, TenantPublicKeyService, publicRef } from './tenant-public-key.js';

function makeService(rows: Array<{ slug: string; publicKey: string }>) {
  const controlDb = {
    tenant: {
      findMany: vi.fn().mockResolvedValue(rows),
      findUnique: vi.fn(async ({ where }: { where: { publicKey: string } }) => rows.find((r) => r.publicKey === where.publicKey) ?? null),
    },
  };
  return new TenantPublicKeyService(controlDb as never);
}

async function run(service: TenantPublicKeyService, url: string) {
  const req = { url } as { url: string };
  await service.middleware(req as never, {} as never, () => undefined);
  return req.url;
}

describe('TenantPublicKeyService', () => {
  const service = makeService([{ slug: 'coaching', publicKey: 't0123456789a' }]);

  it('rewrites a hashed tenant segment back to the real slug before routing', async () => {
    expect(await run(service, '/api/public/booking/t0123456789a/slots?date=2026-09-25')).toBe('/api/public/booking/coaching/slots?date=2026-09-25');
  });

  it('leaves ordinary slugs and unknown keys untouched (legacy links keep working)', async () => {
    expect(await run(service, '/api/public/booking/coaching')).toBe('/api/public/booking/coaching');
    expect(await run(service, '/api/public/booking/tffffffffffff')).toBe('/api/public/booking/tffffffffffff');
  });

  it('builds links with the hash once the tenant is cached, and falls back to the slug otherwise', async () => {
    await service.refresh();
    expect(publicRef('coaching')).toBe('t0123456789a');
    expect(publicRef('unknown-tenant')).toBe('unknown-tenant');
    expect(PUBLIC_KEY_PATTERN.test('t0123456789a')).toBe(true);
    expect(PUBLIC_KEY_PATTERN.test('coaching')).toBe(false);
  });
});
