import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  generateKeypair,
  loadSigningKey,
  responseSigningString,
  sha256Hex,
  signPayload,
  signString,
  type ActivationTokenPayload,
  type SigningKey,
} from './license-crypto.js';
import { licenseKeyHash } from './license-crypto.js';
import { LicenseRuntimeService } from './license-runtime.service.js';

const DAY = 86_400_000;
const LIC_KEY = 'LIC-AAAAA-BBBBB-CCCCC-DDDDD';

const kp = generateKeypair();
const key = loadSigningKey(kp.privateKeyPem);

type Server = { code: string; modules: string[]; maxUsers: number; tokenDays: number; policy: 'WARN' | 'LOCK'; signer: SigningKey; nonceOverride?: string; crl?: string; tamperCrlAfterSigning?: boolean };

function serverFetch(server: Server) {
  return vi.fn(async (_url: string, init: { body: string }) => {
    const req = JSON.parse(init.body) as { license_key: string; identifier: string; nonce: string };
    const ok = ['valid', 'activated', 'already_activated'].includes(server.code);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = server.nonceOverride ?? req.nonce;
    const base = { success: ok, code: server.code, license_key: req.license_key, identifier: req.identifier, timestamp, nonce, kid: server.signer.kid };
    const now = new Date();
    const payload: ActivationTokenPayload = {
      v: 2, kid: server.signer.kid, jti: randomUUID(), licenseId: 'l1', licenseKey: req.license_key, orgName: 'Org', product: 'exir-erp', edition: null,
      installationId: req.identifier, fp: null, modules: server.modules, maxUsers: server.maxUsers, issuedAt: now.toISOString(), notBefore: now.toISOString(),
      expiresAt: null, updatesUntil: null, graceDays: 14, tokenExpiresAt: new Date(now.getTime() + server.tokenDays * DAY).toISOString(),
      nonce: req.nonce, serverTime: now.toISOString(), integrityPolicy: server.policy, crlVersion: 1,
    };
    const extra = { ...(ok ? { token: signPayload(payload, server.signer) } : {}), ...(server.crl ? { crl: server.crl } : {}) };
    const body = { ...base, message: '', data: null, signature: signString(responseSigningString({ ...base, crlHash: server.crl ? sha256Hex(server.crl) : '' }), server.signer), ...extra };
    return { headers: { get: () => null }, text: async () => JSON.stringify(body) } as never;
  });
}

function makeRuntime(integrity = { tampered: false }) {
  const db = {
    tenantMembership: { count: vi.fn(async () => 3) },
    tenant: { findFirst: vi.fn(async () => ({ id: 't1' })), count: vi.fn(async () => 1) },
    moduleDefinition: { findMany: vi.fn(async () => [{ id: 'm1' }]) },
    tenantModule: { createMany: vi.fn(async () => ({ count: 1 })) },
  };
  const integ = {
    getResult: () => ({ status: integrity.tampered ? 'tampered' : 'ok', modified: [], added: [], missing: [], builtAt: null, version: null }),
    isTampered: () => integrity.tampered,
  };
  const jobs = [{ stop: vi.fn(), start: vi.fn() }];
  const sched = { getCronJobs: () => new Map([['a', jobs[0]]]) };
  const rt = new LicenseRuntimeService(db as never, integ as never, sched as never);
  return { rt, db, jobs };
}

let stateDir: string;
const envBackup = { ...process.env };
let server: Server;

beforeEach(() => {
  stateDir = mkdtempSync(path.join(tmpdir(), 'lic-state-'));
  Object.assign(process.env, {
    DEPLOYMENT_MODE: 'ON_PREMISE',
    LICENSE_KEY: LIC_KEY,
    LICENSE_PUBLIC_KEY_PEM: kp.publicKeyPem,
    LICENSE_SERVER_URL: 'https://license.example.test',
    LICENSE_STATE_DIR: stateDir,
  });
  delete process.env.LICENSE_TOKEN;
  server = { code: 'activated', modules: ['crm', 'accounting'], maxUsers: 5, tokenDays: 14, policy: 'WARN', signer: key };
  vi.stubGlobal('fetch', serverFetch(server));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(stateDir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) if (!(k in envBackup)) delete process.env[k];
  Object.assign(process.env, envBackup);
});

