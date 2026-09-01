import { describe, expect, it } from 'vitest';
import {
  generateLicenseKeypair,
  signLicense,
  verifyLicenseToken,
  isExpired,
  InvalidLicenseError,
  type LicensePayload,
} from './license-token.js';

const { privateKeyPem, publicKeyPem } = generateLicenseKeypair();

function samplePayload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    licenseId: 'lic_test_1',
    orgName: 'شرکت نمونه',
    modules: ['crm', 'accounting'],
    seats: 25,
    issuedAt: new Date('2026-01-01').toISOString(),
    expiresAt: new Date('2027-01-01').toISOString(),
    ...overrides,
  };
}

describe('license-token', () => {
  it('signs and verifies a round trip', () => {
    const token = signLicense(samplePayload(), privateKeyPem);
    const verified = verifyLicenseToken(token, publicKeyPem);
    expect(verified.orgName).toBe('شرکت نمونه');
    expect(verified.modules).toEqual(['crm', 'accounting']);
  });

  it('rejects a token signed with a different key', () => {
    const otherKeypair = generateLicenseKeypair();
    const token = signLicense(samplePayload(), otherKeypair.privateKeyPem);
    expect(() => verifyLicenseToken(token, publicKeyPem)).toThrow(InvalidLicenseError);
  });

  it('rejects a tampered payload (e.g. modules list widened after signing)', () => {
    const token = signLicense(samplePayload(), privateKeyPem);
    const [body, signature] = token.split('.');
    const tamperedPayload = { ...samplePayload(), modules: ['crm', 'accounting', 'hr', 'warehouse'] };
    const tamperedBody = Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url');
    expect(tamperedBody).not.toBe(body);
    expect(() => verifyLicenseToken(`${tamperedBody}.${signature}`, publicKeyPem)).toThrow(
      InvalidLicenseError,
    );
  });

  it('rejects a malformed token', () => {
    expect(() => verifyLicenseToken('not-a-valid-token', publicKeyPem)).toThrow(InvalidLicenseError);
  });

  it('detects expiry independently of signature validity', () => {
    const expired = samplePayload({ expiresAt: new Date('2020-01-01').toISOString() });
    expect(isExpired(expired)).toBe(true);
    expect(isExpired(samplePayload())).toBe(false);
  });
});
