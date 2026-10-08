import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppSecretsKeyMissingError, isAppSecretsKeyConfigured, isSealed, openSecret, sealSecret } from './app-secrets.js';

describe('app-secrets (AES-256-GCM at rest, fail-closed)', () => {
  const saved = process.env.APP_SECRETS_KEY;
  beforeEach(() => { process.env.APP_SECRETS_KEY = randomBytes(32).toString('hex'); });
  afterEach(() => { if (saved === undefined) delete process.env.APP_SECRETS_KEY; else process.env.APP_SECRETS_KEY = saved; });

  it('round-trips and never stores plaintext', () => {
    const sealed = sealSecret('merchant-1234-abcd', 'gateway:x:t1');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('merchant');
    expect(openSecret(sealed, 'gateway:x:t1')).toEqual({ value: 'merchant-1234-abcd', legacy: false });
  });

  it('is randomised (two seals of the same value differ)', () => {
    expect(sealSecret('same', 'a')).not.toBe(sealSecret('same', 'a'));
  });

  it('binds to the AAD: a blob copied to another tenant/field does not open', () => {
    const sealed = sealSecret('k', 'gateway:bitpay.apiKey:tenantA');
    expect(() => openSecret(sealed, 'gateway:bitpay.apiKey:tenantB')).toThrow();
  });

  it('detects tampering', () => {
    const sealed = sealSecret('k', 'a');
    const bad = sealed.slice(0, -4) + (sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => openSecret(bad, 'a')).toThrow();
  });

  it('fails closed when the key is missing or malformed: writing throws, plaintext is never produced', () => {
    delete process.env.APP_SECRETS_KEY;
    expect(isAppSecretsKeyConfigured()).toBe(false);
    expect(() => sealSecret('x', 'a')).toThrow(AppSecretsKeyMissingError);
    process.env.APP_SECRETS_KEY = 'too-short';
    expect(() => sealSecret('x', 'a')).toThrow(AppSecretsKeyMissingError);
  });

  it('legacy plaintext is still readable (flagged legacy) so existing rows keep working until lazily migrated', () => {
    expect(openSecret('old-plain-merchant', 'a')).toEqual({ value: 'old-plain-merchant', legacy: true });
    expect(openSecret('', 'a')).toEqual({ value: '', legacy: false });
    delete process.env.APP_SECRETS_KEY;
    expect(openSecret('old-plain-merchant', 'a').value).toBe('old-plain-merchant'); // reading legacy needs no key
  });

  it('empty secret stays empty even without a key', () => {
    delete process.env.APP_SECRETS_KEY;
    expect(sealSecret('', 'a')).toBe('');
  });
});
