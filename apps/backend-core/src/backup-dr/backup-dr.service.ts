import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, open, readdir, rename, stat, statfs, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { buildPgDumpInvocation, type DumpConnection } from '../settings/backup.service.js';
import { SqlCompatTransform } from './backup-sql-compat.js';
import { DecryptStream, EncryptStream, looksEncrypted, parseEncryptionKey } from './backup-crypto.js';
import { S3ObjectStore, offsiteConfigFromEnv, sanitizeError, withRetry, type ObjectStore } from './backup-offsite.js';
import { BACKUP_FILE_RE, maxFilesKept, retentionFromEnv, selectDeleteDates, selectKeepDates, type RetentionPolicy } from './backup-retention.js';
import {
  DIR_MODE,
  FILE_MODE,
  ensureDir,
  readManifest,
  readStatus,
  writeManifest,
  writeStatus,
  type BackupStatus,
  type RestoreTestResult,
} from './backup-state.js';

export const CONTROL_TARGET = '_control';
export const RESTORE_DB_PREFIX = 'exir_restore_check_';
/** The ONLY database names this job is ever allowed to create or drop. */
export const RESTORE_DB_RE = /^exir_restore_check_[0-9a-f]{12}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const STALE_HOURS = 26;

export type BackupTarget = {
  name: string; // directory name under the backup root
  kind: 'control' | 'tenant';
  conn: DumpConnection;
  user?: string;
  password?: string;
};

type DumpHandle = { stream: Readable; done: Promise<void>; kill?: () => void };

class HashCounter extends Transform {
  readonly hash = createHash('sha256');
  size = 0;
  _transform(chunk: Buffer, _e: BufferEncoding, cb: (err?: Error | null, data?: Buffer) => void) {
    this.hash.update(chunk);
    this.size += chunk.length;
    cb(null, chunk);
  }
}

