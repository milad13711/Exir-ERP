import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, totpCodeAt, verifyTotp } from './totp.js';

// RFC 6238 Appendix B: secret = ASCII "12345678901234567890", SHA-1. Expected 8-digit codes; ours are the last 6 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const vectors: Array<[number, string]> = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [t, expected] of vectors) expect(totpCodeAt(RFC_SECRET, Math.floor(t / 30))).toBe(expected);
  });

  it('base32 round-trips', () => {
    const raw = Buffer.from('hello-exir-erp!');
    expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true);
  });

  it('accepts the current and adjacent step, rejects far-away steps and malformed input', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    expect(verifyTotp(secret, totpCodeAt(secret, step), { nowMs: now })).toBe(step);
    expect(verifyTotp(secret, totpCodeAt(secret, step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(secret, totpCodeAt(secret, step + 5), { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, '12345', { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { nowMs: now })).toBeNull();
  });

  it('refuses a replay of an already-used step', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    const code = totpCodeAt(secret, step);
    expect(verifyTotp(secret, code, { nowMs: now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, code, { nowMs: now, lastUsedStep: step - 1 })).toBe(step);
  });

  it('recovery codes: 10 unique, hashed case/format-insensitively', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(codes[0].toUpperCase().replace('-', ' ')));
    expect(hashRecoveryCode(codes[0])).not.toBe(hashRecoveryCode(codes[1]));
  });
});
