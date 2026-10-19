import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  FP_EMPTY,
  LicenseCryptoError,
  computeKid,
  evaluateToken,
  fingerprintDigest,
  fingerprintMatches,
  generateKeypair,
  licenseKeyHash,
  loadSigningKey,
  loadSigningKeyFromEnv,
  parsePublicKeyring,
  responseSigningString,
  signPayload,
  signString,
  verifyActivationToken,
  verifySignedPayload,
  verifyString,
  type ActivationTokenPayload,
} from './license-crypto.js';

const DAY = 86_400_000;
const NOW = new Date('2026-10-19T12:00:00Z');

function setup() {
  const kp = generateKeypair();
  const key = loadSigningKey(kp.privateKeyPem);
  const ring = parsePublicKeyring(kp.publicKeyPem);
  return { kp, key, ring };
}

function payload(over: Partial<ActivationTokenPayload> = {}, kid = 'k'): ActivationTokenPayload {
  return {
    v: 2, kid, jti: 'j1', licenseId: 'l1', licenseKey: 'LIC-AAAAA-BBBBB-CCCCC-DDDDD', orgName: 'Org', product: 'exir-erp', edition: 'pro',
    installationId: 'i-1', fp: null, modules: ['crm'], maxUsers: 10,
    issuedAt: NOW.toISOString(), notBefore: NOW.toISOString(), expiresAt: null, updatesUntil: null, graceDays: 14,
    tokenExpiresAt: new Date(NOW.getTime() + 14 * DAY).toISOString(), nonce: 'n', serverTime: NOW.toISOString(),
    integrityPolicy: 'WARN', crlVersion: 1, ...over,
  };
}

describe('Ed25519 tokens and keys', () => {
  it('kid is stable and derived from the public key', () => {
    const { kp, key } = setup();
    expect(key.kid).toBe(kp.kid);
    expect(computeKid(kp.publicKeyPem)).toBe(kp.kid);
    expect(kp.kid).toMatch(/^[0-9a-f]{16}$/);
  });

  it('sign/verify round trip', () => {
    const { key, ring } = setup();
    const t = signPayload(payload({}, key.kid), key);
    expect(verifyActivationToken(t, ring).licenseKey).toContain('LIC-');
  });

  it('rejects forgery: tampered payload, swapped signature, foreign key', () => {
    const { key, ring } = setup();
    const other = loadSigningKey(generateKeypair().privateKeyPem);
    const t = signPayload(payload({}, key.kid), key);
    const [body, sig] = t.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ ...payload({}, key.kid), modules: ['crm', 'hr', 'accounting'] })).toString('base64url');
    expect(() => verifyActivationToken(`${forgedBody}.${sig}`, ring)).toThrow(LicenseCryptoError);
    const foreign = signPayload(payload({}, key.kid), other); // claims our kid but signed by another key
    expect(() => verifyActivationToken(foreign, ring)).toThrow(/امضا/);
    expect(() => verifyActivationToken(`${body}.AAAA`, ring)).toThrow(LicenseCryptoError);
    expect(() => verifyActivationToken('garbage', ring)).toThrow(LicenseCryptoError);
  });

  it('unknown kid is refused; key rotation works with a multi-key ring', () => {
    const a = setup();
    const b = setup();
    const ring = parsePublicKeyring(`${a.kp.publicKeyPem}\n${b.kp.publicKeyPem}`);
    expect(ring.size).toBe(2);
    expect(verifyActivationToken(signPayload(payload({}, a.key.kid), a.key), ring)).toBeTruthy();
    expect(verifyActivationToken(signPayload(payload({}, b.key.kid), b.key), ring)).toBeTruthy();
    const c = loadSigningKey(generateKeypair().privateKeyPem);
    try {
      verifyActivationToken(signPayload(payload({}, c.kid), c), ring);
      throw new Error('should fail');
    } catch (e) {
      expect((e as LicenseCryptoError).code).toBe('unknown_kid');
    }
  });

  it('encrypted private keys need the right passphrase', () => {
    const kp = generateKeypair('correct horse battery');
    expect(kp.privateKeyPem).toContain('scrypt');
    expect(kp.privateKeyPem).not.toContain('PRIVATE KEY');
    expect(() => loadSigningKey(kp.privateKeyPem)).toThrow(LicenseCryptoError);
    expect(() => loadSigningKey(kp.privateKeyPem, 'wrong')).toThrow(LicenseCryptoError);
    expect(loadSigningKey(kp.privateKeyPem, 'correct horse battery').kid).toBe(kp.kid);
  });

  it('production refuses the passphrase from a plain env var (only _FILE)', () => {
    const kp = generateKeypair('passphrase-123456');
    expect(() => loadSigningKeyFromEnv({ NODE_ENV: 'production', LICENSE_SIGNING_PRIVATE_KEY_PEM: kp.privateKeyPem, LICENSE_SIGNING_KEY_PASSPHRASE: 'passphrase-123456' } as never)).toThrow(LicenseCryptoError);
    expect(loadSigningKeyFromEnv({ NODE_ENV: 'development', LICENSE_SIGNING_PRIVATE_KEY_PEM: kp.privateKeyPem, LICENSE_SIGNING_KEY_PASSPHRASE: 'passphrase-123456' } as never)?.kid).toBe(kp.kid);
  });

  it('loads signing key from secret files via env', () => {
    const kp = generateKeypair('passphrase-123456');
    const dir = mkdtempSync(path.join(tmpdir(), 'lic-'));
    writeFileSync(path.join(dir, 'k.pem'), kp.privateKeyPem);
    writeFileSync(path.join(dir, 'p.txt'), 'passphrase-123456\n');
    const k = loadSigningKeyFromEnv({ LICENSE_SIGNING_PRIVATE_KEY_FILE: path.join(dir, 'k.pem'), LICENSE_SIGNING_KEY_PASSPHRASE_FILE: path.join(dir, 'p.txt') } as never);
    expect(k?.kid).toBe(kp.kid);
    expect(loadSigningKeyFromEnv({} as never)).toBeNull();
  });

  it('response signature binds code, key, identifier, timestamp, nonce and kid', () => {
    const { key, ring } = setup();
    const pub = ring.get(key.kid)!;
    const base = { success: true, code: 'valid', license_key: 'LIC-X', identifier: 'i-1', timestamp: 1760000000, nonce: 'abc12345', kid: key.kid };
    const sig = signString(responseSigningString(base), key);
    expect(verifyString(responseSigningString(base), sig, pub)).toBe(true);
    for (const changed of [{ success: false }, { code: 'activated' }, { identifier: 'i-2' }, { timestamp: 1760000001 }, { nonce: 'zzz12345' }, { license_key: 'LIC-Y' }]) {
      expect(verifyString(responseSigningString({ ...base, ...changed }), sig, pub)).toBe(false);
    }
  });

  it('verifySignedPayload does not trust a payload before verifying the signature', () => {
    const { ring } = setup();
    const body = Buffer.from(JSON.stringify({ v: 2, kid: 'nope' })).toString('base64url');
    expect(() => verifySignedPayload(`${body}.AAAA`, ring)).toThrow(LicenseCryptoError);
  });
});

