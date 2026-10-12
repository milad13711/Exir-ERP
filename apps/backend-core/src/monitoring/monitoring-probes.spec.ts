import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpStatus } from './monitoring-probes.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const ok = (status: number) => ({ status, body: { cancel: async () => undefined } }) as unknown as Response;

describe('httpStatus', () => {
  it('a transient network error is retried once and the site is reported healthy', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(ok(200));
    globalThis.fetch = f as never;
    const r = await httpStatus('https://x.test/', 1000, 0);
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('two network errors in a row are a real failure', async () => {
    const f = vi.fn().mockRejectedValue(new Error('fetch failed'));
    globalThis.fetch = f as never;
    const r = await httpStatus('https://x.test/', 1000, 0);
    expect(r.status).toBeNull();
    expect(r.error).toContain('fetch failed');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('an HTTP error status is real and is NEVER retried', async () => {
    const f = vi.fn().mockResolvedValue(ok(503));
    globalThis.fetch = f as never;
    const r = await httpStatus('https://x.test/', 1000, 0);
    expect(r.status).toBe(503);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
