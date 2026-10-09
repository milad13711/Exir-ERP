/**
 * Least-privilege Postgres roles for tenant databases (finding S-14).
 *
 * Pure helpers (identifier validation, role naming, password generation, SCRAM verifier, SQL builders)
 * plus thin pg-based operations used by TenantDbAdminService (new tenants) and
 * src/scripts/tenant-db-roles.ts (existing tenants). See docs/security/tenant-db-isolation.md.
 *
 * SQL safety rules: identifiers are validated against a strict allow-list shape AND quoted;
 * literals are produced only for values we generated ourselves and re-validated; nothing else is
 * ever interpolated. Passwords are sent to the server as a pre-computed SCRAM-SHA-256 verifier, so
 * the clear password never appears in statements, server logs (log_statement) or pg_stat_activity.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import pg from 'pg';

// ── identifiers ──────────────────────────────────────────────────────────────

export const ROLE_PREFIX = 'exir_t_';
const IDENT_RE = /^[a-z][a-z0-9_]{2,62}$/;
const ROLE_RE = /^exir_t_[a-z0-9_]{1,40}_[0-9a-f]{8}$/;
const DB_RE = /^exir_tenant_[a-z0-9_]{1,50}$/;

export function assertSafeIdent(name: string, what = 'identifier'): string {
  if (typeof name !== 'string' || !IDENT_RE.test(name)) throw new Error(`unsafe ${what}`);
  return name;
}
export function assertTenantRoleName(name: string): string {
  if (typeof name !== 'string' || !ROLE_RE.test(name) || name.length > 63) throw new Error('unsafe role name');
  return name;
}
export function assertTenantDbName(name: string): string {
  if (typeof name !== 'string' || !DB_RE.test(name) || name.length > 63) throw new Error('unsafe tenant database name');
  return name;
}

/** Double-quote an already validated identifier (defence in depth: validate first, quote always). */
export function quoteIdent(name: string): string {
  assertSafeIdent(name);
  return `"${name}"`;
}

/** Deterministic role name from the tenant slug: exir_t_<sanitised slug, max 40>_<8 hex of sha256(slug)> (<= 63 chars). */
export function tenantRoleName(slug: string): string {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw new Error('unsafe tenant slug');
  const safe = slug.replace(/-/g, '_').slice(0, 40).replace(/^_+/, '') || 'x';
  const hash = createHash('sha256').update(slug).digest('hex').slice(0, 8);
  return assertTenantRoleName(`${ROLE_PREFIX}${safe}_${hash}`);
}

// ── password / verifier ──────────────────────────────────────────────────────

/** 48 random bytes -> 64 URL-safe chars (~384 bits). Safe inside a connection URL without escaping. */
export function generatePassword(): string {
  return randomBytes(48).toString('base64url');
}

const PASSWORD_RE = /^[A-Za-z0-9_-]{32,128}$/;
export function assertStrongGeneratedPassword(pw: string): string {
  if (!PASSWORD_RE.test(pw)) throw new Error('password has an unexpected shape');
  return pw;
}

/** PostgreSQL SCRAM-SHA-256 verifier ("SCRAM-SHA-256$<iter>:<salt>$<StoredKey>:<ServerKey>"), computed client-side. */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
const VERIFIER_RE = /^SCRAM-SHA-256\$\d{1,6}:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

function verifierLiteral(verifier: string): string {
  if (!VERIFIER_RE.test(verifier)) throw new Error('unexpected verifier shape');
  return `'${verifier}'`; // alphabet validated above: no quote/backslash possible
}

// ── SQL builders (server-side statements; no secrets besides the pre-hashed verifier) ──

export function connectionLimit(): number {
  const n = Number(process.env.TENANT_DB_ROLE_CONN_LIMIT ?? 40);
  return Number.isInteger(n) && n >= 5 && n <= 500 ? n : 40;
}

export const roleAttributes = (limit: number) =>
  `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT ${Math.trunc(limit)}`;

export function createRoleSql(role: string, verifier: string, limit = connectionLimit()): string {
  return `CREATE ROLE ${quoteIdent(assertTenantRoleName(role))} ${roleAttributes(limit)} PASSWORD ${verifierLiteral(verifier)}`;
}
export function alterRoleSql(role: string, verifier: string, limit = connectionLimit()): string {
  return `ALTER ROLE ${quoteIdent(assertTenantRoleName(role))} ${roleAttributes(limit)} PASSWORD ${verifierLiteral(verifier)}`;
}
export function createDatabaseSql(db: string, role: string): string {
  return `CREATE DATABASE ${quoteIdent(assertTenantDbName(db))} ENCODING 'UTF8' OWNER ${quoteIdent(assertTenantRoleName(role))}`;
}
export function lockDownDatabaseSql(db: string, role: string): string[] {
  const d = quoteIdent(assertTenantDbName(db));
  const r = quoteIdent(assertTenantRoleName(role));
  return [`REVOKE ALL ON DATABASE ${d} FROM PUBLIC`, `GRANT CONNECT, TEMPORARY ON DATABASE ${d} TO ${r}`];
}
export const setDatabaseOwnerSql = (db: string, owner: string) =>
  `ALTER DATABASE ${quoteIdent(assertTenantDbName(db))} OWNER TO ${quoteIdent(assertSafeIdent(owner, 'owner'))}`;

