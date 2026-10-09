import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TenantPrismaService } from './tenant-prisma.service.js';
import { buildTenantClusterUrl } from './build-postgres-url.js';
import { openTenantDbCredential, sealTenantDbPassword } from './tenant-db-credentials.js';
import { AppSecretsKeyMissingError } from '../security/app-secrets.js';

const conn = { dbHost: '127.0.0.1', dbPort: 5433, dbName: 'exir_tenant_acme' };
const PW = 'p'.repeat(40);

describe('tenant DB credentials (sealed, fail closed)', () => {
  const saved = process.env.APP_SECRETS_KEY;
  beforeEach(() => { process.env.APP_SECRETS_KEY = randomBytes(32).toString('hex'); });
  afterEach(() => { if (saved === undefined) delete process.env.APP_SECRETS_KEY; else process.env.APP_SECRETS_KEY = saved; });

  it('seals without leaking the plaintext and round-trips', () => {
    const enc = sealTenantDbPassword(PW, conn.dbName);
    expect(enc.startsWith('enc1:')).toBe(true);
    expect(enc).not.toContain(PW);
    expect(openTenantDbCredential({ dbName: conn.dbName, dbUser: 'exir_t_x', dbPasswordEnc: enc })).toEqual({ user: 'exir_t_x', password: PW });
  });
  it('legacy tenants (no columns) resolve to null', () => {
    expect(openTenantDbCredential({ dbName: conn.dbName, dbUser: null, dbPasswordEnc: null })).toBeNull();
    expect(openTenantDbCredential({ dbName: conn.dbName, dbUser: 'x' })).toBeNull();
  });
  it('refuses to seal without APP_SECRETS_KEY and never falls back to plaintext', () => {
    delete process.env.APP_SECRETS_KEY;
    expect(() => sealTenantDbPassword(PW, conn.dbName)).toThrow(AppSecretsKeyMissingError);
  });
  it('is bound to the database name (a blob copied to another tenant does not open)', () => {
    const enc = sealTenantDbPassword(PW, conn.dbName);
    expect(() => openTenantDbCredential({ dbName: 'exir_tenant_other', dbUser: 'u', dbPasswordEnc: enc })).toThrow();
  });
  it('refuses a non-sealed (plaintext) stored value', () => {
    expect(() => openTenantDbCredential({ dbName: conn.dbName, dbUser: 'u', dbPasswordEnc: PW })).toThrow();
  });
});

describe('buildTenantClusterUrl', () => {
  it('uses the legacy shared account without a credential and the role with one (URL-encoded)', () => {
    process.env.TENANT_DB_ADMIN_USER = 'adm';
    process.env.TENANT_DB_ADMIN_PASSWORD = 'a/b';
    expect(buildTenantClusterUrl('h', 1, 'd')).toBe('postgresql://adm:a%2Fb@h:1/d?schema=public');
    expect(buildTenantClusterUrl('h', 1, 'd', { user: 'exir_t_x', password: 'p+q' })).toBe('postgresql://exir_t_x:p%2Bq@h:1/d?schema=public');
    delete process.env.TENANT_DB_ADMIN_USER;
    delete process.env.TENANT_DB_ADMIN_PASSWORD;
  });
});

describe('TenantPrismaService credential selection', () => {
  const saved = process.env.APP_SECRETS_KEY;
  beforeEach(() => { process.env.APP_SECRETS_KEY = randomBytes(32).toString('hex'); });
  afterEach(() => { if (saved === undefined) delete process.env.APP_SECRETS_KEY; else process.env.APP_SECRETS_KEY = saved; });

  it('uses legacy credentials when the registry has nothing, the role when it does', async () => {
    const s = new TenantPrismaService();
    expect(s.resolveCredential(conn)).toBeNull();
    s.setRegistry([{ dbName: conn.dbName, dbUser: 'exir_t_acme_00000000', dbPasswordEnc: sealTenantDbPassword(PW, conn.dbName) }]);
    expect(s.resolveCredential(conn)).toEqual({ user: 'exir_t_acme_00000000', password: PW });
    expect(s.resolveCredential({ ...conn, dbName: 'exir_tenant_other' })).toBeNull();
    await s.onModuleDestroy();
  });
  it('credentials on the passed row take precedence over the registry', async () => {
    const s = new TenantPrismaService();
    const enc = sealTenantDbPassword(PW, conn.dbName);
    expect(s.resolveCredential({ ...conn, dbUser: 'exir_t_row_00000000', dbPasswordEnc: enc })?.user).toBe('exir_t_row_00000000');
    await s.onModuleDestroy();
  });
  it('caches per credential: same creds -> same client; switching creds -> fresh client', async () => {
    const s = new TenantPrismaService();
    const legacy = s.forTenant(conn);
    expect(s.forTenant(conn)).toBe(legacy);
    s.setRegistry([{ dbName: conn.dbName, dbUser: 'exir_t_acme_00000000', dbPasswordEnc: sealTenantDbPassword(PW, conn.dbName) }]);
    const role1 = s.forTenant(conn);
    expect(role1).not.toBe(legacy);
    expect(s.forTenant(conn)).toBe(role1);
    // rotation: same user, new password
    s.setRegistry([{ dbName: conn.dbName, dbUser: 'exir_t_acme_00000000', dbPasswordEnc: sealTenantDbPassword('q'.repeat(40), conn.dbName) }]);
    const role2 = s.forTenant(conn);
    expect(role2).not.toBe(role1);
    // rollback to legacy
    s.setRegistry([]);
    expect(s.forTenant(conn)).not.toBe(role2);
    await s.onModuleDestroy();
  });
  it('fails closed (no silent fallback to the superuser) when sealed credentials cannot be opened', async () => {
    const s = new TenantPrismaService();
    const enc = sealTenantDbPassword(PW, conn.dbName);
    process.env.APP_SECRETS_KEY = randomBytes(32).toString('hex'); // key rotated/lost
    s.setRegistry([{ dbName: conn.dbName, dbUser: 'exir_t_acme_00000000', dbPasswordEnc: enc }]);
    expect(() => s.forTenant(conn)).toThrow(/credentials are unavailable/);
    try { s.forTenant(conn); } catch (e) { expect(String((e as Error).message)).not.toContain(PW); }
    // other tenants are unaffected
    expect(() => s.forTenant({ ...conn, dbName: 'exir_tenant_ok' })).not.toThrow();
    await s.onModuleDestroy();
  });
});