async function boot(rt: LicenseRuntimeService) {
  rt.onModuleInit();
  await rt.ready();
  rt.onModuleDestroy();
}

describe('LicenseRuntimeService (on-premise)', () => {
  it('activates online, enforces licensed modules server-side and syncs tenant modules', async () => {
    const { rt, db } = makeRuntime();
    await boot(rt);
    expect(rt.getStatus()).toMatchObject({ mode: 'on_premise', state: 'valid', perpetual: true });
    expect(rt.moduleAllowed('crm')).toBe(true);
    expect(rt.moduleAllowed('hr')).toBe(false);
    expect(db.tenantModule.createMany).toHaveBeenCalled();
    expect(rt.getInstallationId()).toMatch(/^i-/);
  });

  it('persists state: a restart works fully offline with the same installation id', async () => {
    const a = makeRuntime();
    await boot(a.rt);
    const id = a.rt.getInstallationId();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const b = makeRuntime();
    await boot(b.rt);
    expect(b.rt.getInstallationId()).toBe(id);
    expect(b.rt.getStatus()).toMatchObject({ state: 'valid' });
  });

  it('rejects server responses signed by an unknown key (forgery)', async () => {
    server.signer = loadSigningKey(generateKeypair().privateKeyPem);
    const { rt } = makeRuntime();
    await boot(rt);
    expect(rt.isBlocked()).toBe(true);
    expect(rt.getStatus()).toMatchObject({ reasonCode: 'needs_activation' });
  });

  it('rejects replayed responses (nonce mismatch)', async () => {
    server.nonceOverride = 'REPLAYED-nonce-0000';
    const { rt } = makeRuntime();
    await boot(rt);
    expect(rt.isBlocked()).toBe(true);
  });

  it('applies a signed suspension verdict immediately, stops cron jobs, and recovers when resumed', async () => {
    const { rt, jobs } = makeRuntime();
    await boot(rt);
    expect(rt.isBlocked()).toBe(false);
    server.code = 'license_suspended';
    await rt.sync();
    expect(rt.isBlocked()).toBe(true);
    expect(rt.getStatus()).toMatchObject({ reasonCode: 'license_suspended' });
    expect(jobs[0].stop).toHaveBeenCalled();
    server.code = 'valid';
    await rt.sync();
    expect(rt.isBlocked()).toBe(false);
    expect(jobs[0].start).toHaveBeenCalled();
  });

  it('network failure never locks immediately; escalating grace then hard lock when offline too long', async () => {
    const { rt } = makeRuntime();
    await boot(rt);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await rt.sync();
    expect(rt.isBlocked()).toBe(false);
    const t0 = Date.now();
    rt.refresh(new Date(t0 + 12 * DAY));
    expect(rt.getStatus()).toMatchObject({ state: 'valid', warningLevel: 1 });
    rt.refresh(new Date(t0 + 20 * DAY));
    expect(rt.getStatus()).toMatchObject({ state: 'grace', warningLevel: 2, reasonCode: 'offline_grace' });
    rt.refresh(new Date(t0 + 40 * DAY));
    expect(rt.getStatus()).toMatchObject({ state: 'expired', reasonCode: 'offline_expired' });
    expect(rt.isBlocked()).toBe(true);
  });

  it('clock rollback after a persisted future time gives no extra time', async () => {
    const { rt } = makeRuntime();
    await boot(rt);
    const t0 = Date.now();
    rt.refresh(new Date(t0 + 20 * DAY)); // lastSeen persisted in-memory/state
    rt.refresh(new Date(t0)); // user sets the clock back
    expect(rt.getStatus()).toMatchObject({ state: 'invalid', reasonCode: 'clock_rollback' }); // locked: > 7d rollback
  });

  it('a tampered state file is treated as a brand-new installation (cannot keep a stolen token)', async () => {
    const a = makeRuntime();
    await boot(a.rt);
    const id = a.rt.getInstallationId();
    const file = path.join(stateDir, 'license-state.json');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw.lastSeen = '2020-01-01T00:00:00.000Z'; // try to roll back the monotonic timestamp
    writeFileSync(file, JSON.stringify(raw));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const b = makeRuntime();
    await boot(b.rt);
    expect(b.rt.getInstallationId()).not.toBe(id);
    expect(b.rt.isBlocked()).toBe(true);
  });

  it('enforces the licence user limit server-side', async () => {
    const { rt } = makeRuntime();
    await boot(rt);
    expect(() => rt.assertUserCapacity(4)).not.toThrow();
    expect(() => rt.assertUserCapacity(5)).toThrow(/سقف کاربران/);
  });

  it('integrity policy comes from the signed token: WARN keeps running, LOCK blocks on tamper', async () => {
    const warn = makeRuntime({ tampered: true });
    await boot(warn.rt);
    expect(warn.rt.isBlocked()).toBe(false);
    expect(warn.rt.getStatus()).toMatchObject({ integrity: 'tampered' });

    rmSync(stateDir, { recursive: true, force: true });
    server.policy = 'LOCK';
    const lock = makeRuntime({ tampered: true });
    await boot(lock.rt);
    expect(lock.rt.isBlocked()).toBe(true);
    expect(lock.rt.getStatus()).toMatchObject({ reasonCode: 'integrity' });
  });

  it('rejects plain http:// licence server unless LICENSE_ALLOW_INSECURE=true', async () => {
    process.env.LICENSE_SERVER_URL = 'http://license.example.test';
    const a = makeRuntime();
    await boot(a.rt);
    expect(a.rt.isBlocked()).toBe(true);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    process.env.LICENSE_ALLOW_INSECURE = 'true';
    rmSync(stateDir, { recursive: true, force: true });
    const b = makeRuntime();
    await boot(b.rt);
    expect(b.rt.isBlocked()).toBe(false);
  });

  it('accepts a valid newer CRL, rejects older-version / malformed / unsigned CRLs, and a revoked key locks', async () => {
    const mk = (over: object, signer = key) => signPayload({ v: 1, kid: key.kid, version: 5, issuedAt: new Date().toISOString(), revoked: [], revokedKids: [], ...over }, signer);
    server.crl = mk({ version: 5 });
    const { rt } = makeRuntime();
    await boot(rt);
    expect((rt as any).state.crl).toBe(server.crl);
    server.code = 'valid';
    server.crl = mk({ version: 3 }); // rollback
    await rt.sync();
    expect(JSON.parse(Buffer.from((rt as any).state.crl.split('.')[0], 'base64url').toString()).version).toBe(5);
    server.crl = mk({ revoked: 'oops' }); // bad shape
    await rt.sync();
    expect(JSON.parse(Buffer.from((rt as any).state.crl.split('.')[0], 'base64url').toString()).version).toBe(5);
    server.crl = mk({ version: 9 }, loadSigningKey(generateKeypair().privateKeyPem)); // foreign signer
    await rt.sync();
    expect(JSON.parse(Buffer.from((rt as any).state.crl.split('.')[0], 'base64url').toString()).version).toBe(5);
    server.crl = mk({ version: 7, revoked: [licenseKeyHash(LIC_KEY)] });
    await rt.sync();
    expect(rt.isBlocked()).toBe(true);
  });

  it('refresh() never throws (no crash loop) even with a corrupt CRL in state', async () => {
    const { rt } = makeRuntime();
    await boot(rt);
    (rt as any).state.crl = 'garbage';
    expect(() => rt.refresh()).not.toThrow();
  });

  it('legacy v1 tokens can be disabled and are flagged deprecated', async () => {
    delete process.env.LICENSE_SERVER_URL;
    const now = new Date();
    const v1 = signPayload({ licenseId: 'old', orgName: 'Old', modules: ['crm'], seats: 3, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * DAY).toISOString() }, key);
    process.env.LICENSE_KEY = v1;
    const a = makeRuntime();
    await boot(a.rt);
    expect(a.rt.getStatus()).toMatchObject({ state: 'valid', deprecated: 'legacy_v1' });
    process.env.LICENSE_ALLOW_LEGACY_V1 = 'false';
    const b = makeRuntime();
    await boot(b.rt);
    expect(b.rt.isBlocked()).toBe(true);
  });

  it('a token for another product is refused', async () => {
    process.env.LICENSE_PRODUCT = 'other-product';
    const { rt } = makeRuntime();
    await boot(rt);
    expect(rt.isBlocked()).toBe(true);
  });

  it('BUILD_DATE env is ignored for the updatesUntil rule', async () => {
    process.env.BUILD_DATE = '2000-01-01';
    const { rt } = makeRuntime();
    await boot(rt);
    expect(rt.isBlocked()).toBe(false); // token has no updatesUntil; env can neither lock nor unlock
  });

  it('warns loudly (does not crash) when ON_PREMISE but several tenants are active', async () => {
    const { rt, db } = makeRuntime();
    (db as any).tenant.count = vi.fn(async () => 5);
    await boot(rt);
    expect((db as any).tenant.count).toHaveBeenCalled();
  });

  it('is a no-op in cloud mode', () => {
    process.env.DEPLOYMENT_MODE = 'CLOUD';
    const { rt } = makeRuntime();
    rt.onModuleInit();
    expect(rt.getStatus()).toEqual({ mode: 'cloud' });
    expect(rt.isBlocked()).toBe(false);
    expect(rt.moduleAllowed('anything')).toBe(true);
    for (const m of ['tasks', 'messenger', 'projects', 'crm', 'hr', 'x']) expect(rt.moduleAllowed(m)).toBe(true);
    expect(() => rt.assertUserCapacity(999)).not.toThrow();
  });

  it('accepts an offline v2 token (air-gapped) bound to this installation', async () => {
    // نصب اول installationId می‌سازد
    delete process.env.LICENSE_SERVER_URL;
    const probe = makeRuntime();
    await boot(probe.rt);
    const id = probe.rt.getInstallationId()!;
    const now = new Date();
    const payload: ActivationTokenPayload = {
      v: 2, kid: key.kid, jti: 'j', licenseId: 'l1', licenseKey: LIC_KEY, orgName: 'Air Gapped', product: 'exir-erp', edition: null, installationId: id, fp: null,
      modules: ['crm'], maxUsers: 3, issuedAt: now.toISOString(), notBefore: now.toISOString(), expiresAt: null, updatesUntil: null, graceDays: 14,
      tokenExpiresAt: new Date(now.getTime() + 365 * DAY).toISOString(), nonce: null, serverTime: now.toISOString(), integrityPolicy: 'WARN', crlVersion: 1,
    };
    process.env.LICENSE_TOKEN = signPayload(payload, key);
    const rt = makeRuntime();
    await boot(rt.rt);
    expect(rt.rt.getStatus()).toMatchObject({ state: 'valid', payload: { orgName: 'Air Gapped' } });
    // token for another installation is refused
    const other = { ...payload, installationId: 'i-someone-else' };
    process.env.LICENSE_TOKEN = signPayload(other, key);
    const rt2 = makeRuntime();
    await boot(rt2.rt);
    expect(rt2.rt.isBlocked()).toBe(true);
    expect(rt2.rt.getStatus()).toMatchObject({ reasonCode: 'installation_mismatch' });
  });
});