/**
 * One statement per object in the CURRENT database that is not yet owned by $1. Run connected to the
 * tenant DB as a superuser. Extension members and sequences linked to a column (which follow their
 * table) are skipped. Identical text is embedded in scripts/sql/tenant-reown.sql for psql (`$1` -> :'owner');
 * a unit test keeps the two in sync.
 */
export const REOWN_STATEMENTS_QUERY = `
SELECT stmt FROM (
  SELECT 1 AS ord, format('ALTER SCHEMA %I OWNER TO %I', n.nspname, $1::text) AS stmt
    FROM pg_namespace n
   WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
     AND pg_get_userbyid(n.nspowner) <> $1::text
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_namespace'::regclass AND d.objid = n.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 2, format('ALTER %s %s OWNER TO %I',
                   CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
                   c.oid::regclass, $1::text)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','p','v','m','S','f')
     AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
     AND pg_get_userbyid(c.relowner) <> $1::text
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND (d.deptype = 'e' OR (c.relkind = 'S' AND d.deptype IN ('a','i'))))
  UNION ALL
  SELECT 3, format('ALTER %s %s OWNER TO %I', CASE t.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, t.oid::regtype, $1::text)
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE t.typtype IN ('e','d') AND t.typcategory <> 'A'
     AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
     AND pg_get_userbyid(t.typowner) <> $1::text
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 4, format('ALTER ROUTINE %s OWNER TO %I', p.oid::regprocedure, $1::text)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
     AND pg_get_userbyid(p.proowner) <> $1::text
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 5, format('ALTER LARGE OBJECT %s OWNER TO %I', m.oid, $1::text)
    FROM pg_largeobject_metadata m WHERE pg_get_userbyid(m.lomowner) <> $1::text
) s ORDER BY ord, stmt`;

// ── pg plumbing ──────────────────────────────────────────────────────────────

export type ClusterTarget = { host: string; port: number };

export function adminClientConfig(t: ClusterTarget, database: string): pg.ClientConfig {
  return {
    host: t.host,
    port: t.port,
    user: process.env.TENANT_DB_ADMIN_USER ?? 'postgres',
    password: process.env.TENANT_DB_ADMIN_PASSWORD || undefined,
    database,
    connectionTimeoutMillis: 10_000,
  };
}

export async function withClient<T>(cfg: pg.ClientConfig, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client(cfg);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => undefined);
  }
}

/**
 * Re-owns every non-extension object of `db` (and the DB itself) to `owner`. Idempotent; one transaction;
 * short lock_timeout. `owner` is normally the tenant role; apply-rollback uses it to hand ownership back.
 */
export async function reownTenantDatabase(t: ClusterTarget, db: string, owner: string): Promise<{ changed: number }> {
  assertTenantDbName(db);
  assertSafeIdent(owner, 'owner');
  const changed = await withClient(adminClientConfig(t, db), async (c) => {
    const { rows } = await c.query<{ stmt: string }>(REOWN_STATEMENTS_QUERY, [owner]);
    await c.query('BEGIN');
    try {
      await c.query(`SET LOCAL lock_timeout = '10s'`);
      for (const r of rows) await c.query(r.stmt);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
    return rows.length;
  });
  await withClient(adminClientConfig(t, 'postgres'), (c) => c.query(setDatabaseOwnerSql(db, owner)));
  return { changed };
}

export async function roleExists(c: pg.Client, role: string): Promise<boolean> {
  const r = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [assertTenantRoleName(role)]);
  return r.rowCount === 1;
}

/** Creates or (re)sets the role. Returns whether it was newly created. */
export async function ensureRole(c: pg.Client, role: string, password: string): Promise<boolean> {
  const verifier = scramVerifier(assertStrongGeneratedPassword(password));
  const existed = await roleExists(c, role);
  await c.query(existed ? alterRoleSql(role, verifier) : createRoleSql(role, verifier));
  return !existed;
}

/** Creates a brand-new tenant database owned by a fresh role, locked down against PUBLIC. */
export async function provisionRoleAndDatabase(t: ClusterTarget, db: string, role: string, password: string): Promise<void> {
  assertTenantDbName(db);
  assertTenantRoleName(role);
  await withClient(adminClientConfig(t, 'postgres'), async (c) => {
    await ensureRole(c, role, password);
    await c.query(createDatabaseSql(db, role));
    for (const s of lockDownDatabaseSql(db, role)) await c.query(s);
  });
}

/** Drops a tenant role together with anything it still owns/has privileges on, in the tenant DB first. Best effort, idempotent. */
export async function dropTenantRole(t: ClusterTarget, role: string, db?: string): Promise<void> {
  assertTenantRoleName(role);
  const r = quoteIdent(role);
  await withClient(adminClientConfig(t, 'postgres'), async (c) => {
    if (!(await roleExists(c, role))) return;
    if (db) await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1', [role]);
    await c.query(`DROP OWNED BY ${r}`); // cluster-level objects (databases) are not dropped by DROP OWNED; only privileges revoked
    await c.query(`DROP ROLE ${r}`);
  });
}

