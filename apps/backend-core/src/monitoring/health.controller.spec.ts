import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('returns {ok:true} when DB answers and caches briefly', async () => {
    let n = 0;
    const c = new HealthController({ $queryRawUnsafe: async () => (n++, 1) } as any);
    await expect(c.health()).resolves.toEqual({ ok: true });
    await c.health();
    expect(n).toBe(1);
  });
  it('503 when DB is down, without leaking details', async () => {
    const c = new HealthController({ $queryRawUnsafe: async () => { throw new Error('secret conn string'); } } as any);
    const err = await c.health().catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(503);
    expect(JSON.stringify(err.getResponse())).not.toContain('secret');
  });
});
