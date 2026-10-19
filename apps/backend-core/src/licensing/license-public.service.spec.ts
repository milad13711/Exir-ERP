import { beforeEach, describe, expect, it } from 'vitest';
import {
  generateKeypair,
  parsePublicKeyring,
  responseSigningString,
  verifyActivationToken,
  verifyString,
} from './license-crypto.js';
import { LicensePublicService, type PublicBody, type PublicRequest } from './license-public.service.js';
import { LicenseSigningService } from './license-signing.service.js';
import { LicenseAuditService } from './license-audit.service.js';
import { LicenseSettingsService } from './license-settings.service.js';
import { generateLicenseKey } from './license-key.js';

type Row = Record<string, any>;

/** حافظه‌ی درون‌پردازه‌ای که از زیرمجموعه‌ی Prisma مورد استفاده شبیه‌سازی می‌کند؛ $transaction با mutex = قفل ردیف (FOR UPDATE). */
function fakeDb() {
  const licenses: Row[] = [];
  const acts: Row[] = [];
  const events: Row[] = [];
  const settings = new Map<string, string>();
  let lock: Promise<unknown> = Promise.resolve();
  let seq = 0;
  const match = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v instanceof Date) return +row[k] === +v;
      if (v && typeof v === 'object') {
        if ('in' in v) return v.in.includes(row[k]);
        if ('not' in v) return v.not === null ? row[k] != null : row[k] !== v.not;
        if ('gte' in v) return row[k] != null && +row[k] >= +v.gte;
      }
      return v === null ? row[k] == null : v === row[k];
    });
  const tick = () => new Promise((r) => setImmediate(r)); // برای آشکار شدن race بدون قفل
  const db: any = {
    licenseSetting: { findMany: async () => [...settings].map(([key, value]) => ({ key, value })), upsert: async ({ where, create, update }: any) => { settings.set(where.key, (settings.has(where.key) ? update : create).value); } },
    license: {
      findFirst: async ({ where }: any) => { await tick(); return licenses.find((l) => match(l, where)) ?? null; },
      findMany: async () => licenses.filter((l) => l.status !== 'ACTIVE' || l.deletedAt),
      update: async ({ where, data }: any) => { Object.assign(licenses.find((l) => l.id === where.id)!, data); },
    },
    licenseActivation: {
      findFirst: async ({ where }: any) => { await tick(); return acts.find((a) => match(a, where)) ?? null; },
      count: async ({ where }: any) => { await tick(); return acts.filter((a) => match(a, where)).length; },
      create: async ({ data }: any) => { await tick(); const r = { id: `a${++seq}`, deletedAt: null, activatedAt: new Date(), lastCheckAt: new Date(), ...data }; acts.push(r); return r; },
      update: async ({ where, data }: any) => { Object.assign(acts.find((a) => a.id === where.id)!, data); },
      updateMany: async ({ where, data }: any) => { const m = acts.filter((a) => match(a, where)); m.forEach((a) => Object.assign(a, data)); return { count: m.length }; },
    },
    licenseEvent: { create: async ({ data }: any) => { events.push(data); } },
    $queryRaw: async () => [],
    $transaction: async (cb: (tx: any) => Promise<unknown>) => {
      const run = lock.then(() => cb(db));
      lock = run.catch(() => undefined);
      return run;
    },
  };
  return { db, licenses, acts, events, settings };
}

const kp = generateKeypair();
process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM = kp.privateKeyPem;
const ring = parsePublicKeyring(kp.publicKeyPem);

function build() {
  const f = fakeDb();
  const settings = new LicenseSettingsService(f.db);
  const svc = new LicensePublicService(f.db, settings, new LicenseSigningService(), new LicenseAuditService(f.db));
  const add = (over: Row = {}) => {
    const l: Row = {
      id: `l${f.licenses.length + 1}`, licenseKey: generateLicenseKey(), orgName: 'Org Secret Name', customerName: 'Ali Customer', customerEmail: 'ali@example.com',
      productName: 'Sample Product', edition: 'pro', allowedModules: ['crm'], seats: 5, maxActivations: 2, status: 'ACTIVE', expiresAt: null, updatesUntil: null,
      graceDays: 14, integrityPolicy: 'WARN', deletedAt: null, lastAppVersion: null, ...over,
    };
    f.licenses.push(l);
    return l;
  };
  const call = async (action: PublicRequest['action'], licenseKey: unknown, identifier?: unknown, extra: Partial<PublicRequest> = {}) => {
    const r = await svc.handle({ action, licenseKey, identifier, ip: '1.2.3.4', ...extra });
    return r;
  };
  return { ...f, svc, add, call, settings };
}