// ── verification ─────────────────────────────────────────────────────────────

export type CheckResult = { name: string; ok: boolean; detail?: string };

function pgCode(e: unknown): string | undefined {
  return (e as { code?: string })?.code;
}

/** Expects `fn` to fail with SQLSTATE 42501 (insufficient_privilege). Any other outcome (including bad auth 28xxx) is a failure. */
async function expectPermissionDenied(name: string, fn: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await fn();
    return { name, ok: false, detail: 'unexpectedly allowed' };
  } catch (e) {
    const code = pgCode(e);
    return code === '42501' ? { name, ok: true } : { name, ok: false, detail: `failed with SQLSTATE ${code ?? 'n/a'} instead of 42501` };
  }
}

export type VerifyInput = {
  target: ClusterTarget;
  dbName: string;
  role: string;
  password: string;
  /** Other databases the role must NOT be able to connect to (exir_control, other tenants, ...). */
  forbiddenDatabases: string[];
};

/** Full least-privilege verification. Secrets are never included in results. */
export async function verifyTenantRole(i: VerifyInput): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const roleCfg = (database: string): pg.ClientConfig => ({
    host: i.target.host, port: i.target.port, user: i.role, password: i.password, database, connectionTimeoutMillis: 10_000,
  });

  // 1) catalog facts (as admin)
  await withClient(adminClientConfig(i.target, i.dbName), async (c) => {
    const attrs = await c.query(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS memberships
         FROM pg_roles r WHERE rolname = $1`, [i.role]);
    const a = attrs.rows[0];
    out.push({ name: 'role attributes (login, no super/createdb/createrole/replication/bypassrls, no memberships)',
      ok: !!a && a.rolcanlogin && !a.rolsuper && !a.rolcreatedb && !a.rolcreaterole && !a.rolreplication && !a.rolbypassrls && a.memberships === 0 });
    const own = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${REOWN_STATEMENTS_QUERY}) x`, [i.role]);
    out.push({ name: 'all objects owned by the tenant role', ok: own.rows[0].n === 0, detail: own.rows[0].n ? `${own.rows[0].n} object(s) not owned` : undefined });
    const dbo = await c.query(`SELECT pg_get_userbyid(datdba) = $2 AS owned, has_database_privilege('public', $1, 'CONNECT') AS pub FROM pg_database WHERE datname = $1`, [i.dbName, i.role]);
    out.push({ name: 'database owned by role, PUBLIC has no CONNECT', ok: !!dbo.rows[0]?.owned && dbo.rows[0].pub === false });
    const priv = await c.query<{ missing: number }>(
      `SELECT count(*)::int AS missing FROM pg_tables t
        WHERE t.schemaname = 'public'
          AND NOT has_table_privilege($1, format('%I.%I', t.schemaname, t.tablename), 'SELECT,INSERT,UPDATE,DELETE')`, [i.role]);
    out.push({ name: 'full DML on every public table', ok: priv.rows[0].missing === 0 });
  });

  // 2) positive path as the role: connect, read, write a canary (rolled back)
  try {
    await withClient(roleCfg(i.dbName), async (c) => {
      await c.query('BEGIN');
      try {
        await c.query('CREATE TABLE _exir_role_canary (id int PRIMARY KEY, v text)');
        await c.query(`INSERT INTO _exir_role_canary VALUES (1, 'ok')`);
        const r = await c.query('SELECT v FROM _exir_role_canary WHERE id = 1');
        if (r.rows[0]?.v !== 'ok') throw new Error('canary mismatch');
      } finally {
        await c.query('ROLLBACK');
      }
      const t = await c.query(`SELECT quote_ident(tablename) AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LIMIT 1`);
      if (t.rows[0]) await c.query(`SELECT count(*) FROM public.${t.rows[0].t}`);
    });
    out.push({ name: 'role can connect, create+write a canary table (rolled back) and read an app table', ok: true });
  } catch (e) {
    out.push({ name: 'role can connect, create+write a canary table (rolled back) and read an app table', ok: false, detail: `SQLSTATE ${pgCode(e) ?? 'n/a'}` });
  }

  // 3) negative path: cannot connect to anything else, cannot create roles/databases
  for (const other of i.forbiddenDatabases) {
    out.push(await expectPermissionDenied(`cannot connect to ${other}`, () => withClient(roleCfg(other), async () => undefined)));
  }
  out.push(await expectPermissionDenied('cannot CREATE ROLE', () => withClient(roleCfg(i.dbName), (c) => c.query('CREATE ROLE exir_t_should_not_exist_00000000'))));
  out.push(await expectPermissionDenied('cannot CREATE DATABASE', () => withClient(roleCfg(i.dbName), (c) => c.query('CREATE DATABASE exir_t_should_not_exist_00000000'))));
  return out;
}
