import { describe, expect, it } from 'vitest';
import { LICENSE_KEY_ALPHABET } from './license-crypto.js';
import { effectiveStatus, generateLicenseKey, generateUniqueLicenseKey, isWellFormedKey, keyHint, normalizeIdentifier, normalizeLicenseKey } from './license-key.js';

describe('license key generation', () => {
  it('matches LIC-XXXXX-XXXXX-XXXXX-XXXXX with the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const k = generateLicenseKey();
      expect(k).toMatch(/^LIC-[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
      expect(/[01OI]/.test(k.slice(4))).toBe(false);
      expect(normalizeLicenseKey(k)).toBe(k);
    }
    expect(LICENSE_KEY_ALPHABET).toHaveLength(32);
  });

  it('is practically collision-free and uses all alphabet characters (CSPRNG distribution sanity)', () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const k = generateLicenseKey();
      seen.add(k);
      for (const c of k.replace(/LIC|-/g, '')) chars.add(c);
    }
    expect(seen.size).toBe(2000);
    expect(chars.size).toBe(32);
  });

  it('retries on collision until unique', async () => {
    let calls = 0;
    const key = await generateUniqueLicenseKey(async () => ++calls < 3);
    expect(calls).toBe(3);
    expect(key).toMatch(/^LIC-/);
  });

  it('gives up after maxTries', async () => {
    await expect(generateUniqueLicenseKey(async () => true, 3)).rejects.toThrow();
  });

  it('normalizes key input and rejects malformed ones', () => {
    expect(normalizeLicenseKey('  lic-abcde-fghjk-23456-mnpqr ')).toBe('LIC-ABCDE-FGHJK-23456-MNPQR');
    expect(normalizeLicenseKey('')).toBeNull();
    expect(isWellFormedKey('LIC-ABCDE-0OI1X-23456-MNPQR')).toBe(false);
    expect(isWellFormedKey('LIC-ABCDE-FGHJK-23456-MNPQR')).toBe(true);
    expect(normalizeLicenseKey('x'.repeat(65))).toBeNull();
    expect(normalizeLicenseKey(42)).toBeNull();
    expect(normalizeLicenseKey("LIC-' OR 1=1 --")).toBeNull();
  });

  it('keyHint exposes only the last 8 characters', () => {
    expect(keyHint('LIC-ABCDE-FGHJK-23456-MNPQR')).toBe('56-MNPQR');
    expect(keyHint(null)).toBeNull();
  });
});

describe('identifier normalization', () => {
  it.each([
    ['https://www.Example.com/blog?x=1', 'example.com'],
    ['http://example.com:8080/', 'example.com:8080'],
    ['  Device-ABC-123 ', 'device-abc-123'],
    ['www.test-site.org', 'test-site.org'],
    ['https://www.Test-Site.org/path', 'test-site.org'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeIdentifier(input)).toBe(expected);
  });

  it('caps at 255 chars and rejects control chars / non-strings', () => {
    expect(normalizeIdentifier('a'.repeat(400))).toHaveLength(255);
    expect(normalizeIdentifier('a b')).toBe('');
    expect(normalizeIdentifier('a\u0000b')).toBe('');
    expect(normalizeIdentifier(undefined)).toBe('');
    expect(normalizeIdentifier({})).toBe('');
  });
});

describe('effective status', () => {
  const now = new Date('2026-10-19T00:00:00Z');
  it('active + past expiry => expired; perpetual stays active', () => {
    expect(effectiveStatus({ status: 'ACTIVE', expiresAt: new Date('2026-01-01') }, now)).toBe('expired');
    expect(effectiveStatus({ status: 'ACTIVE', expiresAt: new Date('2027-01-01') }, now)).toBe('active');
    expect(effectiveStatus({ status: 'ACTIVE', expiresAt: null }, now)).toBe('active');
  });
  it('suspended / revoked win over expiry', () => {
    expect(effectiveStatus({ status: 'SUSPENDED', expiresAt: new Date('2020-01-01') }, now)).toBe('suspended');
    expect(effectiveStatus({ status: 'REVOKED', expiresAt: null }, now)).toBe('revoked');
  });
});