describe('evaluateToken: perpetual, grace, offline, clock, replay', () => {
  it('perpetual licence with a fresh token is valid and never expires on its own', () => {
    const ev = evaluateToken(payload(), { now: NOW });
    expect(ev).toMatchObject({ state: 'valid', reason: 'ok', warningLevel: 0 });
    const farFuture = new Date(NOW.getTime() + 5 * DAY);
    expect(evaluateToken(payload(), { now: farFuture }).state).toBe('valid');
  });

  it('escalates: renewal due -> offline grace -> hard lock after grace', () => {
    const p = payload();
    expect(evaluateToken(p, { now: new Date(NOW.getTime() + 12 * DAY) })).toMatchObject({ state: 'valid', reason: 'token_renewal_due', warningLevel: 1 });
    const g = evaluateToken(p, { now: new Date(NOW.getTime() + 20 * DAY) });
    expect(g).toMatchObject({ state: 'grace', reason: 'offline_grace', warningLevel: 2 });
    expect(evaluateToken(p, { now: new Date(NOW.getTime() + 14 * DAY + 12 * DAY) })).toMatchObject({ state: 'grace', warningLevel: 3 });
    expect(evaluateToken(p, { now: new Date(NOW.getTime() + 40 * DAY) })).toMatchObject({ state: 'locked', reason: 'offline_expired' });
  });

  it('licence expiry: grace window then lock; support/updates expiry is separate', () => {
    const p = payload({ expiresAt: new Date(NOW.getTime() + DAY).toISOString(), tokenExpiresAt: new Date(NOW.getTime() + 400 * DAY).toISOString() });
    expect(evaluateToken(p, { now: new Date(NOW.getTime() + 5 * DAY) })).toMatchObject({ state: 'grace', reason: 'license_grace' });
    expect(evaluateToken(p, { now: new Date(NOW.getTime() + 30 * DAY) })).toMatchObject({ state: 'locked', reason: 'license_expired' });
  });

  it('updatesUntil only locks builds released after it', () => {
    const p = payload({ updatesUntil: '2026-06-01T00:00:00Z' });
    expect(evaluateToken(p, { now: NOW, buildDate: new Date('2026-05-01') }).state).toBe('valid');
    expect(evaluateToken(p, { now: NOW, buildDate: new Date('2026-09-01') })).toMatchObject({ state: 'locked', reason: 'updates_expired' });
    expect(evaluateToken(payload(), { now: NOW, buildDate: new Date('2030-01-01') }).state).toBe('valid');
  });

  it('clock rollback gives no advantage and is flagged; huge rollback locks', () => {
    const p = payload({ tokenExpiresAt: new Date(NOW.getTime() + 2 * DAY).toISOString() });
    const lastSeen = new Date(NOW.getTime() + 3 * DAY); // we have already seen this far
    const rolled = evaluateToken(p, { now: NOW, lastSeen });
    expect(rolled.clockRollback).toBe(true);
    expect(rolled.state).toBe('grace'); // still computed as if it were day +3 (token expired at +2)
    const huge = evaluateToken(payload({ tokenExpiresAt: new Date(NOW.getTime() + 900 * DAY).toISOString() }), { now: NOW, lastSeen: new Date(NOW.getTime() + 30 * DAY) });
    expect(huge).toMatchObject({ state: 'locked', reason: 'clock_rollback' });
    // small skew is tolerated
    expect(evaluateToken(payload(), { now: NOW, lastSeen: new Date(NOW.getTime() + 60_000) }).clockRollback).toBe(false);
  });

  it('token not yet valid (issued in the future) is refused', () => {
    const p = payload({ notBefore: new Date(NOW.getTime() + 3 * DAY).toISOString() });
    expect(evaluateToken(p, { now: NOW })).toMatchObject({ state: 'locked', reason: 'not_yet_valid' });
  });

  it('binds to installation and fingerprint', () => {
    expect(evaluateToken(payload(), { now: NOW, installationId: 'i-OTHER' })).toMatchObject({ state: 'locked', reason: 'installation_mismatch' });
    const p = payload({ fp: fingerprintDigest(['a', 'b']) });
    expect(evaluateToken(p, { now: NOW, installationId: 'i-1', currentFp: p.fp }).state).toBe('valid');
    expect(evaluateToken(p, { now: NOW, installationId: 'i-1', currentFp: 'zzz' })).toMatchObject({ state: 'locked', reason: 'fingerprint_mismatch' });
  });

  it('CRL: revoked licence key hash or revoked signing kid locks immediately', () => {
    const p = payload({}, 'kid1');
    expect(evaluateToken(p, { now: NOW, crl: { revoked: [licenseKeyHash(p.licenseKey)], revokedKids: [] } })).toMatchObject({ state: 'locked', reason: 'revoked' });
    expect(evaluateToken(p, { now: NOW, crl: { revoked: [], revokedKids: ['kid1'] } }).state).toBe('locked');
    expect(evaluateToken(p, { now: NOW, crl: { revoked: ['deadbeef'], revokedKids: [] } }).state).toBe('valid');
  });
});

describe('fingerprint tolerance', () => {
  const stored = ['m1', 'cpu', 'kern', 'mem', 'net'];
  it('accepts limited changes (net/hostname after container recreate)', () => {
    expect(fingerprintMatches(stored, ['m1', 'cpu', 'kern', 'mem', 'net2'])).toBe(true);
    expect(fingerprintMatches(stored, ['m1', 'cpu', 'kern', 'mem2', 'net2'])).toBe(true);
  });
  it('rejects a different machine-id even if other parts match (cloned image on identical VM type)', () => {
    expect(fingerprintMatches(stored, ['m2', 'cpu', 'kern', 'mem', 'net'])).toBe(false);
  });
  it('rejects major changes and tolerates unavailable machine-id', () => {
    expect(fingerprintMatches(stored, ['m1', 'c2', 'k2', 'mem2', 'n2'])).toBe(false);
    expect(fingerprintMatches([FP_EMPTY, 'cpu', 'kern', 'mem', 'net'], ['mX', 'cpu', 'kern', 'mem', 'netX'])).toBe(true);
  });
});
