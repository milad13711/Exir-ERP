import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackupDrService } from './backup-dr.service.js';

/**
 * Real pg_dump -> gzip -> AES-GCM -> psql restore round trip. Opt-in because it needs
 * a local Postgres plus two THROWAWAY databases (never point this at production):
 *   BACKUP_IT_PG=1 CONTROL_DATABASE_URL=postgresql://postgres@localhost:5433/bkit_control \
 *   BACKUP_IT_TENANT_DB=bkit_tenant BACKUP_IT_PORT=5433 npx vitest run backup-dr.integration
 * bkit_control needs >=10 tables incl. `tenants` with a row; bkit_tenant >=10 tables incl. `users` with rows.
 */
const enabled = process.env.BACKUP_IT_PG === '1' && /localhost|127\.0\.0\.1/.test(process.env.CONTROL_DATABASE_URL ?? '');

describe.skipIf(!enabled)('backup-dr real Postgres round trip', () => {
  it('backs up control + tenant, restores both into temp DBs, and drops them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bkit-'));
    process.env.BACKUP_DIR = root;
    process.env.BACKUP_ENCRYPTION_KEY ||= 'a'.repeat(64);
    const port = Number(process.env.BACKUP_IT_PORT ?? 5433);
    const controlDb: any = {
      tenant: { findMany: async () => [{ slug: 'bkit-tenant', dbHost: 'localhost', dbPort: port, dbName: process.env.BACKUP_IT_TENANT_DB }] },
      errorLog: { create: async () => {} },
    };
    const svc = new BackupDrService(controlDb);
    try {
      expect(await svc.runAll()).toEqual({ ok: 2, failed: 0 });
      const results = await svc.runRestoreTests();
      expect(results.map((r) => [r.target, r.ok, r.detail])).toEqual([
        ['_control', true, expect.stringContaining('tenants=')],
        ['bkit-tenant', true, expect.stringContaining('users=')],
      ]);
      expect((await readdir(join(root, 'bkit-tenant'))).some((f) => f.endsWith('.sql.gz.enc'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
