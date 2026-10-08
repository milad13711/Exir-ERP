import { describe, expect, it } from 'vitest';
import { assertSecureConfig, InsecureConfigError } from './boot-checks.js';

const strong = 'a3f1c9d7e5b2486f90ab12cd34ef5678a3f1c9d7e5b2486f90ab12cd34ef5678';

describe('assertSecureConfig', () => {
  it('refuses to boot without JWT_SECRET', () => {
    expect(() => assertSecureConfig({} as never)).toThrow(InsecureConfigError);
    expect(() => assertSecureConfig({ JWT_SECRET: '   ' } as never)).toThrow(InsecureConfigError);
  });

  it('production refuses placeholder / trivially weak secrets', () => {
    for (const s of ['secret', 'changeme', 'dev-secret', 'password', 'change-me-in-production', 'your-secret-key-here-please', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'short']) {
      expect(() => assertSecureConfig({ NODE_ENV: 'production', JWT_SECRET: s } as never), s).toThrow(InsecureConfigError);
    }
  });

  it('development only warns for a placeholder (a .env copied from .env.example must still boot locally)', () => {
    const w = assertSecureConfig({ JWT_SECRET: 'change-me-in-production' } as never);
    expect(w.join(' ')).toContain('JWT_SECRET');
  });

  it('accepts a strong secret without warnings outside production', () => {
    expect(assertSecureConfig({ JWT_SECRET: strong } as never)).toEqual([]);
  });

  it('warns (does not crash) for a 16-31 char secret', () => {
    const w = assertSecureConfig({ JWT_SECRET: 'abcdefghij1234567890' } as never);
    expect(w.join(' ')).toContain('JWT_SECRET');
  });

  it('production: warns about OTP_DEV_ECHO, missing APP_SECRETS_KEY, localhost CORS, passwordless tenant DB, superuser role', () => {
    const w = assertSecureConfig({ NODE_ENV: 'production', JWT_SECRET: strong, OTP_DEV_ECHO: 'true', CORS_ORIGINS: 'http://localhost:3000', TENANT_DB_ADMIN_USER: 'postgres' } as never).join('\n');
    for (const needle of ['OTP_DEV_ECHO', 'APP_SECRETS_KEY', 'CORS_ORIGINS', 'TENANT_DB_ADMIN_PASSWORD', 'postgres']) expect(w).toContain(needle);
  });

  it('never prints the secret itself', () => {
    const w = assertSecureConfig({ NODE_ENV: 'production', JWT_SECRET: 'abcdefghij1234567890' } as never).join('\n');
    expect(w).not.toContain('abcdefghij1234567890');
  });
});