const FP = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32), 'd'.repeat(32), 'e'.repeat(32)];

describe('public license API (reference scenario)', () => {
  let t: ReturnType<typeof build>;
  beforeEach(() => { t = build(); });

  it('runs the 12-step manual scenario with the right codes and HTTP statuses', async () => {
    const l = t.add({ maxActivations: 2 });
    const k = l.licenseKey;
    const r1 = await t.call('activate', k, 'example.com');
    expect([r1.http, r1.body.code, r1.body.success]).toEqual([200, 'activated', true]);
    const r2 = await t.call('activate', k, 'example.com');
    expect(r2.body.code).toBe('already_activated');
    expect(r2.body.data?.activations).toBe(1);
    const r3 = await t.call('activate', k, 'https://www.Test-Site.org/path');
    expect(r3.body.code).toBe('activated');
    expect(r3.body.identifier).toBe('test-site.org');
    const r4 = await t.call('activate', k, 'third.example.net');
    expect([r4.http, r4.body.code]).toEqual([403, 'activation_limit_reached']);
    expect(r4.body.data?.max_activations).toBe(2);
    expect((await t.call('verify', k, 'example.com')).body.code).toBe('valid');
    expect((await t.call('verify', k, 'unknown.example.org')).body.code).toBe('not_activated');
    expect((await t.call('verify', k)).body.code).toBe('valid');
    l.status = 'SUSPENDED';
    expect((await t.call('verify', k, 'example.com')).body.code).toBe('license_suspended');
    const d = await t.call('deactivate', k, 'example.com');
    expect([d.http, d.body.code]).toEqual([200, 'deactivated']);
    expect((await t.call('activate', k, 'third.example.net')).body.code).toBe('license_suspended');
    l.status = 'ACTIVE';
    // اسلات آزادشده توسط کلاینت تا پایان اعتبار توکن اشغال می‌ماند → هنوز پر است
    expect((await t.call('activate', k, 'third.example.net')).body.code).toBe('activation_limit_reached');
    // آزادسازی ادمین فوری است
    t.acts.find((a) => a.identifier === 'example.com')!.releasedBy = 'admin:1';
    expect((await t.call('activate', k, 'third.example.net')).body.code).toBe('activated');
    const nf = await t.call('verify', 'LIC-NOPE2-22222-22222-22222');
    expect([nf.http, nf.body.code]).toEqual([404, 'license_not_found']);
    l.expiresAt = new Date('2020-01-01');
    expect((await t.call('verify', k, 'test-site.org')).body.code).toBe('license_expired');
  });

  it('missing key / identifier / revoked / disabled api', async () => {
    const l = t.add();
    expect((await t.call('verify', '')).http).toBe(400);
    expect((await t.call('verify', 'bad key')).body.code).toBe('missing_license_key');
    expect((await t.call('activate', l.licenseKey)).body.code).toBe('missing_identifier');
    expect((await t.call('deactivate', l.licenseKey)).body.code).toBe('missing_identifier');
    l.status = 'REVOKED';
    expect((await t.call('verify', l.licenseKey)).body.code).toBe('license_revoked');
    l.status = 'ACTIVE';
    await t.settings.set({ apiEnabled: false });
    const off = await t.call('verify', l.licenseKey);
    expect([off.http, off.body.code]).toEqual([503, 'api_disabled']);
  });

  it('soft-deleted licence is not found', async () => {
    const l = t.add({ deletedAt: new Date() });
    expect((await t.call('verify', l.licenseKey)).body.code).toBe('license_not_found');
  });

  it('deactivate works for a suspended licence; unknown activation => not_activated', async () => {
    const l = t.add({ maxActivations: 1 });
    await t.call('activate', l.licenseKey, 'a.com');
    l.status = 'SUSPENDED';
    expect((await t.call('deactivate', l.licenseKey, 'a.com')).body.code).toBe('deactivated');
    expect((await t.call('deactivate', l.licenseKey, 'a.com')).body.code).toBe('not_activated');
  });

  it('self-deactivate does NOT free the slot while its token is still valid (no activate/deactivate cycling across machines)', async () => {
    const l = t.add({ maxActivations: 1, graceDays: 7 });
    await t.call('activate', l.licenseKey, 'm1');
    await t.call('deactivate', l.licenseKey, 'm1');
    for (const m of ['m2', 'm3', 'm4']) {
      expect((await t.call('activate', l.licenseKey, m)).body.code).toBe('activation_limit_reached');
    }
    // same installation can come back (row revived, no duplicate)
    expect((await t.call('activate', l.licenseKey, 'm1')).body.code).toBe('activated');
    expect(t.acts).toHaveLength(1);
    // after token validity + grace has passed the hold ends
    await t.call('deactivate', l.licenseKey, 'm1');
    t.acts[0].lastTokenAt = new Date(Date.now() - 30 * 86_400_000);
    expect((await t.call('activate', l.licenseKey, 'm2')).body.code).toBe('activated');
  });

  it('max_activations = 0 means unlimited', async () => {
    const l = t.add({ maxActivations: 0 });
    for (let i = 0; i < 15; i++) expect((await t.call('activate', l.licenseKey, `h${i}.com`)).body.code).toBe('activated');
  });

  it('is atomic under concurrency: never exceeds the activation limit', async () => {
    const l = t.add({ maxActivations: 3 });
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => t.call('activate', l.licenseKey, `host-${i}.example.com`)));
    expect(results.filter((r) => r.body.code === 'activated')).toHaveLength(3);
    expect(results.filter((r) => r.body.code === 'activation_limit_reached')).toHaveLength(22);
    expect(t.acts.filter((a) => !a.deletedAt)).toHaveLength(3);
  });

  it('is idempotent under concurrent activation of the same identifier', async () => {
    const l = t.add({ maxActivations: 5 });
    const rs = await Promise.all(Array.from({ length: 10 }, () => t.call('activate', l.licenseKey, 'same.example.com')));
    expect(rs.filter((r) => r.body.code === 'activated')).toHaveLength(1);
    expect(rs.filter((r) => r.body.code === 'already_activated')).toHaveLength(9);
    expect(t.acts).toHaveLength(1);
  });
});

