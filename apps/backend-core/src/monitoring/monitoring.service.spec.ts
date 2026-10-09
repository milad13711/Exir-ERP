import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const probe = vi.hoisted(() => ({ status: 200 as number | null }));
vi.mock('./monitoring-probes.js', async (orig) => ({
  ...(await orig<typeof import('./monitoring-probes.js')>()),
  httpStatus: async () => ({ status: probe.status, ms: 5 }),
  tlsDaysLeft: async () => 90,
  diskFreePct: async () => ({ freePct: 50, freeBytes: 1, totalBytes: 2 }),
}));
import { MonitoringService } from './monitoring.service.js';

let dir: string;
let sms: string[];
let clock: number;
const ENV_KEYS = ['BACKUP_DIR', 'MONITOR_URLS', 'MONITOR_TLS_HOSTS', 'MONITOR_ALERT_PHONE', 'BACKUP_ALERT_PHONE', 'ON_PREM_OWNER_PHONE', 'MONITOR_MAX_SMS_PER_DAY', 'EXIR_SMS_API_KEY'];

class TestSvc extends MonitoringService {
  protected override now() {
    return new Date(clock);
  }
}
function make() {
  const controlDb: any = {
    $queryRawUnsafe: async () => 1,
    errorLog: { count: async () => 0, create: async () => ({}) },
  };
  const smsSvc: any = { isConfigured: () => true, sendSms: async (_p: string, m: string) => (sms.push(m), { success: true }) };
  return new TestSvc(controlDb, smsSvc, undefined);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mon-'));
  sms = [];
  clock = Date.UTC(2026, 9, 9, 10, 0);
  probe.status = 200;
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.BACKUP_DIR = dir;
  process.env.MONITOR_URLS = 'https://app.example.test';
  process.env.MONITOR_TLS_HOSTS = 'app.example.test';
  process.env.MONITOR_ALERT_PHONE = '09120000000';
});
afterEach(async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  await rm(dir, { recursive: true, force: true });
});

const tick = async (svc: MonitoringService) => {
  await svc.runChecks();
  clock += 5 * 60_000;
};

describe('MonitoringService (fakes)', () => {
  it('2 consecutive URL failures are required; then exactly one SMS; then recovery notice', async () => {
    const svc = make();
    await tick(svc);
    expect(sms).toHaveLength(0);

    probe.status = 503;
    await tick(svc); // failure 1
    expect(sms).toHaveLength(0);
    await tick(svc); // failure 2 -> alert
    expect(sms).toHaveLength(1);
    expect(sms[0]).toContain('app.example.test');
    await tick(svc); // still down: no spam
    await tick(svc);
    expect(sms).toHaveLength(1);

    probe.status = 200;
    await tick(svc);
    expect(sms).toHaveLength(2);
    expect(sms[1]).toContain('برطرف شد');
    await tick(svc);
    expect(sms).toHaveLength(2);
  });

  it('same-day flapping does not re-alert (per-kind per-day dedupe)', async () => {
    const svc = make();
    probe.status = 500;
    await tick(svc);
    await tick(svc); // alert #1
    probe.status = 200;
    await tick(svc); // recovery #1
    probe.status = 500;
    await tick(svc);
    await tick(svc); // would alert again but deduped today
    expect(sms.filter((m) => !m.includes('برطرف'))).toHaveLength(1);
  });

  it('re-alerts on a new day if still broken after recovery', async () => {
    const svc = make();
    probe.status = 500;
    await tick(svc);
    await tick(svc);
    probe.status = 200;
    await tick(svc);
    clock += 24 * 3_600_000;
    probe.status = 500;
    await tick(svc);
    await tick(svc);
    expect(sms.filter((m) => !m.includes('برطرف'))).toHaveLength(2);
  });

  it('falls back MONITOR -> BACKUP -> ON_PREM_OWNER phone and records no-recipient without throwing', async () => {
    delete process.env.MONITOR_ALERT_PHONE;
    const svc = make();
    const r = await svc.notify('x:1', 'hello', { source: 'host' });
    expect(r).toEqual({ sent: false, reason: 'no-recipient' });
    process.env.ON_PREM_OWNER_PHONE = '09121111111';
    const r2 = await svc.notify('x:2', 'hello', { source: 'host' });
    expect(r2.sent).toBe(true);
  });

  it('daily SMS cap suppresses floods with varying kinds', async () => {
    process.env.MONITOR_MAX_SMS_PER_DAY = '3';
    const svc = make();
    const out = [];
    for (let i = 0; i < 6; i++) out.push(await svc.notify(`host:k${i}`, 'm', { source: 'host' }));
    expect(sms).toHaveLength(3);
    expect(out.slice(3).every((r) => r.reason === 'cap')).toBe(true);
  });

  it('getStatus reports per-check levels, history and last alert', async () => {
    const svc = make();
    probe.status = 500;
    await tick(svc);
    await tick(svc);
    const st = await svc.getStatus();
    const u = st.checks.find((c) => c.key.startsWith('url:'))!;
    expect(u.level).toBe('crit');
    expect(st.checks.find((c) => c.key === 'db')!.level).toBe('ok');
    expect(st.history.length).toBe(2);
    expect(st.lastAlert?.delivered).toBe(true);
    expect(st.config.alertPhoneMasked).toBe('0912***00');
  });
});
