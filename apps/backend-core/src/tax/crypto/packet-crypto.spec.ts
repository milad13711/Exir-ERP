import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aesGcmDecrypt, aesGcmEncrypt, decryptInvoicePacket, encryptInvoice, rsaOaepDecrypt, rsaOaepEncrypt, signString, verifyString, xorWithKey } from './packet-crypto.js';
import { normalizeJson } from './normalize.js';
import { signAsyncRequest } from './request-signing.js';
import { decryptSecret, encryptSecret, loadSecretsKey, privateKeyAad, SecretsKeyMissingError } from './secret-box.js';
import { parseCertificatePem, parsePrivateKeyPem, publicKeyFingerprint } from './pem.js';

const taxpayer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const server = generateKeyPairSync('rsa', { modulusLength: 2048 });

const invoice = { header: { taxid: 'AA56CD0E0620002F2B4E78', tbill: 1090000, irtaxid: null }, body: [{ sstt: 'پاستیل # میوه‌ای', am: 2, vra: 0.09 }], payments: [] };

describe('signing (RSA-SHA256)', () => {
  it('sign → verify with the matching public key; fails on tamper or wrong key', () => {
    const text = normalizeJson(invoice);
    const sig = signString(text, taxpayer.privateKey);
    expect(verifyString(text, sig, taxpayer.publicKey)).toBe(true);
    expect(verifyString(text + 'x', sig, taxpayer.publicKey)).toBe(false);
    expect(verifyString(text, sig, server.publicKey)).toBe(false);
  });

  it('request signature covers the signed headers (changing requestTraceId invalidates it)', () => {
    const pk = [{ uid: 'u1', retry: false }];
    const a = signAsyncRequest(pk, { requestTraceId: 't1', timestamp: 1 }, taxpayer.privateKey);
    const b = signAsyncRequest(pk, { requestTraceId: 't2', timestamp: 1 }, taxpayer.privateKey);
    expect(a).not.toBe(b);
    expect(verifyString(normalizeJson(pk, { requestTraceId: 't1', timestamp: 1 }), a, taxpayer.publicKey)).toBe(true);
  });
});

describe('XOR / AES-GCM / RSA-OAEP primitives', () => {
  it('xor is its own inverse in both modes, and FIRST_BLOCK_ONLY leaves bytes past 32 untouched', () => {
    const key = randomBytes(32);
    const data = randomBytes(100);
    for (const mode of ['PER_BLOCK', 'FIRST_BLOCK_ONLY'] as const) {
      expect(xorWithKey(xorWithKey(data, key, mode), key, mode).equals(data)).toBe(true);
    }
    const first = xorWithKey(data, key, 'FIRST_BLOCK_ONLY');
    expect(first.subarray(32).equals(data.subarray(32))).toBe(true);
    expect(first.subarray(0, 32).equals(data.subarray(0, 32))).toBe(false);
    const per = xorWithKey(data, key, 'PER_BLOCK');
    expect(per[40]).toBe(data[40]! ^ key[8]!);
  });

  it('AES-256-GCM round trip with 16-byte IV; tampering is detected', () => {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const ct = aesGcmEncrypt(Buffer.from('سلام'), key, iv);
    expect(aesGcmDecrypt(ct, key, iv).toString('utf8')).toBe('سلام');
    ct[0] = ct[0]! ^ 1;
    expect(() => aesGcmDecrypt(ct, key, iv)).toThrow();
  });

  it('RSA-OAEP-SHA256 round trip', () => {
    const m = Buffer.from('abcdef0123');
    expect(rsaOaepDecrypt(rsaOaepEncrypt(m, server.publicKey), server.privateKey).equals(m)).toBe(true);
  });
});

describe('encryptInvoice / decryptInvoicePacket (full §6 pipeline)', () => {
  it('round-trips the invoice and the signature verifies against the normalized text of the decrypted invoice', () => {
    const parts = encryptInvoice(invoice, { privateKey: taxpayer.privateKey, serverPublicKey: server.publicKey });
    expect(parts.iv).toMatch(/^[0-9a-f]{32}$/);
    const back = decryptInvoicePacket(parts, server.privateKey);
    expect(back).toEqual(invoice);
    expect(verifyString(normalizeJson(back), parts.dataSignature, taxpayer.publicKey)).toBe(true);
  });

  it('the ciphertext is not the plain JSON and differs per call', () => {
    const a = encryptInvoice(invoice, { privateKey: taxpayer.privateKey, serverPublicKey: server.publicKey });
    const b = encryptInvoice(invoice, { privateKey: taxpayer.privateKey, serverPublicKey: server.publicKey });
    expect(a.data).not.toBe(b.data);
    expect(Buffer.from(a.data, 'base64').toString('utf8')).not.toContain('AA56CD');
  });
});

describe('secret-box (private key encryption at rest)', () => {
  const key = randomBytes(32);

  it('round trips and binds to the tenant via AAD', () => {
    const blob = encryptSecret('-----BEGIN PRIVATE KEY-----abc', privateKeyAad('t1'), key);
    expect(blob.startsWith('v1:')).toBe(true);
    expect(blob).not.toContain('BEGIN');
    expect(decryptSecret(blob, privateKeyAad('t1'), key)).toBe('-----BEGIN PRIVATE KEY-----abc');
    expect(() => decryptSecret(blob, privateKeyAad('t2'), key)).toThrow();
    expect(() => decryptSecret(blob, privateKeyAad('t1'), randomBytes(32))).toThrow();
  });

  it('fails closed when TAX_SECRETS_KEY is missing or malformed (never plaintext)', () => {
    expect(() => loadSecretsKey(undefined)).toThrow(SecretsKeyMissingError);
    expect(() => loadSecretsKey('')).toThrow(SecretsKeyMissingError);
    expect(() => loadSecretsKey('short')).toThrow(SecretsKeyMissingError);
    expect(() => encryptSecret('x', 'a', undefined as never)).toThrow(SecretsKeyMissingError);
    expect(loadSecretsKey('a'.repeat(64)).length).toBe(32);
    expect(loadSecretsKey(randomBytes(32).toString('base64')).length).toBe(32);
  });
});

describe('PEM parsing', () => {
  it('parses a real RSA PKCS#8 key, returns only a fingerprint, and rejects garbage / weak keys', () => {
    const pem = taxpayer.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const parsed = parsePrivateKeyPem(pem);
    expect(parsed.fingerprint).toBe(publicKeyFingerprint(taxpayer.publicKey));
    expect(parsed.modulusLength).toBe(2048);
    expect(() => parsePrivateKeyPem('not a key')).toThrow();
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    expect(() => parsePrivateKeyPem(weak)).toThrow();
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    expect(() => parsePrivateKeyPem(ec)).toThrow();
    expect(() => parseCertificatePem('garbage')).toThrow();
  });
});