describe('public license API: signatures, tokens, privacy, audit', () => {
  it('response and token are Ed25519-signed, bound to nonce and installation, and carry entitlements', async () => {
    const t = build();
    const l = t.add({ allowedModules: ['crm', 'accounting'], seats: 7, expiresAt: null, updatesUntil: new Date('2027-05-01') });
    const nonce = 'nonce-abcdef12';
    const { body } = await t.call('activate', l.licenseKey, 'i-install1', { nonce, fingerprint: FP });
    expect(body.success).toBe(true);
    const pub = ring.get(body.kid)!;
    expect(verifyString(responseSigningString({ success: true, code: body.code, license_key: body.license_key, identifier: body.identifier, timestamp: body.timestamp, nonce, kid: body.kid, crlHash: '' }), body.signature, pub)).toBe(true);
    const tok = verifyActivationToken(body.token!, ring);
    expect(tok).toMatchObject({ licenseKey: l.licenseKey, installationId: 'i-install1', nonce, modules: ['crm', 'accounting'], maxUsers: 7, expiresAt: null, product: 'Sample Product', edition: 'pro' });
    expect(tok.updatesUntil).toContain('2027-05-01');
    expect(tok.fp).toBeTruthy();
    expect(new Date(tok.tokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('never leaks personal data in any response', async () => {
    const t = build();
    const l = t.add();
    const all = [
      await t.call('activate', l.licenseKey, 'x.com'),
      await t.call('verify', l.licenseKey, 'x.com'),
      await t.call('verify', 'LIC-NOPE2-22222-22222-22222'),
      await t.call('activate', l.licenseKey, 'y.com'),
    ];
    const text = JSON.stringify(all.map((r) => r.body));
    for (const secret of ['ali@example.com', 'Ali Customer', 'Org Secret Name']) expect(text).not.toContain(secret);
  });

  it('fingerprint binding: another host with the same installation id is refused; small drift is accepted', async () => {
    const t = build();
    const l = t.add();
    expect((await t.call('activate', l.licenseKey, 'i-a', { fingerprint: FP })).body.code).toBe('activated');
    const drift = [...FP.slice(0, 4), 'f'.repeat(32)];
    expect((await t.call('checkin', l.licenseKey, 'i-a', { fingerprint: drift })).body.code).toBe('valid');
    const other = ['1'.repeat(32), 'b'.repeat(32), 'c'.repeat(32), 'd'.repeat(32), 'e'.repeat(32)];
    const bad = await t.call('checkin', l.licenseKey, 'i-a', { fingerprint: other });
    expect([bad.http, bad.body.code]).toEqual([403, 'fingerprint_mismatch']);
    expect((await t.call('verify', l.licenseKey, 'i-a')).body.code).toBe('fingerprint_mismatch'); // omitting the fingerprint does not bypass
    expect((await t.call('activate', l.licenseKey, 'i-a', { fingerprint: other })).body.code).toBe('fingerprint_mismatch');
  });

  it('check-in stores sanitized telemetry only and returns a signed CRL containing revoked keys', async () => {
    const t = build();
    const l = t.add();
    const gone = t.add({ status: 'REVOKED' });
    await t.call('activate', l.licenseKey, 'i-a', { fingerprint: FP });
    const r = await t.call('checkin', l.licenseKey, 'i-a', {
      fingerprint: FP,
      telemetry: { appVersion: '1.2.3', users: 4, modules: 2, tamper: { status: 'tampered', modified: 3 }, ssn: '123', email: 'x@y.z', clockRollback: true },
    });
    expect(r.body.crl).toBeTruthy();
    const crypto = await import('./license-crypto.js');
    // the CRL is covered by the response signature (hash bound)
    expect(verifyString(responseSigningString({ success: true, code: r.body.code, license_key: r.body.license_key, identifier: r.body.identifier, timestamp: r.body.timestamp, nonce: r.body.nonce, kid: r.body.kid, crlHash: crypto.sha256Hex(r.body.crl!) }), r.body.signature, ring.get(r.body.kid)!)).toBe(true);
    const crl = crypto.verifySignedPayload<any>(r.body.crl!, ring);
    expect(crl.revoked).toContain((await import('./license-crypto.js')).licenseKeyHash(gone.licenseKey));
    const act = t.acts[0];
    expect(act.tamperStatus).toBe('tampered');
    expect(JSON.stringify(act.lastTelemetry)).not.toContain('ssn');
    expect(JSON.stringify(act.lastTelemetry)).not.toContain('x@y.z');
    expect(t.licenses[0].lastTamperStatus).toBe('tampered');
  });

  it('audits failures and mutations always; routine valid verifies are sampled; full key is never logged', async () => {
    const t = build();
    await t.settings.set({ auditSampleEvery: 1000 });
    const l = t.add();
    await t.call('activate', l.licenseKey, 'a.com');
    await t.call('verify', 'LIC-NOPE2-22222-22222-22222');
    const before = t.events.length;
    for (let i = 0; i < 5; i++) await t.call('verify', l.licenseKey, 'a.com');
    expect(t.events.length - before).toBeLessThanOrEqual(1);
    expect(t.events.map((e) => e.code)).toEqual(expect.arrayContaining(['activated', 'license_not_found']));
    for (const e of t.events) {
      expect(JSON.stringify(e)).not.toContain(l.licenseKey);
      if (e.licenseKeyHint) expect(e.licenseKeyHint).toHaveLength(8);
    }
  });

  it('rate_limited responses are never written to the DB', async () => {
    const t = build();
    const before = t.events.length;
    const r = await t.svc.reject({ action: 'verify', licenseKey: 'x', identifier: '', ip: '1.1.1.1' }, 'rate_limited');
    expect(r.http).toBe(429);
    expect(t.events.length).toBe(before);
  });

  it('returns server_misconfigured (not a crash) when the signing key is missing', async () => {
    const saved = process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM;
    delete process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM;
    try {
      const t = build();
      const l = t.add();
      const r = await t.call('verify', l.licenseKey);
      expect([r.http, r.body.code]).toEqual([503, 'server_misconfigured']);
    } finally {
      process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM = saved;
    }
  });

  it('body shape is stable', async () => {
    const t = build();
    const l = t.add();
    const { body } = await t.call('verify', l.licenseKey);
    const keys = Object.keys(body satisfies PublicBody).sort();
    expect(keys).toEqual(['code', 'data', 'identifier', 'kid', 'license_key', 'message', 'nonce', 'signature', 'success', 'timestamp']);
  });
});
