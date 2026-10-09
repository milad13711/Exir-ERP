/**
 * Staged rollout tooling for per-tenant Postgres roles (finding S-14). Runs on the server inside the
 * backend container (needs CONTROL_DATABASE_URL, TENANT_DB_ADMIN_USER/PASSWORD, APP_SECRETS_KEY, pg_dump):
 *
 *   node dist/scripts/tenant-db-roles.js plan [--tenant <slug>]
 *   node dist/scripts/tenant-db-roles.js harden-cluster [--include-maintenance] [--yes]
 *   node dist/scripts/tenant-db-roles.js apply    --tenant <slug> --yes [--no-dump] [--dump-dir DIR]
 *   node dist/scripts/tenant-db-roles.js verify   [--tenant <slug>]
 *   node dist/scripts/tenant-db-roles.js rotate   --tenant <slug> --yes
 *   node dist/scripts/tenant-db-roles.js rollback --tenant <slug> --yes
 *
 * Everything that mutates needs --yes; without it nothing changes. No password is ever printed or logged.
 * Details/runbook: docs/security/tenant-db-isolation.md
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { PrismaClient } from '../../generated/control-client/index.js';
import { isAppSecretsKeyConfigured } from '../security/app-secrets.js';
import { openTenantDbCredential, sealTenantDbPassword } from '../prisma/tenant-db-credentials.js';
import {
  REOWN_STATEMENTS_QUERY, adminClientConfig, alterRoleSql, assertSafeIdent, assertStrongGeneratedPassword, assertTenantDbName,
  dropTenantRole, ensureRole, generatePassword, lockDownDatabaseSql, quoteIdent, reownTenantDatabase, roleExists, scramVerifier,
  tenantRoleName, verifyTenantRole, withClient, type CheckResult, type ClusterTarget,
} from '../tenants/tenant-db-roles.js';

type TenantRow = { id: string; slug: string; dbHost: string; dbPort: number; dbName: string; dbUser: string | null; dbPasswordEnc: string | null };

const out = (s = '') => console.log(s);
const fail = (s: string): never => { throw new Error(s); };
// First line only: Prisma errors embed a source/query excerpt that must never reach the console (it could carry sealed values).
const errTag = (e: unknown) => {
  const c = (e as { code?: string })?.code;
  const first = String((e as Error)?.message ?? e).trim().split('\n').find((l) => l.trim() && !l.includes('Invalid `')) ?? '';
  return `${(e as Error)?.constructor?.name ?? 'Error'}${c ? ` [${c}]` : ''}: ${first.replace(/(password|PGPASSWORD)\S*/gi, '$1=***').slice(0, 160)}`;
};

function parseArgs(argv: string[]) {
  const [cmd, ...rest] = argv;
  const flags = new Set<string>();
  const kv: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) fail(`unexpected argument: ${a}`);
    const name = a.slice(2);
    if (['tenant', 'dump-dir'].includes(name)) { kv[name] = rest[++i] ?? fail(`--${name} needs a value`); } else flags.add(name);
  }
  return { cmd, flags, kv };
}

const target = (t: TenantRow): ClusterTarget => ({ host: t.dbHost, port: t.dbPort });

function controlDbInfo() {
  const url = new URL(process.env.CONTROL_DATABASE_URL ?? fail('CONTROL_DATABASE_URL is not set'));
  return { name: decodeURIComponent(url.pathname.slice(1)), target: { host: url.hostname, port: Number(url.port || 5432) } as ClusterTarget };
}

async function dbFacts(t: ClusterTarget, db: string) {
  return withClient(adminClientConfig(t, 'postgres'), async (c) => {
    const r = await c.query(
      `SELECT pg_get_userbyid(datdba) AS owner,
              has_database_privilege('public', datname, 'CONNECT') AS pub_connect,
              has_database_privilege('public', datname, 'TEMPORARY') AS pub_temp
         FROM pg_database WHERE datname = $1`, [db]);
    return r.rows[0] as { owner: string; pub_connect: boolean; pub_temp: boolean } | undefined;
  });
}

async function forbiddenFor(db: ReturnType<typeof makeDb>, me: TenantRow): Promise<string[]> {
  const ctl = controlDbInfo();
  const others = (await db.tenant.findMany({ select: { dbName: true, dbHost: true, dbPort: true } }))
    .filter((t) => t.dbName !== me.dbName && t.dbHost === me.dbHost && t.dbPort === me.dbPort)
    .map((t) => t.dbName)
    .slice(0, 25);
  const list = [...others];
  if (ctl.target.port === me.dbPort) list.unshift(ctl.name);
  return list;
}

const makeDb = () => new PrismaClient({ datasources: { db: { url: process.env.CONTROL_DATABASE_URL } } });

async function pickTenants(db: ReturnType<typeof makeDb>, slug?: string): Promise<TenantRow[]> {
  const rows = await db.tenant.findMany({
    where: slug ? { slug } : {},
    select: { id: true, slug: true, dbHost: true, dbPort: true, dbName: true, dbUser: true, dbPasswordEnc: true },
    orderBy: { createdAt: 'asc' },
  });
  if (slug && rows.length === 0) fail(`no tenant with slug "${slug}"`);
  return rows;
}

function printChecks(checks: CheckResult[]) {
  for (const c of checks) out(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
}

// ── plan ─────────────────────────────────────────────────────────────────────

async function cmdPlan(db: ReturnType<typeof makeDb>, slug?: string) {
  out(`APP_SECRETS_KEY configured: ${isAppSecretsKeyConfigured() ? 'yes' : 'NO (apply/rotate will refuse)'}`);
  out(`admin account: ${process.env.TENANT_DB_ADMIN_USER ?? 'postgres'} (must be a superuser)`);
  for (const t of await pickTenants(db, slug)) {
    out(`\n[${t.slug}] db=${t.dbName} @ ${t.dbHost}:${t.dbPort}`);
    if (t.dbUser) { out(`  already on role ${t.dbUser} - nothing to apply (use verify / rotate)`); continue; }
    const role = tenantRoleName(t.slug);
    try {
      const f = await dbFacts(target(t), t.dbName);
      if (!f) { out('  SKIP: database does not exist on that cluster'); continue; }
      const todo = await withClient(adminClientConfig(target(t), t.dbName), async (c) => (await c.query(REOWN_STATEMENTS_QUERY, [role])).rowCount ?? 0);
      const exists = await withClient(adminClientConfig(target(t), 'postgres'), (c) => roleExists(c, role));
      out(`  would: ${exists ? 'reset password of existing' : 'CREATE'} role ${role} (LOGIN, no super/createdb/createrole/replication)`);
      out(`  would: pg_dump safety copy, REVOKE ALL ON DATABASE FROM PUBLIC, GRANT CONNECT TO role`);
      out(`  would: ALTER OWNER of ${todo} object(s) + database (currently owned by ${f.owner}; PUBLIC CONNECT=${f.pub_connect})`);
      out(`  would: verify as the role (read/write, cannot reach other DBs / create roles), then store sealed password and flip the control row`);
    } catch (e) { out(`  ERROR while inspecting: ${errTag(e)}`); }
  }
  out('\nDry run: nothing was changed.');
}

// ── harden-cluster ───────────────────────────────────────────────────────────

async function cmdHarden(db: ReturnType<typeof makeDb>, flags: Set<string>) {
  const ctl = controlDbInfo();
  const jobs = new Map<string, { t: ClusterTarget; dbs: Set<string> }>();
  const add = (t: ClusterTarget, name: string) => {
    const k = `${t.host}:${t.port}`;
    if (!jobs.has(k)) jobs.set(k, { t, dbs: new Set() });
    jobs.get(k)!.dbs.add(name);
  };
  add(ctl.target, ctl.name);
  for (const t of await pickTenants(db)) add(target(t), t.dbName);
  if (flags.has('include-maintenance')) for (const j of jobs.values()) { j.dbs.add('postgres'); j.dbs.add('template1'); }
  const yes = flags.has('yes');
  for (const [k, j] of jobs) {
    out(`cluster ${k}`);
    await withClient(adminClientConfig(j.t, 'postgres'), async (c) => {
      for (const name of j.dbs) {
        assertSafeIdent(name, 'database');
        const f = await c.query(`SELECT has_database_privilege('public', datname, 'CONNECT') AS pc FROM pg_database WHERE datname = $1`, [name]);
        if (!f.rows[0]) { out(`  ${name}: missing, skipped`); continue; }
        if (!f.rows[0].pc) { out(`  ${name}: PUBLIC already has no CONNECT`); continue; }
        const sql = `REVOKE ALL ON DATABASE ${quoteIdent(name)} FROM PUBLIC`;
        out(`  ${yes ? 'RUN ' : 'would run'}: ${sql}`);
        if (yes) await c.query(sql);
      }
    });
  }
  out(yes ? 'Done.' : 'Dry run: nothing was changed (pass --yes).');
}

// ── apply ────────────────────────────────────────────────────────────────────

async function safetyDump(t: TenantRow, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const file = join(dir, `${t.dbName}-pre-roles-${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz`);
  const env = { ...process.env } as NodeJS.ProcessEnv;
  if (process.env.TENANT_DB_ADMIN_PASSWORD) env.PGPASSWORD = process.env.TENANT_DB_ADMIN_PASSWORD;
  const child = spawn('pg_dump', ['--no-owner', '--no-privileges', '-h', t.dbHost, '-p', String(t.dbPort),
    '-U', process.env.TENANT_DB_ADMIN_USER ?? 'postgres', '-d', t.dbName], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise<void>((res, rej) => {
    child.on('error', rej);
    child.on('close', (code) => (code === 0 ? res() : rej(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 200)}`))));
  });
  await Promise.all([pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(file, { mode: 0o600 })), exited]);
  return file;
}

