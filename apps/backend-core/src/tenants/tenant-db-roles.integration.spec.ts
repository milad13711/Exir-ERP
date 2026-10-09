import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantDbAdminService } from './tenant-db-admin.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { sealTenantDbPassword } from '../prisma/tenant-db-credentials.js';
import {
  adminClientConfig, assertSafeIdent, ensureRole, generatePassword, lockDownDatabaseSql, reownTenantDatabase, tenantRoleName, verifyTenantRole, withClient,
} from './tenant-db-roles.js';

/**
 * Opt-in (like backup-dr.integration.spec.ts): needs a LOCAL Postgres 16 superuser and creates/drops THROWAWAY databases/roles
 * named exir_tenant_it_* / exir_control_it_* / exir_t_it*. Never point this at production. Example:
 *   TENANT_ROLES_IT=1 TENANT_ROLES_IT_PORT=55433 TENANT_DB_ADMIN_USER=postgres TENANT_DB_ADMIN_PASSWORD=... \
 *     npx vitest run tenant-db-roles.integration
 * Runs the whole tenant migration set (prisma migrate deploy) so it takes a minute or two.
 */
const port = Number(process.env.TENANT_ROLES_IT_PORT ?? 5433);
const host = process.env.TENANT_ROLES_IT_HOST ?? '127.0.0.1';
const enabled = process.env.TENANT_ROLES_IT === '1' && /^(127\.0\.0\.1|localhost)$/.test(host);