/** Parses CONTROL_DATABASE_URL into a dump target; the password stays out of argv (PGPASSWORD only). */
export function controlTargetFromEnv(env: NodeJS.ProcessEnv = process.env): BackupTarget | null {
  const raw = env.CONTROL_DATABASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      name: CONTROL_TARGET,
      kind: 'control',
      conn: { dbHost: u.hostname, dbPort: Number(u.port || 5432), dbName: decodeURIComponent(u.pathname.replace(/^\//, '')) },
      user: u.username ? decodeURIComponent(u.username) : env.TENANT_DB_ADMIN_USER,
      password: u.password ? decodeURIComponent(u.password) : env.TENANT_DB_ADMIN_PASSWORD,
    };
  } catch {
    return null;
  }
}

@Injectable()
export class BackupDrService implements OnModuleInit {
  private readonly logger = new Logger('BackupDr');
  private running: 'backup' | 'restore-test' | null = null;
  private readonly bootedAt = Date.now();

  constructor(
    private readonly controlDb: ControlPrismaService,
    @Optional() private readonly sms?: ExirSmsService,
  ) {}

  // ── configuration (read lazily so tests / env changes apply) ─────────────
  protected get root(): string {
    return process.env.BACKUP_DIR ?? '/app/backups';
  }
  protected get requireEncryption(): boolean {
    return String(process.env.BACKUP_REQUIRE_ENCRYPTION ?? '').toLowerCase() === 'true';
  }
  /** null = no key configured; throws if configured but malformed (fail closed). */
  protected getKey(): Buffer | null {
    const raw = process.env.BACKUP_ENCRYPTION_KEY;
    if (!raw || !raw.trim()) return null;
    return parseEncryptionKey(raw);
  }
  protected getStore(): ObjectStore | null {
    const cfg = offsiteConfigFromEnv();
    return cfg ? S3ObjectStore.fromConfig(cfg) : null;
  }
  protected offsitePrefix(): string {
    return offsiteConfigFromEnv()?.prefix ?? 'exir';
  }
  protected get retention(): RetentionPolicy {
    return retentionFromEnv();
  }
  protected today(): string {
    return new Date().toISOString().slice(0, 10);
  }
  protected sleepFn = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // ── lifecycle ────────────────────────────────────────────────────────────
  async onModuleInit(): Promise<void> {
    // Never block or crash app boot because of backup housekeeping.
    void (async () => {
      try {
        await this.enforcePermissions();
        if (!process.env.BACKUP_ENCRYPTION_KEY) {
          this.logger.warn('BACKUP_ENCRYPTION_KEY تنظیم نشده — بکاپ‌ها رمزنگاری نمی‌شوند و به خارج از سرور ارسال نخواهند شد.');
        } else {
          this.getKey(); // validates format, throws loudly if malformed
          await this.encryptLegacyBackups();
        }
      } catch (err) {
        this.logger.error(`Backup init check failed: ${sanitizeError(err)}`);
      }
    })();
  }

  // ── cron entry points ────────────────────────────────────────────────────
  @Cron('0 2 * * *')
  async runDailyBackups(): Promise<void> {
    await this.runAll();
  }

  @Cron('0 4 * * 0')
  async runWeeklyRestoreTest(): Promise<void> {
    await this.runRestoreTests();
  }

  @Cron('17 * * * *')
  async checkStaleness(): Promise<void> {
    try {
      const status = await readStatus(this.root);
      const warnings = this.staleWarnings(status);
      for (const w of warnings) await this.alert(`stale:${w.target}`, w.message);
    } catch (err) {
      this.logger.error(`staleness check failed: ${sanitizeError(err)}`);
    }
  }

  isRunning(): string | null {
    return this.running;
  }

  // ── backup run ───────────────────────────────────────────────────────────
  async listTargets(): Promise<BackupTarget[]> {
    const targets: BackupTarget[] = [];
    const control = controlTargetFromEnv();
    if (control) targets.push(control);
    else this.logger.error('CONTROL_DATABASE_URL تنظیم نشده — بکاپ دیتابیس کنترل ممکن نیست.');
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const t of tenants) {
      if (!SLUG_RE.test(t.slug)) {
        this.logger.error(`Skipping tenant with unsafe slug for backup path: ${t.id}`);
        continue;
      }
      targets.push({ name: t.slug, kind: 'tenant', conn: { dbHost: t.dbHost, dbPort: t.dbPort, dbName: t.dbName } });
    }
    return targets;
  }

  async runAll(): Promise<{ ok: number; failed: number }> {
    if (this.running) throw new Error(`عملیات دیگری در حال اجراست (${this.running})`);
    this.running = 'backup';
    let ok = 0;
    let failed = 0;
    try {
      await ensureDir(this.root);
      await this.patchStatus((s) => void (s.lastRunStartedAt = new Date().toISOString()));
      const targets = await this.listTargets();
      if (!targets.some((t) => t.kind === 'control')) {
        await this.alert('control-missing', 'پیکربندی بکاپ دیتابیس کنترل (CONTROL_DATABASE_URL) ناقص است');
        failed += 1;
      }
      // tenants that are no longer active (suspended/deleted) must not trigger "stale" alerts forever
      const activeNames = new Set(targets.map((t) => t.name));
      await this.patchStatus((s) => {
        for (const n of Object.keys(s.targets)) if (!activeNames.has(n) && n !== CONTROL_TARGET) delete s.targets[n];
      });
      for (const target of targets) {
        try {
          await this.backupTarget(target);
          ok += 1;
        } catch (err) {
          failed += 1;
          const msg = sanitizeError(err);
          this.logger.error(`Backup failed for "${target.name}": ${msg}`);
          await this.patchStatus((s) => {
            s.targets[target.name] = { ...s.targets[target.name], lastError: msg, lastErrorAt: new Date().toISOString() };
          });
          await this.alert(`backup-fail:${target.name}`, `بکاپ ${target.name === CONTROL_TARGET ? 'دیتابیس کنترل' : `تننت ${target.name}`} ناموفق بود: ${msg}`);
        }
      }
      await this.patchStatus((s) => void (s.lastRunFinishedAt = new Date().toISOString()));
      this.logger.log(`Backup run finished: ${ok} ok, ${failed} failed`);
      return { ok, failed };
    } finally {
      this.running = null;
    }
  }

  /** Hook point (overridden in tests): start pg_dump and expose its stdout + completion. */
  protected openDump(target: BackupTarget): DumpHandle {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (target.user) env.TENANT_DB_ADMIN_USER = target.user;
    if (target.password) env.TENANT_DB_ADMIN_PASSWORD = target.password;
    const { args, env: childEnv } = buildPgDumpInvocation(target.conn, env);
    const child = spawn('pg_dump', args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 2000) stderr += c.toString();
    });
    const done = new Promise<void>((resolve, reject) => {
      child.on('error', (e) => reject(new Error(`اجرای pg_dump ممکن نشد: ${e.message}`)));
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump با کد ${code} متوقف شد: ${stderr.trim().slice(0, 300)}`))));
    });
    done.catch(() => {});
    return { stream: child.stdout, done, kill: () => child.kill('SIGKILL') };
  }

  async backupTarget(target: BackupTarget): Promise<void> {
    const key = this.getKey(); // throws on malformed key => fail closed
    if (!key && this.requireEncryption) {
      throw new Error('BACKUP_REQUIRE_ENCRYPTION=true اما BACKUP_ENCRYPTION_KEY تنظیم نشده — بکاپ نوشته نشد');
    }
    const encrypted = !!key;
    if (!encrypted) this.logger.warn(`Backup for "${target.name}" is being stored UNENCRYPTED (no BACKUP_ENCRYPTION_KEY).`);

    const dir = join(this.root, target.name);
    await ensureDir(this.root);
    await ensureDir(dir);
    const date = this.today();
    const fileName = `${date}${encrypted ? '.sql.gz.enc' : '.sql.gz'}`;
    const finalPath = join(dir, fileName);
    const tmpPath = `${finalPath}.partial`;

    const previous = await this.latestEntry(dir, fileName);
    const counter = new HashCounter();
    const dump = this.openDump(target);
    const out = createWriteStream(tmpPath, { mode: FILE_MODE });
    const stages: any[] = [dump.stream, new SqlCompatTransform(), createGzip({ level: 9 })];
    if (key) stages.push(new EncryptStream(key));
    stages.push(counter, out);
    // wait for BOTH to settle before touching the file, so a late write can't resurrect a partial
    const [piped, dumped] = await Promise.allSettled([(pipeline as any)(...stages), dump.done]);
    if (piped.status === 'rejected' || dumped.status === 'rejected') {
      dump.kill?.();
      await unlink(tmpPath).catch(() => {});
      throw (dumped.status === 'rejected' ? dumped.reason : (piped as PromiseRejectedResult).reason);
    }
    if (counter.size === 0) {
      await unlink(tmpPath).catch(() => {});
      throw new Error('خروجی بکاپ خالی است');
    }
    await chmod(tmpPath, FILE_MODE);
    await rename(tmpPath, finalPath);
    const sha256 = counter.hash.digest('hex');

    // light verification (re-reads the file from disk): hash, header, first frame
    await this.lightVerify(finalPath, sha256, counter.size, key);
    if (previous && previous.size > 1_000_000 && counter.size < previous.size * 0.5) {
      await this.alert(`size-drop:${target.name}`, `حجم بکاپ ${target.name} نسبت به قبلی بیش از ۵۰٪ کاهش یافته (${counter.size} در برابر ${previous.size} بایت)`);
    }

    const manifest = await readManifest(dir);
    manifest.entries[fileName] = { sha256, size: counter.size, createdAt: new Date().toISOString(), encrypted };
    // a same-day plaintext twin is now redundant (and a liability) once the encrypted copy exists
    if (encrypted) {
      const twin = `${date}.sql.gz`;
      if (await unlink(join(dir, twin)).then(() => true, () => false)) delete manifest.entries[twin];
    }
    await writeManifest(dir, manifest);

    let offsiteOk = false;
    if (encrypted) offsiteOk = await this.syncOffsite(target.name, dir, manifest);
    await this.pruneLocal(dir, manifest);
    await writeManifest(dir, manifest);

    await this.patchStatus((s) => {
      s.targets[target.name] = {
        lastSuccessAt: new Date().toISOString(),
        lastFile: fileName,
        lastSize: counter.size,
        encrypted,
        offsite: offsiteOk,
      };
    });
    this.logger.log(`Backup written for "${target.name}": ${fileName} (${counter.size} bytes, ${encrypted ? 'encrypted' : 'UNENCRYPTED'}${offsiteOk ? ', off-site' : ''})`);
    if (!encrypted) await this.alert('unencrypted', 'بکاپ‌ها بدون رمزنگاری ذخیره می‌شوند (BACKUP_ENCRYPTION_KEY تنظیم نشده) و ارسال خارج از سرور انجام نمی‌شود');
  }

  private async latestEntry(dir: string, exceptFile: string) {
    const m = await readManifest(dir);
    const names = Object.keys(m.entries).filter((n) => n !== exceptFile).sort();
    const last = names[names.length - 1];
    return last ? m.entries[last] : null;
  }

  // ── verification ─────────────────────────────────────────────────────────
  async sha256File(path: string): Promise<{ sha256: string; size: number }> {
    const h = createHash('sha256');
    let size = 0;
    await pipeline(createReadStream(path), async (src: AsyncIterable<Buffer>) => {
      for await (const c of src) {
        h.update(c);
        size += c.length;
      }
    });
    return { sha256: h.digest('hex'), size };
  }

  /** Decrypts (or sniffs) only the first frame — proves the key works and the file starts with gzip. */
  async firstFrameIsGzip(path: string, key: Buffer | null): Promise<boolean> {
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(1 << 20);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const head = buf.subarray(0, bytesRead);
      if (!key) return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
      if (!looksEncrypted(head)) return false;
      const dec = new DecryptStream(key);
      const first = await new Promise<Buffer>((resolve, reject) => {
        dec.once('data', (c: Buffer) => resolve(c));
        dec.once('error', reject);
        dec.write(head, (err) => {
          if (err) reject(err);
          else setImmediate(() => reject(new Error('هیچ داده‌ای از فریم اول خوانده نشد')));
        });
      });
      dec.destroy();
      return first.length >= 2 && first[0] === 0x1f && first[1] === 0x8b;
    } finally {
      await fh.close();
    }
  }

  async lightVerify(path: string, expectedSha: string, expectedSize: number, key: Buffer | null): Promise<void> {
    const st = await stat(path);
    if (st.size !== expectedSize || st.size === 0) throw new Error(`اندازه‌ی فایل بکاپ روی دیسک (${st.size}) با خروجی نوشته‌شده (${expectedSize}) نمی‌خواند`);
    const { sha256 } = await this.sha256File(path);
    if (sha256 !== expectedSha) throw new Error('هش فایل بکاپ پس از نوشتن روی دیسک با هش اولیه نمی‌خواند (خطای دیسک؟)');
    if (!(await this.firstFrameIsGzip(path, key))) throw new Error('فریم اول بکاپ قابل رمزگشایی/gunzip نیست');
  }

  /** Full authenticate + gunzip of a stored file into the void; returns uncompressed byte count. */
  async fullyVerify(path: string, key: Buffer | null): Promise<number> {
    let n = 0;
    const sink = new Writable({ write: (c, _e, cb) => ((n += c.length), cb()) });
    const stages: any[] = [createReadStream(path)];
    if (path.endsWith('.enc')) {
      if (!key) throw new Error('کلید رمزنگاری برای تأیید فایل رمزنگاری‌شده موجود نیست');
      stages.push(new DecryptStream(key));
    }
    stages.push(createGunzip(), sink);
    await (pipeline as any)(...stages);
    return n;
  }

  // ── retention ────────────────────────────────────────────────────────────
  async pruneLocal(dir: string, manifest: Awaited<ReturnType<typeof readManifest>>): Promise<{ freedBytes: number; deleted: string[] }> {
    const files = await readdir(dir);
    const byDate = new Map<string, string[]>();
    for (const f of files) {
      const m = BACKUP_FILE_RE.exec(f);
      if (m) byDate.set(m[1], [...(byDate.get(m[1]) ?? []), f]);
      else if (f.endsWith('.partial') && (await stat(join(dir, f))).mtimeMs < Date.now() - 86_400_000) await unlink(join(dir, f)).catch(() => {});
    }
    const toDelete = selectDeleteDates([...byDate.keys()], this.retention);
    let freed = 0;
    const deleted: string[] = [];
    for (const d of toDelete) {
      for (const f of byDate.get(d) ?? []) {
        const size = (await stat(join(dir, f)).catch(() => null))?.size ?? 0;
        if (await unlink(join(dir, f)).then(() => true, () => false)) {
          freed += size;
          deleted.push(f);
          delete manifest.entries[f];
        }
      }
    }
    for (const name of Object.keys(manifest.entries)) if (!files.includes(name) && !deleted.includes(name)) delete manifest.entries[name];
    if (deleted.length) this.logger.log(`Retention freed ${freed} bytes in ${dir.split('/').pop()}: removed ${deleted.length} file(s)`);
    return { freedBytes: freed, deleted };
  }

  // ── off-site ─────────────────────────────────────────────────────────────
  /** Uploads missing encrypted files (newest first, max 3 per run), verifies them, applies remote retention. */
  async syncOffsite(name: string, dir: string, manifest: Awaited<ReturnType<typeof readManifest>>): Promise<boolean> {
    const store = this.getStore();
    if (!store) return false;
    const prefix = `${this.offsitePrefix()}/${name}/`;
    let latestOk = false;
    try {
      const pending = Object.entries(manifest.entries)
        .filter(([f, e]) => e.encrypted && f.endsWith('.sql.gz.enc') && !e.offsite)
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .slice(0, 3);
      for (const [file, entry] of pending) {
        const remoteKey = `${prefix}${file}`;
        const path = join(dir, file);
        if (!looksEncrypted(await this.readHead(path))) throw new Error(`آپلود ${file} رد شد: فایل رمزنگاری‌شده نیست`); // belt and braces
        await withRetry(
          async () => {
            await store.put(remoteKey, path, entry.size, entry.sha256);
            const head = await store.head(remoteKey);
            if (!head || head.size !== entry.size) throw new Error(`تأیید آپلود ناموفق: اندازه‌ی راه دور ${head?.size ?? 'نامشخص'} ≠ ${entry.size}`);
            if (head.sha256 && head.sha256 !== entry.sha256) throw new Error('تأیید آپلود ناموفق: هش راه دور نمی‌خواند');
          },
          { sleep: this.sleepFn },
        );
        entry.offsite = { key: remoteKey, at: new Date().toISOString(), size: entry.size };
      }
      const newest = Object.keys(manifest.entries).sort().pop();
      latestOk = !!newest && !!manifest.entries[newest].offsite;
      await this.pruneRemote(store, prefix);
      await this.patchStatus((s) => {
        s.offsiteLastOkAt = new Date().toISOString();
        s.offsiteLastError = undefined;
      });
    } catch (err) {
      const msg = sanitizeError(err);
      this.logger.error(`Off-site sync failed for "${name}": ${msg}`);
      await this.patchStatus((s) => void (s.offsiteLastError = `${name}: ${msg}`));
      await this.alert(`offsite-fail:${name}`, `ارسال بکاپ ${name} به فضای خارج از سرور ناموفق بود: ${msg}`);
      return false;
    }
    return latestOk;
  }

  async pruneRemote(store: ObjectStore, prefix: string): Promise<number> {
    const objects = await store.list(prefix);
    const byDate = new Map<string, string>();
    for (const o of objects) {
      const base = o.key.slice(prefix.length);
      const m = /^(\d{4}-\d{2}-\d{2})\.sql\.gz\.enc$/.exec(base);
      if (m && o.key.startsWith(prefix)) byDate.set(m[1], o.key);
    }
    const policy = this.retention;
    const keep = selectKeepDates([...byDate.keys()], policy);
    if (keep.size === 0) return 0;
    let n = 0;
    for (const [d, key] of byDate) {
      if (keep.has(d)) continue;
      await withRetry(() => store.delete(key), { sleep: this.sleepFn, attempts: 2 });
      n += 1;
    }
    return n;
  }

  private async readHead(path: string): Promise<Buffer> {
    const fh = await open(path, 'r');
    try {
      const b = Buffer.alloc(8);
      const { bytesRead } = await fh.read(b, 0, 8, 0);
      return b.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }

  // ── permissions & legacy migration ───────────────────────────────────────
  async enforcePermissions(): Promise<{ fixed: number }> {
    let fixed = 0;
    const walk = async (dir: string) => {
      const st = await stat(dir).catch(() => null);
      if (!st) return;
      if ((st.mode & 0o077) !== 0) {
        await chmod(dir, DIR_MODE).catch(() => {});
        fixed += 1;
      }
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) {
          const fst = await stat(p);
          if ((fst.mode & 0o077) !== 0) {
            await chmod(p, FILE_MODE).catch(() => {});
            fixed += 1;
          }
        }
      }
    };
    await walk(this.root);
    if (fixed > 0) this.logger.warn(`Backup permissions were too open on ${fixed} path(s); tightened to 0700/0600.`);
    return { fixed };
  }

  /**
   * فایل‌های متنیِ قدیمی را رمز می‌کند و نسخه‌ی ساده را حذف می‌کند:
   *  - `<date>.sql.gz` → `<date>.sql.gz.enc`
   *  - `<date>.json` (خروجی قدیمیِ پیش از pg_dump، شامل داده‌ی کامل تننت) → gzip + رمز → `<date>.json.gz.enc`
   */
  async encryptLegacyBackups(): Promise<number> {
    const key = this.getKey();
    if (!key) return 0;
    let converted = 0;
    const dirs = (await readdir(this.root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory());
    for (const d of dirs) {
      const dir = join(this.root, d.name);
      const files = await readdir(dir);
      for (const f of files) {
        const m = /^(\d{4}-\d{2}-\d{2})\.(sql\.gz|json)$/.exec(f);
        if (!m) continue;
        const isJson = m[2] === 'json';
        const encName = isJson ? `${m[1]}.json.gz.enc` : `${f}.enc`;
        const src = join(dir, f);
        const tmp = join(dir, `${encName}.partial`);
        try {
          const counter = new HashCounter();
          const legacyStages: any[] = [createReadStream(src)];
          if (isJson) legacyStages.push(createGzip({ level: 9 })); // JSON خام فشرده نبود؛ قبل از رمز فشرده می‌شود
          legacyStages.push(new EncryptStream(key), counter, createWriteStream(tmp, { mode: FILE_MODE }));
          await (pipeline as any)(...legacyStages);
          const finalPath = join(dir, encName);
          await rename(tmp, finalPath);
          await chmod(finalPath, FILE_MODE);
          await this.fullyVerify(finalPath, key); // must decrypt+gunzip cleanly before the plaintext is deleted
          const manifest = await readManifest(dir);
          manifest.entries[encName] = { sha256: counter.hash.digest('hex'), size: counter.size, createdAt: new Date().toISOString(), encrypted: true };
          delete manifest.entries[f];
          await writeManifest(dir, manifest);
          await unlink(src);
          converted += 1;
        } catch (err) {
          await unlink(tmp).catch(() => {});
          await unlink(join(dir, encName)).catch(() => {}); // never leave a half-verified .enc behind
          this.logger.error(`Legacy backup encryption failed for ${d.name}/${f}: ${sanitizeError(err)}`);
        }
      }
    }
    if (converted) this.logger.log(`Encrypted ${converted} legacy plaintext backup(s) in place and removed the plaintext copies.`);
    return converted;
  }

  // ── restore test ─────────────────────────────────────────────────────────
  protected async adminPsql(args: string[], opts: { stdin?: Readable; target?: BackupTarget } = {}): Promise<string> {
    const c = controlTargetFromEnv();
    if (!c) throw new Error('CONTROL_DATABASE_URL تنظیم نشده');
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (c.password) env.PGPASSWORD = c.password;
    const base = ['-X', '-q', '-h', c.conn.dbHost, '-p', String(c.conn.dbPort), '-U', c.user ?? 'postgres', '-v', 'ON_ERROR_STOP=1', ...args];
    const child = spawn('psql', base, { env, stdio: [opts.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => {
      if (stdout.length < 100_000) stdout += d.toString();
    });
    child.stderr!.on('data', (d: Buffer) => {
      if (stderr.length < 2000) stderr += d.toString();
    });
    const exited = new Promise<void>((resolve, reject) => {
      child.on('error', (e) => reject(new Error(`اجرای psql ممکن نشد: ${e.message}`)));
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`psql با کد ${code} متوقف شد: ${stderr.trim().slice(0, 400)}`))));
    });
    exited.catch(() => {});
    if (opts.stdin) {
      // psql may exit early on error; ignore EPIPE on its stdin and let `exited` carry the real error
      child.stdin!.on('error', () => {});
      const fed = pipeline(opts.stdin, child.stdin!).then(() => null, (e: Error) => e);
      await exited; // psql's own failure wins
      const feedError = await fed;
      if (feedError) throw feedError; // a source error (tamper/truncation) must fail the restore even if psql saw valid-looking SQL
      return stdout;
    }
    await exited;
    return stdout;
  }

  /** Guarded drop: the name must match the strict pattern AND have been created by this job. */
  protected async dropTempDb(name: string, createdByUs: Set<string>): Promise<void> {
    if (!RESTORE_DB_RE.test(name) || !createdByUs.has(name)) {
      throw new Error(`امتناع از حذف دیتابیس «${name}» — فقط دیتابیس‌های موقت ساخته‌شده توسط همین job حذف می‌شوند`);
    }
    try {
      await this.adminPsql(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`]);
    } catch {
      await this.adminPsql(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS "${name}"`]);
    }
    createdByUs.delete(name);
  }

  async restoreCheck(target: BackupTarget, key: Buffer | null): Promise<RestoreTestResult> {
    const started = Date.now();
    const dir = join(this.root, target.name);
    const base = { at: new Date().toISOString(), target: target.name, file: '' };
    const created = new Set<string>();
    const dbName = `${RESTORE_DB_PREFIX}${randomBytes(6).toString('hex')}`;
    try {
      const files = (await readdir(dir)).filter((f) => BACKUP_FILE_RE.test(f) && !f.endsWith('.json') && !f.endsWith('.json.gz.enc')).sort();
      const file = files.reverse().find((f) => f.endsWith('.enc') === !!key) ?? files[0];
      if (!file) throw new Error('هیچ فایل بکاپی برای آزمون بازیابی پیدا نشد');
      base.file = file;
      const path = join(dir, file);
      if (file.endsWith('.enc') && !key) throw new Error('کلید رمزنگاری برای آزمون بازیابی در دسترس نیست');

      const entry = (await readManifest(dir)).entries[file];
      if (entry) {
        const { sha256 } = await this.sha256File(path);
        if (sha256 !== entry.sha256) throw new Error('هش فایل بکاپ با manifest نمی‌خواند (فایل تغییر کرده یا خراب است)');
      }

      await this.persistTempDb(dbName, 'add');
      created.add(dbName);
      await this.adminPsql(['-d', 'postgres', '-c', `CREATE DATABASE "${dbName}"`]);

      const stages: any[] = [createReadStream(path)];
      if (file.endsWith('.enc')) stages.push(new DecryptStream(key!));
      stages.push(createGunzip(), new SqlCompatTransform()); // فایل‌های قدیمی هم همان خط ناسازگار را دارند
      const sqlStream = new PassThrough();
      stages.push(sqlStream);
      (pipeline as any)(...stages).catch(() => {}); // pipeline destroys sqlStream with the error, which fails the feed below
      await this.adminPsql(['-d', dbName], { stdin: sqlStream });

      const detail = await this.assertRestored(dbName, target);
      return { ...base, ok: true, durationMs: Date.now() - started, detail };
    } catch (err) {
      return { ...base, ok: false, durationMs: Date.now() - started, detail: sanitizeError(err) };
    } finally {
      if (created.has(dbName)) {
        try {
          await this.dropTempDb(dbName, created);
          await this.persistTempDb(dbName, 'remove');
        } catch (err) {
          this.logger.error(`Could not drop temp restore DB ${dbName}: ${sanitizeError(err)} (will retry on next test)`);
        }
      }
    }
  }

  private async assertRestored(dbName: string, target: BackupTarget): Promise<string> {
    const q = async (sql: string) => (await this.adminPsql(['-d', dbName, '-t', '-A', '-c', sql])).trim();
    const tables = Number(await q(`SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`));
    if (!(tables >= 10)) throw new Error(`تعداد جدول‌های بازیابی‌شده کم است (${tables})`);
    const key = target.kind === 'control' ? { table: 'tenants', label: 'tenants' } : { table: 'users', label: 'users' };
    const rows = Number(await q(`SELECT count(*) FROM public."${key.table}"`));
    if (!(rows > 0)) throw new Error(`جدول ${key.table} پس از بازیابی خالی است`);
    return `tables=${tables}, ${key.label}=${rows}`;
  }

  private async persistTempDb(name: string, op: 'add' | 'remove'): Promise<void> {
    await this.patchStatus((s) => {
      const list = new Set(s.tempDbs ?? []);
      if (op === 'add') list.add(name);
      else list.delete(name);
      s.tempDbs = [...list];
    });
  }

  /** Drops temp DBs a previous crashed run left behind — only names we recorded ourselves. */
  private async cleanupLeftoverTempDbs(): Promise<void> {
    const s = await readStatus(this.root);
    const leftover: string[] = s.tempDbs ?? [];
    for (const name of leftover) {
      if (!RESTORE_DB_RE.test(name)) continue;
      try {
        await this.dropTempDb(name, new Set([name]));
        await this.persistTempDb(name, 'remove');
      } catch (err) {
        this.logger.warn(`leftover temp DB cleanup failed for ${name}: ${sanitizeError(err)}`);
      }
    }
  }

  async runRestoreTests(): Promise<RestoreTestResult[]> {
    if (this.running) throw new Error(`عملیات دیگری در حال اجراست (${this.running})`);
    this.running = 'restore-test';
    const results: RestoreTestResult[] = [];
    try {
      const key = this.getKey();
      await this.cleanupLeftoverTempDbs().catch(() => {});
      const status = await readStatus(this.root);
      const control = controlTargetFromEnv();
      const targets: BackupTarget[] = [];
      if (control) targets.push(control);
      const biggest = Object.entries(status.targets)
        .filter(([n]) => n !== CONTROL_TARGET)
        .sort(([, a], [, b]) => (b.lastSize ?? 0) - (a.lastSize ?? 0))[0];
      if (biggest) targets.push({ name: biggest[0], kind: 'tenant', conn: { dbHost: '', dbPort: 0, dbName: '' } });
      for (const t of targets) {
        const r = await this.restoreCheck(t, key);
        results.push(r);
        this.logger.log(`Restore test ${r.target}: ${r.ok ? 'OK' : 'FAILED'} (${r.detail})`);
        if (!r.ok) await this.alert(`restore-fail:${r.target}`, `آزمون بازیابی بکاپ ${r.target} ناموفق بود: ${r.detail}`);
      }
      await this.patchStatus((s) => void (s.restoreTests = [...results, ...s.restoreTests].slice(0, 20)));
      return results;
    } finally {
      this.running = null;
    }
  }

  // ── alerts ───────────────────────────────────────────────────────────────
  /** One alert per kind per day: ErrorLog row (+ SMS to the platform owner when configured). */
  async alert(kind: string, message: string): Promise<boolean> {
    const dayKey = `${this.today()}:${kind}`;
    const status = await readStatus(this.root);
    if (status.alertsSent[dayKey]) return false;
    await this.patchStatus((s) => {
      s.alertsSent[dayKey] = true;
      for (const k of Object.keys(s.alertsSent)) if (k.slice(0, 10) < new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)) delete s.alertsSent[k];
    });
    try {
      await this.controlDb.errorLog.create({
        data: { service: 'backup', level: 'ERROR', message: `[backup] ${message}`.slice(0, 1000), context: { kind } },
      });
    } catch (err) {
      this.logger.error(`could not write backup ErrorLog: ${sanitizeError(err)}`);
    }
    const phone = process.env.BACKUP_ALERT_PHONE || process.env.ON_PREM_OWNER_PHONE;
    if (phone && this.sms) {
      const res = await this.sms.sendSms(phone, `هشدار بکاپ اکسیر: ${message}`.slice(0, 300)).catch((e) => ({ success: false as const, error: String(e) }));
      if (!res.success) this.logger.warn(`backup alert SMS failed: ${res.error}`);
    }
    return true;
  }

  private staleWarnings(status: BackupStatus): { target: string; message: string }[] {
    const out: { target: string; message: string }[] = [];
    const limit = STALE_HOURS * 3_600_000;
    const names = new Set<string>([CONTROL_TARGET, ...Object.keys(status.targets)]);
    for (const n of names) {
      const t = status.targets[n];
      if (!t?.lastSuccessAt) {
        if (n === CONTROL_TARGET && Date.now() - this.bootedAt > limit) out.push({ target: n, message: 'هیچ بکاپ موفقی از دیتابیس کنترل ثبت نشده است' });
        continue;
      }
      const age = Date.now() - new Date(t.lastSuccessAt).getTime();
      if (age > limit) out.push({ target: n, message: `آخرین بکاپ موفق ${n === CONTROL_TARGET ? 'دیتابیس کنترل' : `تننت ${n}`} بیش از ${STALE_HOURS} ساعت پیش بوده است` });
    }
    return out;
  }

  // ── status ───────────────────────────────────────────────────────────────
  private async patchStatus(fn: (s: BackupStatus) => void): Promise<void> {
    // serialised through a promise chain so concurrent patches never lose updates
    const run = this.statusLock.then(async () => {
      const s = await readStatus(this.root);
      fn(s);
      await writeStatus(this.root, s);
    });
    this.statusLock = run.catch(() => {});
    await run;
  }
  private statusLock: Promise<void> = Promise.resolve();

  async getStatus() {
    const status = await readStatus(this.root);
    const targets: any[] = [];
    let total = 0;
    // فقط تننت‌های ACTIVE بکاپ می‌شوند؛ پوشه‌ی بقیه (منتظر پرداخت/معلق) فقط آرشیو قدیمی است و نباید قرمز دیده شود.
    const activeNames = new Set((await this.listTargets().catch(() => [])).map((t) => t.name));
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const e of entries.filter((x) => x.isDirectory())) {
      const dir = join(this.root, e.name);
      const files = (await readdir(dir)).filter((f) => BACKUP_FILE_RE.test(f));
      let bytes = 0;
      let plaintext = 0;
      for (const f of files) {
        bytes += (await stat(join(dir, f)).catch(() => null))?.size ?? 0;
        if (f.endsWith('.sql.gz') || f.endsWith('.json')) plaintext += 1;
      }
      total += bytes;
      const t = status.targets[e.name] ?? {};
      targets.push({ name: e.name, kind: e.name === CONTROL_TARGET ? 'control' : 'tenant', active: activeNames.has(e.name) || e.name === CONTROL_TARGET, ...t, fileCount: files.length, bytes, plaintextFiles: plaintext });
    }
    let freeBytes: number | null = null;
    let totalDisk: number | null = null;
    try {
      const fs = await statfs(this.root);
      freeBytes = Number(fs.bavail) * Number(fs.bsize);
      totalDisk = Number(fs.blocks) * Number(fs.bsize);
    } catch {
      /* ignore */
    }
    const store = this.getStore();
    const warnings: string[] = [];
    let keyConfigured = false;
    try {
      keyConfigured = !!this.getKey();
    } catch {
      warnings.push('BACKUP_ENCRYPTION_KEY نامعتبر است');
    }
    if (!keyConfigured) warnings.push('رمزنگاری بکاپ فعال نیست (BACKUP_ENCRYPTION_KEY تنظیم نشده)');
    else if (!this.requireEncryption) warnings.push('BACKUP_REQUIRE_ENCRYPTION=true تنظیم نشده است');
    if (!store) warnings.push('کپی خارج از سرور (BACKUP_S3_*) تنظیم نشده — با از دست رفتن سرور همه‌چیز از بین می‌رود');
    if (status.offsiteLastError) warnings.push(`آخرین ارسال خارج از سرور ناموفق بود: ${status.offsiteLastError}`);
    if (!targets.some((t) => t.name === CONTROL_TARGET && t.lastSuccessAt)) warnings.push('هنوز هیچ بکاپ موفقی از دیتابیس کنترل ثبت نشده است');
    for (const w of this.staleWarnings(status)) warnings.push(w.message);
    for (const t of targets) if (t.active && t.plaintextFiles > 0) warnings.push(`${t.plaintextFiles} فایل بکاپ بدون رمزنگاری در ${t.name} وجود دارد`);
    const lastTest = status.restoreTests[0];
    if (!lastTest) warnings.push('هنوز آزمون بازیابی انجام نشده است');
    else if (!lastTest.ok) warnings.push(`آخرین آزمون بازیابی (${lastTest.target}) ناموفق بود`);
    else if (Date.now() - new Date(lastTest.at).getTime() > 10 * 86_400_000) warnings.push('آخرین آزمون بازیابی بیش از ۱۰ روز پیش بوده است');
    if (freeBytes !== null && totalDisk && freeBytes / totalDisk < 0.15) warnings.push('کمتر از ۱۵٪ فضای دیسک آزاد است');

    return {
      generatedAt: new Date().toISOString(),
      running: this.running,
      encryption: { keyConfigured, required: this.requireEncryption },
      offsite: { configured: !!store, destination: store?.description ?? null, prefix: store ? this.offsitePrefix() : null, lastOkAt: status.offsiteLastOkAt ?? null, lastError: status.offsiteLastError ?? null },
      retention: { ...this.retention, maxFilesPerDatabase: maxFilesKept(this.retention) },
      disk: { backupBytes: total, freeBytes, totalBytes: totalDisk },
      lastRunStartedAt: status.lastRunStartedAt ?? null,
      lastRunFinishedAt: status.lastRunFinishedAt ?? null,
      targets: targets.sort((a, b) => (a.kind === 'control' ? -1 : b.kind === 'control' ? 1 : a.name.localeCompare(b.name))),
      lastRestoreTest: lastTest ?? null,
      restoreTests: status.restoreTests.slice(0, 5),
      warnings,
    };
  }
}