async function cmdApply(db: ReturnType<typeof makeDb>, slug: string, flags: Set<string>, dumpDir: string) {
  if (!flags.has('yes')) fail('apply changes the database cluster: pass --yes (use `plan` for a dry run)');
  if (!isAppSecretsKeyConfigured()) fail('APP_SECRETS_KEY is not configured: refusing (the password could not be stored encrypted)');
  const [t] = await pickTenants(db, slug);
  assertTenantDbName(t.dbName);
  const adminUser = assertSafeIdent(process.env.TENANT_DB_ADMIN_USER ?? 'postgres', 'admin user (needed for a guaranteed rollback)');
  const role = tenantRoleName(t.slug);
  const tgt = target(t);

  if (t.dbUser) {
    if (t.dbUser !== role) fail(`tenant already uses role ${t.dbUser}, expected ${role}; investigate manually`);
    const checks = await verifyExisting(db, t);
    if (checks.every((c) => c.ok)) { out(`[${t.slug}] already applied and healthy - nothing to do`); return; }
    printChecks(checks);
    fail(`[${t.slug}] role is configured but verification fails; fix it (rotate / re-run reown) or use rollback`);
  }

  const facts = await dbFacts(tgt, t.dbName) ?? fail('database does not exist on that cluster');
  const forbidden = await forbiddenFor(db, t);
  // Preconditions: other databases must already be closed to PUBLIC, otherwise the isolation test cannot pass.
  const open: string[] = [];
  for (const d of forbidden) { const f = await dbFacts(tgt, d); if (f?.pub_connect) open.push(d); }
  if (open.length) fail(`PUBLIC can still CONNECT to ${open.length} other database(s) (${open.slice(0, 5).join(', ')}${open.length > 5 ? ', ...' : ''}); run \`harden-cluster --yes\` first`);

  if (!flags.has('no-dump')) {
    out(`[${t.slug}] taking pg_dump safety copy ...`);
    const f = await safetyDump(t, dumpDir);
    out(`[${t.slug}] safety copy: ${f}  (UNENCRYPTED - move it off the server or delete it once the rollout is verified)`);
  }

  const password = generatePassword();
  const undo: Array<{ name: string; run: () => Promise<void> }> = [];
  try {
    const created = await withClient(adminClientConfig(tgt, 'postgres'), (c) => ensureRole(c, role, password));
    out(`[${t.slug}] role ${role} ${created ? 'created' : 'existed - password reset'}`);
    if (created) undo.push({ name: 'drop role', run: () => dropTenantRole(tgt, role) });

    await withClient(adminClientConfig(tgt, 'postgres'), async (c) => { for (const s of lockDownDatabaseSql(t.dbName, role)) await c.query(s); });
    undo.push({
      name: 'restore PUBLIC grants on the database',
      run: () => withClient(adminClientConfig(tgt, 'postgres'), async (c) => {
        const d = quoteIdent(t.dbName);
        if (facts.pub_connect) await c.query(`GRANT CONNECT ON DATABASE ${d} TO PUBLIC`);
        if (facts.pub_temp) await c.query(`GRANT TEMPORARY ON DATABASE ${d} TO PUBLIC`);
      }),
    });

    // Registered BEFORE the change: a partial failure must also be able to hand ownership back.
    undo.push({ name: `hand ownership back to ${adminUser}`, run: async () => { await reownTenantDatabase(tgt, t.dbName, adminUser); } });
    const r = await reownTenantDatabase(tgt, t.dbName, role);
    out(`[${t.slug}] ownership transferred (${r.changed} object(s) + database)`);

    const checks = await verifyTenantRole({ target: tgt, dbName: t.dbName, role, password, forbiddenDatabases: forbidden });
    printChecks(checks);
    if (!checks.every((c) => c.ok)) fail('verification as the new role failed');

    await db.tenant.update({ where: { id: t.id }, data: { dbUser: role, dbPasswordEnc: sealTenantDbPassword(password, t.dbName) } });
    out(`[${t.slug}] control-plane row flipped: new connections use role ${role} (running app picks it up within ~15 s)`);
  } catch (e) {
    out(`[${t.slug}] FAILED: ${errTag(e)} - rolling back`);
    // Ownership must go back BEFORE the role can be dropped; reverse order guarantees that.
    for (const u of [...undo].reverse()) {
      try { await u.run(); out(`  rollback ok: ${u.name}`); } catch (e2) { out(`  ROLLBACK STEP FAILED (${u.name}): ${errTag(e2)} - fix manually`); }
    }
    await db.tenant.update({ where: { id: t.id }, data: { dbUser: null, dbPasswordEnc: null } }).catch(() => undefined);
    out(`[${t.slug}] tenant remains on the legacy credentials`);
    process.exitCode = 1;
  }
}