describe.skipIf(!enabled)('per-tenant Postgres roles (S-14) against a local cluster', () => {
  const sfx = randomBytes(3).toString('hex');
  const target = { host, port };
  const ctlDb = `exir_control_it_${sfx}`;
  const dbA = `exir_tenant_it_a_${sfx}`;
  const dbB = `exir_tenant_it_b_${sfx}`; // second role tenant
  const dbLegacy = `exir_tenant_it_l_${sfx}`; // legacy tenant: created + migrated by the admin, then converted
  const slugA = `it-a-${sfx}`;
  const slugB = `it-b-${sfx}`;
  const slugL = `it-l-${sfx}`;
  const roleA = tenantRoleName(slugA);
  const roleB = tenantRoleName(slugB);
  const roleL = tenantRoleName(slugL);
  const pwA = generatePassword();
  const pwB = generatePassword();
  const pwL = generatePassword();
  const admin = new TenantDbAdminService();
  const prevKey = process.env.APP_SECRETS_KEY;
  const adminQ = <T extends pg.QueryResultRow = any>(db: string, sql: string, params?: unknown[]) =>
    withClient(adminClientConfig(target, db), (c) => c.query<T>(sql, params));

  beforeAll(async () => {
    process.env.APP_SECRETS_KEY = randomBytes(32).toString('hex');
    await adminQ('postgres', `CREATE DATABASE ${assertSafeIdent(ctlDb)}`); // stands in for exir_control
    // new-tenant provisioning path
    const { provisionRoleAndDatabase } = await import('./tenant-db-roles.js');
    await provisionRoleAndDatabase(target, dbA, roleA, pwA);
    await provisionRoleAndDatabase(target, dbB, roleB, pwB);
    await admin.applyTenantSchema(host, port, dbA, roleA);
    await admin.applyTenantSchema(host, port, dbB, roleB);
    // legacy tenant: plain admin-owned DB, open to PUBLIC
    await adminQ('postgres', `CREATE DATABASE ${assertSafeIdent(dbLegacy)} ENCODING 'UTF8'`);
    await admin.applyTenantSchema(host, port, dbLegacy);
    await adminQ('postgres', `REVOKE ALL ON DATABASE ${assertSafeIdent(ctlDb)} FROM PUBLIC`);
  }, 600_000);

  afterAll(async () => {
    if (prevKey === undefined) delete process.env.APP_SECRETS_KEY; else process.env.APP_SECRETS_KEY = prevKey;
    if (!enabled) return;
    for (const d of [dbA, dbB, dbLegacy, ctlDb]) {
      await adminQ('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [d]).catch(() => undefined);
      await adminQ('postgres', `DROP DATABASE IF EXISTS ${assertSafeIdent(d)}`).catch(() => undefined);
    }
    for (const r of [roleA, roleB, roleL]) await adminQ('postgres', `DROP ROLE IF EXISTS "${r}"`).catch(() => undefined);
  }, 60_000);

  it('new tenant: migrations ran privileged, everything ends up owned by the tenant role, full verification passes', async () => {
    const checks = await verifyTenantRole({ target, dbName: dbA, role: roleA, password: pwA, forbiddenDatabases: [ctlDb, dbB, dbLegacy, 'postgres'] });
    const failed = checks.filter((c) => !c.ok);
    // Not-yet-hardened databases (a legacy tenant DB, the 'postgres' maintenance DB) are still PUBLIC-connectable:
    // that is exactly why `harden-cluster` is a precondition of `apply`. Everything else must pass.
    expect(failed.map((f) => f.name)).toEqual([`cannot connect to ${dbLegacy}`, 'cannot connect to postgres']);
    const owners = await adminQ<{ owner: string }>(dbA, `SELECT DISTINCT pg_get_userbyid(relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind IN ('r','S','v')`);
    expect(owners.rows.map((r) => r.owner)).toEqual([roleA]);
  }, 120_000);

  it('the app (TenantPrismaService) reads and writes through the tenant role, not the superuser', async () => {
    const svc = new TenantPrismaService();
    svc.setRegistry([{ dbName: dbA, dbUser: roleA, dbPasswordEnc: sealTenantDbPassword(pwA, dbA) }]);
    const db = svc.forTenant({ dbHost: host, dbPort: port, dbName: dbA });
    try {
      const who = await db.$queryRawUnsafe<Array<{ u: string }>>('SELECT current_user AS u');
      expect(who[0].u).toBe(roleA);
      const role = await db.role.create({ data: { name: `it-role-${sfx}` } });
      expect(await db.role.count({ where: { id: role.id } })).toBe(1);
      await db.role.delete({ where: { id: role.id } });
      // gen-random-uuid / pgcrypto-backed defaults and sequences work as the role
      await db.$executeRawUnsafe(`SELECT count(*) FROM information_schema.tables`);
    } finally {
      await svc.onModuleDestroy();
    }
  });

  it('the role cannot connect to another tenant DB, the control DB, or create roles/databases', async () => {
    const cfg = (database: string): pg.ClientConfig => ({ host, port, user: roleA, password: pwA, database });
    for (const other of [dbB, ctlDb]) {
      await expect(withClient(cfg(other), async () => undefined)).rejects.toMatchObject({ code: '42501' });
    }
    await expect(withClient(cfg(dbA), (c) => c.query('CREATE ROLE exir_t_it_nope'))).rejects.toMatchObject({ code: '42501' });
    await expect(withClient(cfg(dbA), (c) => c.query('CREATE DATABASE exir_tenant_it_nope'))).rejects.toMatchObject({ code: '42501' });
    await expect(withClient(cfg(dbA), (c) => c.query('ALTER ROLE ' + roleB + ' SUPERUSER'))).rejects.toMatchObject({ code: '42501' });
    // wrong password is an auth failure, never confused with the privilege check
    await expect(withClient({ ...cfg(dbA), password: 'wrong' }, async () => undefined)).rejects.toMatchObject({ code: '28P01' });
  });

  it('roles cannot read each other even if one is pointed at the other tenant DB name', async () => {
    const svc = new TenantPrismaService();
    svc.setRegistry([{ dbName: dbB, dbUser: roleA, dbPasswordEnc: sealTenantDbPassword(pwA, dbB) }]); // wrong role for B
    const db = svc.forTenant({ dbHost: host, dbPort: port, dbName: dbB });
    try {
      await expect(db.role.count()).rejects.toThrow();
    } finally {
      await svc.onModuleDestroy();
    }
  });

  it('existing tenant rollout: convert a legacy admin-owned DB (ensureRole + lock-down + reown), then objects work as the role', async () => {
    const before = await adminQ<{ owner: string }>(dbLegacy, `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = 'roles'`);
    expect(before.rows[0].owner).not.toBe(roleL);
    await withClient(adminClientConfig(target, 'postgres'), async (c) => {
      expect(await ensureRole(c, roleL, pwL)).toBe(true);
      for (const s of lockDownDatabaseSql(dbLegacy, roleL)) await c.query(s);
    });
    const r = await reownTenantDatabase(target, dbLegacy, roleL);
    expect(r.changed).toBeGreaterThan(50);
    expect((await reownTenantDatabase(target, dbLegacy, roleL)).changed).toBe(0); // idempotent
    const checks = await verifyTenantRole({ target, dbName: dbLegacy, role: roleL, password: pwL, forbiddenDatabases: [ctlDb, dbA, dbB] });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  }, 120_000);

  it('a later privileged migration/restore (admin-owned new objects) is picked up by the re-own step', async () => {
    await adminQ(dbA, `CREATE TABLE late_added (id serial PRIMARY KEY, v text)`);
    const asRole = (sql: string) => withClient({ host, port, user: roleA, password: pwA, database: dbA }, (c) => c.query(sql));
    await expect(asRole('SELECT * FROM late_added')).rejects.toMatchObject({ code: '42501' }); // proves the failure mode exists
    await admin.applyTenantSchema(host, port, dbA, roleA); // = what migrate-all-tenants does on every boot
    await asRole(`INSERT INTO late_added (v) VALUES ('x')`);
    expect((await asRole('SELECT v FROM late_added')).rows[0].v).toBe('x');
    await asRole('DROP TABLE late_added');
  }, 120_000);

  it('rollback of an apply: ownership can be handed back to the admin and the role dropped', async () => {
    const db = `exir_tenant_it_r_${sfx}`;
    const role = tenantRoleName(`it-r-${sfx}`);
    try {
      await adminQ('postgres', `CREATE DATABASE ${assertSafeIdent(db)}`);
      await adminQ(db, `CREATE TABLE t (id int); CREATE SEQUENCE s`);
      await withClient(adminClientConfig(target, 'postgres'), (c) => ensureRole(c, role, generatePassword()));
      await reownTenantDatabase(target, db, role);
      await reownTenantDatabase(target, db, process.env.TENANT_DB_ADMIN_USER ?? 'postgres');
      const { dropTenantRole } = await import('./tenant-db-roles.js');
      await dropTenantRole(target, role);
      expect((await adminQ('postgres', `SELECT 1 FROM pg_roles WHERE rolname=$1`, [role])).rowCount).toBe(0);
      expect((await adminQ(db, `SELECT 1 FROM t`)).rowCount).toBe(0);
    } finally {
      await adminQ('postgres', `DROP DATABASE IF EXISTS ${db}`).catch(() => undefined);
      await adminQ('postgres', `DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
    }
  });

  it('pg_dump --no-owner (as the admin) + psql restore leaves objects admin-owned until re-owned; role works afterwards', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    const env = { ...process.env, PGPASSWORD: process.env.TENANT_DB_ADMIN_PASSWORD ?? '' };
    const user = process.env.TENANT_DB_ADMIN_USER ?? 'postgres';
    const common = ['-h', host, '-p', String(port), '-U', user];
    const copy = `exir_tenant_it_c_${sfx}`;
    try {
      const { stdout } = await run('pg_dump', [...common, '--no-owner', '--no-privileges', '-d', dbA], { env, maxBuffer: 64 * 1024 * 1024 });
      await adminQ('postgres', `CREATE DATABASE ${assertSafeIdent(copy)} OWNER "${roleA}"`);
      const psql = run('psql', [...common, '-X', '-q', '-d', copy, '-v', 'ON_ERROR_STOP=1', '--single-transaction'], { env, maxBuffer: 64 * 1024 * 1024 });
      psql.child.stdin!.end(stdout.replace(/^SET transaction_timeout = .*$/m, ''));
      await psql;
      const asRole = (sql: string) => withClient({ host, port, user: roleA, password: pwA, database: copy }, (c) => c.query(sql));
      await expect(asRole('SELECT count(*) FROM roles')).rejects.toMatchObject({ code: '42501' }); // restored objects belong to the admin
      // the documented post-restore step (scripts/sql/tenant-reown.sql does the same in psql)
      await reownTenantDatabase(target, copy, roleA);
      await asRole('SELECT count(*) FROM roles');
    } finally {
      await adminQ('postgres', `DROP DATABASE IF EXISTS ${copy}`).catch(() => undefined);
    }
  }, 180_000);

  it('scripts/sql/tenant-reown.sql (psql) performs the same re-own as the TS helper', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { join } = await import('node:path');
    const env = { ...process.env, PGPASSWORD: process.env.TENANT_DB_ADMIN_PASSWORD ?? '' };
    await adminQ(dbB, `CREATE TABLE sql_file_probe (id int)`);
    await promisify(execFile)('psql', ['-h', host, '-p', String(port), '-U', process.env.TENANT_DB_ADMIN_USER ?? 'postgres', '-X', '-q', '-d', dbB, '-v', `owner=${roleB}`, '-f', join(process.cwd(), '../../scripts/sql/tenant-reown.sql')], { env });
    const o = await adminQ<{ o: string }>(dbB, `SELECT pg_get_userbyid(relowner) AS o FROM pg_class WHERE relname='sql_file_probe'`);
    expect(o.rows[0].o).toBe(roleB);
  }, 60_000);
});
