import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGunzip, gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BackupDrService, CONTROL_TARGET, RESTORE_DB_RE, type BackupTarget } from './backup-dr.service.js';
import { DecryptStream, parseEncryptionKey } from './backup-crypto.js';
import { MULTIPART_THRESHOLD, S3ObjectStore, sanitizeError, withRetry, type ObjectStore } from './backup-offsite.js';
import { readManifest, readStatus } from './backup-state.js';

class MemStore implements ObjectStore {
  description = 'mem';
  objects = new Map<string, { size: number; sha256: string }>();
  puts = 0;
  corruptSize = false;
  failPuts = 0;
  async put(key: string, filePath: string, size: number, sha256: string) {
    this.puts++;
    if (this.failPuts > 0) { this.failPuts--; throw new Error('boom'); }
    this.objects.set(key, { size: this.corruptSize ? size - 1 : size, sha256 });
  }
  async head(key: string) { return this.objects.get(key) ?? null; }
  async list(prefix: string) { return [...this.objects].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.size })); }
  async delete(key: string) { this.objects.delete(key); }
}

class TestService extends BackupDrService {
  dumpSql = 'CREATE TABLE users(id int);\nINSERT INTO users VALUES (1);\n'.repeat(2000);
  dumpFails = false;
  store: MemStore | null = null;
  day = '2026-10-08';
  protected override openDump(_t: BackupTarget) {
    const stream = Readable.from([Buffer.from(this.dumpSql)]);
    const done = this.dumpFails ? Promise.reject(new Error('pg_dump exploded')) : Promise.resolve();
    done.catch(() => {});
    return { stream, done };
  }
  protected override getStore() { return this.store; }
  protected override today() { return this.day; }
  protected override sleepFn = async () => {};
  override offsitePrefix() { return 'exir-test'; }
}

const KEY_HEX = randomBytes(32).toString('hex');
let root: string;
let errorLogs: any[];
let smsSent: string[];

function make(tenants: any[] = []) {
  const controlDb: any = {
    tenant: { findMany: async () => tenants },
    errorLog: { create: async (a: any) => { errorLogs.push(a.data); } },
  };
  const sms: any = { sendSms: async (_p: string, m: string) => { smsSent.push(m); return { success: true }; } };
  return new TestService(controlDb, sms);
}
const ctl: BackupTarget = { name: CONTROL_TARGET, kind: 'control', conn: { dbHost: 'h', dbPort: 5432, dbName: 'exir_control' } };
const ten: BackupTarget = { name: 'acme', kind: 'tenant', conn: { dbHost: 'h', dbPort: 5432, dbName: 'exir_tenant_acme' } };

const SAVED = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'bkdr-'));
  errorLogs = []; smsSent = [];
  process.env.BACKUP_DIR = root;
  process.env.CONTROL_DATABASE_URL = 'postgresql://postgres:pw@localhost:5433/exir_control?schema=public';
  process.env.BACKUP_ENCRYPTION_KEY = KEY_HEX;
  delete process.env.BACKUP_REQUIRE_ENCRYPTION;
  process.env.BACKUP_ALERT_PHONE = '09120000000';
  delete process.env.BACKUP_KEEP_DAILY;
});
afterEach(async () => {
  process.env = { ...SAVED };
  await rm(root, { recursive: true, force: true });
});

async function decryptFile(path: string): Promise<string> {
  const chunks: Buffer[] = [];
  await (pipeline as any)(createReadStream(path), new DecryptStream(parseEncryptionKey(KEY_HEX)), createGunzip(), async (src: AsyncIterable<Buffer>) => { for await (const c of src) chunks.push(c); });
  return Buffer.concat(chunks).toString();
}