// ── verify / rotate / rollback ───────────────────────────────────────────────

async function verifyExisting(db: ReturnType<typeof makeDb>, t: TenantRow): Promise<CheckResult[]> {
  let cred;
  try { cred = openTenantDbCredential(t); } catch { return [{ name: 'sealed password can be decrypted with APP_SECRETS_KEY', ok: false }]; }
  if (!cred) return [];
  return verifyTenantRole({ target: target(t), dbName: t.dbName, role: cred.user, password: cred.password, forbiddenDatabases: await forbiddenFor(db, t) });
}

async function cmdVerify(db: ReturnType<typeof makeDb>, slug?: string) {
  let bad = 0, legacy = 0, ok = 0;
  for (const t of await pickTenants(db, slug)) {
    if (!t.dbUser) { legacy++; out(`[${t.slug}] LEGACY (shared admin credentials)`); continue; }
    try {
      const checks = await verifyExisting(db, t);
      const good = checks.every((c) => c.ok);
      out(`[${t.slug}] role ${t.dbUser}: ${good ? 'OK' : 'FAILED'}`);
      if (!good) printChecks(checks.filter((c) => !c.ok));
      good ? ok++ : bad++;
    } catch (e) { bad++; out(`[${t.slug}] role ${t.dbUser}: ERROR ${errTag(e)}`); }
  }
  out(`\nsummary: ${ok} isolated OK, ${bad} FAILED, ${legacy} legacy`);
  if (bad) process.exitCode = 1;
}

