import 'reflect-metadata';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BaseCurrencyService } from './base-currency.service.js';
import { writeLock } from './write-lock.js';

vi.mock('./conversion-engine.js', async (orig) => ({
  ...(await orig<typeof import('./conversion-engine.js')>()),
  buildPreview: vi.fn().mockResolvedValue({ blocking: [] }),
}));

describe('start(): failure after code consumption releases lock and marks FAILED', () => {
  beforeEach(() => writeLock._reset());
  afterEach(() => vi.restoreAllMocks());

  it('backupFile update throwing -> FAILED, lock released, not left active', async () => {
    const update = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if ('backupFile' in data) throw new Error('db down');
      return {};
    });
    const db = {
      baseCurrencyConversion: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 'c1' }), update, findUnique: vi.fn() },
    };
    const svc = new BaseCurrencyService({} as never, undefined, { isConfigured: () => false } as never);
    const s = svc as unknown as Record<string, unknown>;
    s.checkConfirmation = vi.fn().mockResolvedValue('conf1');
    s.currentUser = vi.fn().mockResolvedValue({ id: 'u1', name: 'x' });
    s.takeBackup = vi.fn().mockResolvedValue({ file: 'f', size: '1', sha256: 'h' });
    s.consumeConfirmation = vi.fn().mockResolvedValue(undefined);
    const runSpy = vi.fn();
    s.run = runSpy;
    const ctx = { tenantId: 't1', tenantSlug: 't1', auth: { sub: 'g', role: 'OWNER', type: 'user' }, tenantDb: db } as never;
    const plan = { rate: { num: 10n, den: 1n }, mode: 'STRICT', phrase: 'ok', from: { code: 'IRT', label: 'a' }, toCode: 'IRR', toLabel: 'b' };

    await expect((s.start as (c: unknown, a: unknown) => Promise<unknown>).call(svc, ctx, { kind: 'CONVERT', plan, idempotencyKey: 'k', confirmPhrase: 'ok', otp: '1' })).rejects.toThrow('db down');
    expect(runSpy).not.toHaveBeenCalled();
    expect(writeLock.isLocked('t1')).toBe(false);
    expect((s.active as Set<string>).has('c1')).toBe(false);
    expect(update.mock.calls.some(([a]) => a.data.status === 'FAILED')).toBe(true);
  });
});