describe('BackupDrService.backupTarget', () => {
  it('writes an encrypted, 0600 file in a 0700 dir, with a matching manifest, and no plaintext', async () => {
    const svc = make();
    await svc.backupTarget(ctl);
    const dir = join(root, CONTROL_TARGET);
    const files = (await readdir(dir)).sort();
    expect(files).toEqual(['2026-10-08.sql.gz.enc', 'manifest.json']);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, files[0]))).mode & 0o777).toBe(0o600);
    expect((await decryptFile(join(dir, files[0]))).startsWith('CREATE TABLE users')).toBe(true);
    const m = await readManifest(dir);
    const e = m.entries['2026-10-08.sql.gz.enc'];
    expect(e.encrypted).toBe(true);
    expect((await svc.sha256File(join(dir, files[0]))).sha256).toBe(e.sha256);
    const raw = await readFile(join(dir, files[0]));
    expect(raw.includes(Buffer.from('CREATE TABLE'))).toBe(false);
    expect((await readStatus(root)).targets[CONTROL_TARGET].encrypted).toBe(true);
  });

  it('refuses to store anything when encryption is required but no key is set', async () => {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    process.env.BACKUP_REQUIRE_ENCRYPTION = 'true';
    const svc = make();
    await expect(svc.backupTarget(ctl)).rejects.toThrow(/BACKUP_REQUIRE_ENCRYPTION/);
    expect(await readdir(root).catch(() => [])).not.toContain(CONTROL_TARGET + '/2026-10-08.sql.gz');
    const dirFiles = await readdir(join(root, CONTROL_TARGET)).catch(() => []);
    expect(dirFiles.filter((f) => f.startsWith('2026'))).toEqual([]);
  });

  it('fails closed on a malformed key (does not silently fall back to plaintext)', async () => {
    process.env.BACKUP_ENCRYPTION_KEY = 'not-a-valid-key';
    await expect(make().backupTarget(ctl)).rejects.toThrow(/۳۲ بایت/);
  });

  it('without a key: writes 0600 plaintext, marks unencrypted, alerts, and NEVER uploads off-site', async () => {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    const svc = make();
    svc.store = new MemStore();
    await svc.backupTarget(ten);
    expect(svc.store.puts).toBe(0);
    const f = join(root, 'acme', '2026-10-08.sql.gz');
    expect((await stat(f)).mode & 0o777).toBe(0o600);
    expect((await readStatus(root)).targets.acme.encrypted).toBe(false);
    expect(errorLogs.some((l) => /بدون رمزنگاری/.test(l.message))).toBe(true);
    expect((await svc.getStatus()).warnings.join('\n')).toMatch(/رمزنگاری/);
  });

  it('removes the partial file and records nothing as successful when pg_dump fails', async () => {
    const svc = make();
    svc.dumpFails = true;
    await expect(svc.backupTarget(ctl)).rejects.toThrow(/exploded/);
    const files = await readdir(join(root, CONTROL_TARGET));
    expect(files.filter((f) => f.includes('2026-10-08'))).toEqual([]);
  });

  it('runAll alerts on failure via ErrorLog + SMS, once per day per kind', async () => {
    const svc = make([{ slug: 'acme', dbHost: 'h', dbPort: 5432, dbName: 'exir_tenant_acme' }]);
    svc.dumpFails = true;
    const r1 = await svc.runAll();
    expect(r1.failed).toBe(2);
    const first = errorLogs.length;
    expect(first).toBe(2);
    expect(smsSent.length).toBe(2);
    await svc.runAll();
    expect(errorLogs.length).toBe(first); // deduped
    svc.day = '2026-10-09';
    await svc.runAll();
    expect(errorLogs.length).toBe(first + 2);
    expect(smsSent.join(' ')).not.toMatch(/pw@/);
  });

  it('skips tenants with unsafe slugs', async () => {
    const svc = make([{ slug: '../etc', dbHost: 'h', dbPort: 1, dbName: 'x' }, { slug: 'ok-tenant', dbHost: 'h', dbPort: 1, dbName: 'x' }]);
    const names = (await svc.listTargets()).map((t) => t.name);
    expect(names).toEqual([CONTROL_TARGET, 'ok-tenant']);
  });
});

