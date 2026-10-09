import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackupDrService } from './backup-dr.service.js';
import { emptyStatus, readStatus, writeStatus } from './backup-state.js';

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

class Svc extends BackupDrService {
  run(status = emptyStatus()) {
    return this.alertStaleRestoreVerification(status);
  }
}

let root: string;
let sms: string[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rv-'));
  process.env.BACKUP_DIR = root;
  process.env.BACKUP_ALERT_PHONE = '09120000000';
  sms = [];
});
afterEach(async () => {
  delete process.env.BACKUP_DIR;
  delete process.env.BACKUP_ALERT_PHONE;
  await rm(root, { recursive: true, force: true });
});

describe('tenant restore-verification staleness alert (>35 days)', () => {
  it('alerts once per day for stale/never-verified tenants only', async () => {
    const tenants = [
      { slug: 'fresh', createdAt: daysAgo(300) },
      { slug: 'stale', createdAt: daysAgo(300) },
      { slug: 'never', createdAt: daysAgo(60) },
      { slug: 'young', createdAt: daysAgo(3) },
    ];
    const controlDb: any = { tenant: { findMany: async () => tenants }, errorLog: { create: async () => ({}) } };
    const smsSvc: any = { sendSms: async (_p: string, m: string) => (sms.push(m), { success: true }) };
    const svc = new Svc(controlDb, smsSvc);
    const status = emptyStatus();
    for (const t of tenants) status.targets[t.slug] = { lastSuccessAt: new Date().toISOString() };
    status.restoreVerified = { fresh: daysAgo(5).toISOString(), stale: daysAgo(50).toISOString() };
    await writeStatus(root, status);

    await svc.run(status);
    expect(sms).toHaveLength(2);
    expect(sms.some((m) => m.includes('stale'))).toBe(true);
    expect(sms.some((m) => m.includes('never'))).toBe(true);
    await svc.run(await readStatus(root)); // dedupe: same day, no more SMS
    expect(sms).toHaveLength(2);
  });
});
