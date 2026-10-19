import { describe, expect, it } from 'vitest';
import { generateKeypair, loadSigningKey, parsePublicKeyring, verifyActivationToken } from './license-crypto.js';
import { OfflineTokenError, issueOfflineTokenCore } from './license-offline.js';

const kp = generateKeypair();
const key = loadSigningKey(kp.privateKeyPem);

function fake(over: Record<string, unknown> = {}) {
  const lic: any = { id: 'l1', licenseKey: 'LIC-AAAAA-BBBBB-CCCCC-DDDDD', orgName: 'O', productName: 'exir-erp', edition: null, allowedModules: ['crm'], seats: 3, status: 'ACTIVE', expiresAt: null, updatesUntil: null, graceDays: 7, integrityPolicy: 'WARN', maxActivations: 1, deletedAt: null, ...over };
  const acts: any[] = [];
  const tx: any = {
    license: { findFirst: async () => lic },
    $queryRaw: async () => [],
    licenseActivation: {
      findFirst: async ({ where }: any) => acts.find((a) => a.identifier === where.identifier && !a.deletedAt) ?? null,
      count: async () => acts.filter((a) => !a.deletedAt).length,
      create: async ({ data }: any) => { acts.push(data); },
    },
  };
  return { db: { $transaction: async (cb: any) => cb(tx), license: tx.license } as any, acts };
}

describe('issueOfflineTokenCore (shared by admin service and CLI)', () => {
  it('issues a signed installation-bound token and consumes one slot', async () => {
    const f = fake();
    const r = await issueOfflineTokenCore(f.db, key, { licenseKey: 'LIC-AAAAA-BBBBB-CCCCC-DDDDD', installationId: 'I-ABCDEF123', validityDays: 365, crlVersion: 1 });
    expect(verifyActivationToken(r.token, parsePublicKeyring(kp.publicKeyPem)).installationId).toBe('i-abcdef123');
    expect(f.acts).toHaveLength(1);
    await issueOfflineTokenCore(f.db, key, { licenseKey: 'x', installationId: 'I-ABCDEF123', validityDays: 30, crlVersion: 1 }); // idempotent
    expect(f.acts).toHaveLength(1);
  });
  it('validates installation id, day cap, status and capacity', async () => {
    const base = { licenseKey: 'x', crlVersion: 1 };
    await expect(issueOfflineTokenCore(fake().db, key, { ...base, installationId: 'bad id!', validityDays: 10 })).rejects.toThrow(OfflineTokenError);
    await expect(issueOfflineTokenCore(fake().db, key, { ...base, installationId: 'i-12345678', validityDays: 5000 })).rejects.toThrow(/1100/);
    await expect(issueOfflineTokenCore(fake({ status: 'SUSPENDED' }).db, key, { ...base, installationId: 'i-12345678', validityDays: 10 })).rejects.toThrow(/فعال/);
    const full = fake();
    await issueOfflineTokenCore(full.db, key, { ...base, installationId: 'i-11111111', validityDays: 10 });
    await expect(issueOfflineTokenCore(full.db, key, { ...base, installationId: 'i-22222222', validityDays: 10 })).rejects.toThrow(/سقف/);
  });
});