describe('off-site', () => {
  it('uploads encrypted file with sha256 metadata under the env prefix and records it', async () => {
    const svc = make();
    svc.store = new MemStore();
    await svc.backupTarget(ten);
    expect([...svc.store.objects.keys()]).toEqual(['exir-test/acme/2026-10-08.sql.gz.enc']);
    const m = await readManifest(join(root, 'acme'));
    expect(m.entries['2026-10-08.sql.gz.enc'].offsite?.key).toBe('exir-test/acme/2026-10-08.sql.gz.enc');
    expect((await readStatus(root)).targets.acme.offsite).toBe(true);
  });

  it('retries transient failures, and alerts (without failing the local backup) when verification keeps failing', async () => {
    const svc = make();
    svc.store = new MemStore();
    svc.store.failPuts = 2;
    await svc.backupTarget(ten);
    expect(svc.store.puts).toBe(3);

    const svc2 = make();
    svc2.day = '2026-10-09';
    svc2.store = new MemStore();
    svc2.store.corruptSize = true;
    await svc2.backupTarget(ten); // must not throw
    expect(errorLogs.some((l) => /خارج از سرور/.test(l.message))).toBe(true);
    expect((await readStatus(root)).targets.acme.offsite).toBe(false);
    expect((await readStatus(root)).targets.acme.lastSuccessAt).toBeTruthy();
  });

  it('applies GFS retention remotely but never deletes the newest backups', async () => {
    const svc = make();
    const store = new MemStore();
    svc.store = store;
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.UTC(2026, 8, 1) + i * 86_400_000).toISOString().slice(0, 10);
      store.objects.set(`exir-test/acme/${d}.sql.gz.enc`, { size: 1, sha256: 'x' });
    }
    store.objects.set('exir-test/acme/notes.txt', { size: 1, sha256: 'x' });
    store.objects.set('exir-test/other/2026-01-01.sql.gz.enc', { size: 1, sha256: 'x' });
    const deleted = await svc.pruneRemote(store, 'exir-test/acme/');
    expect(deleted).toBeGreaterThan(10);
    expect(store.objects.has('exir-test/acme/2026-10-10.sql.gz.enc')).toBe(true); // newest
    expect(store.objects.has('exir-test/acme/notes.txt')).toBe(true); // foreign object untouched
    expect(store.objects.has('exir-test/other/2026-01-01.sql.gz.enc')).toBe(true); // other prefix untouched
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(2026, 9, 10) - i * 86_400_000).toISOString().slice(0, 10);
      expect(store.objects.has(`exir-test/acme/${d}.sql.gz.enc`)).toBe(true);
    }
  });

  it('S3ObjectStore uses multipart above the threshold and aborts on failure; errors carry no credentials', async () => {
    const cmds: string[] = [];
    const client: any = { send: async (c: any) => { cmds.push(c.constructor.name); return c.constructor.name === 'CreateMultipartUploadCommand' ? { UploadId: 'u1' } : { ETag: '"e"' }; } };
    const store = new S3ObjectStore(client, 'bkt', 'S3', async () => {});
    const f = join(root, 'big.bin');
    await writeFile(f, Buffer.alloc(MULTIPART_THRESHOLD + 1024));
    await store.put('k', f, MULTIPART_THRESHOLD + 1024, 'abc');
    expect(cmds).toEqual(['CreateMultipartUploadCommand', 'UploadPartCommand', 'UploadPartCommand', 'UploadPartCommand', 'CompleteMultipartUploadCommand']);

    const failing: any = { send: async (c: any) => { cmds.push(c.constructor.name); if (c.constructor.name === 'UploadPartCommand') throw new Error('net down'); return { UploadId: 'u2' }; } };
    cmds.length = 0;
    await expect(new S3ObjectStore(failing, 'bkt', 'S3', async () => {}).put('k', f, MULTIPART_THRESHOLD + 1024, 'abc')).rejects.toThrow();
    expect(cmds).toContain('AbortMultipartUploadCommand');
    expect(sanitizeError(new Error('bad secret=AKIAXXXX failed'))).not.toContain('AKIAXXXX');
    expect(await withRetry(async () => 5, { sleep: async () => {} })).toBe(5);
  });
});

