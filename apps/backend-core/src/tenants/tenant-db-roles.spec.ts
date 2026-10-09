import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REOWN_STATEMENTS_QUERY, alterRoleSql, assertSafeIdent, assertStrongGeneratedPassword, assertTenantDbName, assertTenantRoleName,
  connectionLimit, createDatabaseSql, createRoleSql, generatePassword, lockDownDatabaseSql, quoteIdent, scramVerifier, setDatabaseOwnerSql, tenantRoleName,
} from './tenant-db-roles.js';

describe('identifier validation', () => {
  it('accepts only the shapes we generate', () => {
    expect(quoteIdent('exir_tenant_acme')).toBe('"exir_tenant_acme"');
    for (const bad of ['', 'a', 'Exir', 'x"; DROP DATABASE exir_control; --', 'a b c', 'a-b-c', 'é_tenant', '1abc', 'a'.repeat(64), "x'y", 'a;b']) {
      expect(() => assertSafeIdent(bad)).toThrow();
      expect(() => quoteIdent(bad)).toThrow();
    }
  });
  it('tenant db names must be exir_tenant_*; role names exir_t_*_hash', () => {
    expect(assertTenantDbName('exir_tenant_my_shop')).toBeTruthy();
    expect(() => assertTenantDbName('exir_control')).toThrow();
    expect(() => assertTenantDbName('postgres')).toThrow();
    expect(() => assertTenantDbName('exir_tenant_x"y')).toThrow();
    expect(() => assertTenantRoleName('postgres')).toThrow();
    expect(() => assertTenantRoleName('exir_t_acme')).toThrow(); // no hash suffix
  });
});

describe('tenantRoleName', () => {
  it('is deterministic, <= 63 chars and safe', () => {
    const r = tenantRoleName('my-shop');
    expect(r).toMatch(/^exir_t_my_shop_[0-9a-f]{8}$/);
    expect(tenantRoleName('my-shop')).toBe(r);
    const long = tenantRoleName('a'.repeat(63));
    expect(long.length).toBeLessThanOrEqual(63);
    expect(() => assertTenantRoleName(long)).not.toThrow();
  });
  it('slugs that collide after sanitising still get distinct names (hash of the original slug)', () => {
    expect(tenantRoleName('a-b')).not.toBe(tenantRoleName('a_b'.replace('_', '-') + 'x'));
    expect(tenantRoleName('ab-c')).not.toBe(tenantRoleName('ab--c'));
  });
  it('rejects hostile slugs', () => {
    for (const bad of ['', 'A', 'a;b', 'a"b', "a'b", '-abc', 'a b', 'x'.repeat(64)]) expect(() => tenantRoleName(bad)).toThrow();
  });
});

describe('password + SCRAM verifier', () => {
  it('generates >= 32 url-safe chars, unique', () => {
    const a = generatePassword();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generatePassword()).not.toBe(a);
    expect(() => assertStrongGeneratedPassword(a)).not.toThrow();
    expect(() => assertStrongGeneratedPassword("short'; --")).toThrow();
  });
  it('produces a Postgres SCRAM-SHA-256 verifier that does not contain the password', () => {
    const pw = generatePassword();
    const v = scramVerifier(pw, Buffer.alloc(16, 7));
    expect(v).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(v).not.toContain(pw);
    expect(scramVerifier(pw, Buffer.alloc(16, 7))).toBe(v);
  });
});

describe('SQL construction', () => {
  const role = tenantRoleName('acme');
  const v = scramVerifier(generatePassword());
  it('creates a locked-down role', () => {
    const sql = createRoleSql(role, v, 40);
    expect(sql).toContain(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 40 PASSWORD 'SCRAM-SHA-256$`);
    expect(alterRoleSql(role, v, 40)).toMatch(/^ALTER ROLE ".+" LOGIN NOSUPERUSER/);
  });
  it('rejects anything that is not a verifier as the password literal', () => {
    expect(() => createRoleSql(role, "x'; ALTER ROLE postgres SUPERUSER; --")).toThrow();
    expect(() => createRoleSql(role, 'plaintext-password-123456789012')).toThrow();
  });
  it('database statements quote validated names and revoke PUBLIC', () => {
    expect(createDatabaseSql('exir_tenant_acme', role)).toBe(`CREATE DATABASE "exir_tenant_acme" ENCODING 'UTF8' OWNER "${role}"`);
    expect(lockDownDatabaseSql('exir_tenant_acme', role)).toEqual([
      'REVOKE ALL ON DATABASE "exir_tenant_acme" FROM PUBLIC',
      `GRANT CONNECT, TEMPORARY ON DATABASE "exir_tenant_acme" TO "${role}"`,
    ]);
    expect(setDatabaseOwnerSql('exir_tenant_acme', 'postgres')).toBe('ALTER DATABASE "exir_tenant_acme" OWNER TO "postgres"');
    expect(() => createDatabaseSql('exir_tenant_a"; DROP DATABASE x; --', role)).toThrow();
    expect(() => createDatabaseSql('exir_control', role)).toThrow();
    expect(() => lockDownDatabaseSql('exir_tenant_acme', 'postgres')).toThrow();
  });
  describe('connection limit', () => {
    const saved = process.env.TENANT_DB_ROLE_CONN_LIMIT;
    afterEach(() => { if (saved === undefined) delete process.env.TENANT_DB_ROLE_CONN_LIMIT; else process.env.TENANT_DB_ROLE_CONN_LIMIT = saved; });
    it('is sane by default and ignores junk', () => {
      delete process.env.TENANT_DB_ROLE_CONN_LIMIT;
      expect(connectionLimit()).toBe(40);
      process.env.TENANT_DB_ROLE_CONN_LIMIT = '1; DROP';
      expect(connectionLimit()).toBe(40);
      process.env.TENANT_DB_ROLE_CONN_LIMIT = '100';
      expect(connectionLimit()).toBe(100);
    });
  });
});

describe('scripts/sql/tenant-reown.sql stays in sync with REOWN_STATEMENTS_QUERY', () => {
  it('contains the same query with $1 -> :\'owner\'', () => {
    const file = readFileSync(join(__dirname, '../../../../scripts/sql/tenant-reown.sql'), 'utf8');
    expect(file).toContain(REOWN_STATEMENTS_QUERY.trim().split('$1::text').join(`:'owner'::text`));
  });
});