async function cmdRotate(db: ReturnType<typeof makeDb>, slug: string, flags: Set<string>) {
  if (!flags.has('yes')) fail('rotate changes the role password: pass --yes');
  if (!isAppSecretsKeyConfigured()) fail('APP_SECRETS_KEY is not configured');
  const [t] = await pickTenants(db, slug);
  const old = openTenantDbCredential(t) ?? fail(`tenant ${slug} is on legacy credentials (apply first)`);
  const role = tenantRoleName(t.slug);
  if (old.user !== role) fail('stored role name does not match the expected one');
  const next = assertStrongGeneratedPassword(generatePassword());
  const tgt = target(t);
  await withClient(adminClientConfig(tgt, 'postgres'), (c) => c.query(alterRoleSql(role, scramVerifier(next))));
  try {
    const checks = await verifyTenantRole({ target: tgt, dbName: t.dbName, role, password: next, forbiddenDatabases: await forbiddenFor(db, t) });
    if (!checks.every((c) => c.ok)) { printChecks(checks); fail('verification with the new password failed'); }
    await db.tenant.update({ where: { id: t.id }, data: { dbPasswordEnc: sealTenantDbPassword(next, t.dbName) } });
  } catch (e) {
    await withClient(adminClientConfig(tgt, 'postgres'), (c) => c.query(alterRoleSql(role, scramVerifier(old.password)))).catch(() => out('  could not restore the previous password - re-run rotate'));
    fail(`rotate aborted, previous password restored: ${errTag(e)}`);
  }
  out(`[${t.slug}] password rotated. The running app switches to a fresh connection pool within ~15 s (old pool is closed after a 30 s grace period).`);
}