describe('retention, permissions and legacy migration', () => {
  it('prunes local files per GFS (legacy json/sql.gz included), reports freed bytes, keeps the newest', async () => {
    const svc = make();
    const dir = join(root, 'acme');
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2026, 7, 10) + i * 86_400_000).toISOString().slice(0, 10);
      await writeFile(join(dir, `${d}.${i % 3 === 0 ? 'json' : i % 3 === 1 ? 'sql.gz' : 'sql.gz.enc'}`), 'x'.repeat(10));
    }
    await writeFile(join(dir, 'unrelated.txt'), 'keep');
    const manifest = await readManifest(dir);
    const { freedBytes, deleted } = await svc.pruneLocal(dir, manifest);
    expect(freedBytes).toBe(deleted.length * 10);
    const left = await readdir(dir);
    expect(left).toContain('unrelated.txt');
    expect(left.filter((f) => /^\d{4}/.test(f)).length).toBeLessThanOrEqual(17);
    expect(left.some((f) => f.startsWith('2026-10-08'))).toBe(true);
  });

  it('tightens loose permissions on existing dirs/files', async () => {
    const svc = make();
    const dir = join(root, 'old');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2026-01-01.sql.gz'), 'x');
    await chmod(dir, 0o755);
    await chmod(join(dir, '2026-01-01.sql.gz'), 0o644);
    const { fixed } = await svc.enforcePermissions();
    expect(fixed).toBeGreaterThanOrEqual(2);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, '2026-01-01.sql.gz'))).mode & 0o777).toBe(0o600);
  });

  it('encrypts legacy plaintext backups in place and deletes the plaintext only after verification', async () => {
    const svc = make();
    const dir = join(root, 'acme');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2026-10-01.sql.gz'), gzipSync(Buffer.from('SELECT 1;\n')));
    await writeFile(join(dir, '2026-10-02.sql.gz'), Buffer.from('this is not valid gzip')); // must be left alone
    const n = await svc.encryptLegacyBackups();
    expect(n).toBe(1);
    const files = await readdir(dir);
    expect(files).toContain('2026-10-01.sql.gz.enc');
    expect(files).not.toContain('2026-10-01.sql.gz');
    expect(files).toContain('2026-10-02.sql.gz');
    expect(files).not.toContain('2026-10-02.sql.gz.enc');
    expect(await decryptFile(join(dir, '2026-10-01.sql.gz.enc'))).toBe('SELECT 1;\n');
  });

  it('also encrypts legacy plaintext JSON exports (gzip + AES-GCM) and removes the plaintext', async () => {
    const svc = make();
    const dir = join(root, 'acme');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2026-09-26.json'), Buffer.from('{"secret":"tenant data"}'));
    expect(await svc.encryptLegacyBackups()).toBe(1);
    const files = await readdir(dir);
    expect(files).toContain('2026-09-26.json.gz.enc');
    expect(files).not.toContain('2026-09-26.json');
    const key = parseEncryptionKey(KEY_HEX);
    expect(await svc.fullyVerify(join(dir, '2026-09-26.json.gz.enc'), key)).toBeGreaterThan(5);
  });
});

describe('verification & guards', () => {
  it('fullyVerify passes for a good file and fails for a tampered one', async () => {
    const svc = make();
    await svc.backupTarget(ctl);
    const f = join(root, CONTROL_TARGET, '2026-10-08.sql.gz.enc');
    const key = parseEncryptionKey(KEY_HEX);
    expect(await svc.fullyVerify(f, key)).toBeGreaterThan(1000);
    const buf = await readFile(f);
    buf[Math.floor(buf.length / 2)] ^= 1;
    await writeFile(f, buf);
    await expect(svc.fullyVerify(f, key)).rejects.toThrow();
    await expect(svc.lightVerify(f, 'deadbeef', buf.length, key)).rejects.toThrow(/هش/);
  });

  it('refuses to drop anything that is not a temp DB this job created', async () => {
    const svc: any = make();
    const mine = new Set(['exir_restore_check_0123456789ab']);
    await expect(svc.dropTempDb('exir_control', mine)).rejects.toThrow(/امتناع/);
    await expect(svc.dropTempDb('exir_tenant_acme', mine)).rejects.toThrow(/امتناع/);
    await expect(svc.dropTempDb('exir_restore_check_ffffffffffff', mine)).rejects.toThrow(/امتناع/); // right shape, not created by us
    await expect(svc.dropTempDb('exir_restore_check_0123456789ab"; DROP DATABASE x; --', new Set(['exir_restore_check_0123456789ab"; DROP DATABASE x; --']))).rejects.toThrow(/امتناع/);
    expect(RESTORE_DB_RE.test('exir_restore_check_0123456789ab')).toBe(true);
    expect(RESTORE_DB_RE.test('exir_restore_check_0123456789abc')).toBe(false);
  });

  it('status reports stale targets, missing offsite and never exposes secrets', async () => {
    const svc = make();
    await svc.backupTarget(ctl);
    const s = await svc.getStatus();
    expect(s.targets[0].name).toBe(CONTROL_TARGET);
    expect(s.offsite.configured).toBe(false);
    expect(s.warnings.join('\n')).toMatch(/خارج از سرور/);
    expect(JSON.stringify(s)).not.toContain(KEY_HEX);
  });
});