async function cmdRollback(db: ReturnType<typeof makeDb>, slug: string, flags: Set<string>) {
  if (!flags.has('yes')) fail('rollback changes the control plane: pass --yes');
  const [t] = await pickTenants(db, slug);
  await db.tenant.update({ where: { id: t.id }, data: { dbUser: null, dbPasswordEnc: null } });
  out(`[${t.slug}] cleared role credentials: the tenant uses the legacy shared credentials again (within ~15 s). The role and the ownership are left untouched.`);
}

async function main() {
  const { cmd, flags, kv } = parseArgs(process.argv.slice(2));
  const db = makeDb();
  try {
    switch (cmd) {
      case 'plan': await cmdPlan(db, kv.tenant); break;
      case 'harden-cluster': await cmdHarden(db, flags); break;
      case 'apply': await cmdApply(db, kv.tenant ?? fail('--tenant <slug> is required'), flags, kv['dump-dir'] ?? './tenant-db-roles-dumps'); break;
      case 'verify': await cmdVerify(db, kv.tenant); break;
      case 'rotate': await cmdRotate(db, kv.tenant ?? fail('--tenant <slug> is required'), flags); break;
      case 'rollback': await cmdRollback(db, kv.tenant ?? fail('--tenant <slug> is required'), flags); break;
      default: fail('usage: tenant-db-roles <plan|harden-cluster|apply|verify|rotate|rollback> [--tenant slug] [--yes] [--no-dump] [--dump-dir DIR] [--include-maintenance]');
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(errTag(e)); process.exit(1); });
