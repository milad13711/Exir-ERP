import { beforeEach, describe, expect, it, vi } from 'vitest';

const enabledByTenant: Record<string, boolean> = {};
vi.mock('../common/module-enabled.util.js', () => ({
  isModuleEnabled: vi.fn(async (_c: unknown, tenantId: string) => enabledByTenant[tenantId] === true),
}));
const managersByTenant: Record<string, Array<{ tenantUserId: string; name: string; phone: string; email: null }>> = {};
vi.mock('../common/manager-users.js', () => ({
  getManagerUsers: vi.fn(async (_c: unknown, _d: unknown, tenantId: string) => managersByTenant[tenantId] ?? []),
}));

import { ModuleReleaseFanoutService } from './module-release-fanout.service.js';

type Row = Record<string, any>;
const uniq = () => Object.assign(new Error('unique'), { code: 'P2002' });

function makeTenantDb(users: string[]) {
  const settings = new Map<string, Row>();
  const notifications: Row[] = [];
  return {
    settings,
    notifications,
    user: { findMany: vi.fn(async () => users.map((id) => ({ id }))) },
    notification: {
      findMany: vi.fn(async ({ where }: any) => notifications.filter((n) => n.entityType === where.entityType && n.entityId === where.entityId && where.userId.in.includes(n.userId))),
    },
    moduleSetting: {
      // پیامک opt-in است؛ در این تست‌ها تننت صراحتاً روشنش کرده (تست پیش‌فرضِ خاموش جداست)
      findUnique: vi.fn(async () => ({ value: { sms: true } })),
      create: vi.fn(async ({ data }: any) => {
        if (settings.has(data.key)) throw uniq();
        settings.set(data.key, { ...data, updatedAt: new Date() });
        return data;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        if (typeof where.key === 'string') settings.delete(where.key);
        return { count: 1 };
      }),
    },
  };
}

function setup(opts: { tenants: string[]; users?: Record<string, string[]>; smsMode?: Record<string, string>; sendOk?: () => boolean }) {
  process.env.WEB_PANEL_PUBLIC_URL = 'https://app.example.ir';
  const release = { id: 'r1', shortCode: 'abc2345', moduleCode: 'sales', version: '1.4.0', title: 'ارتقا', summary: 's', status: 'PUBLISHED', channels: { notify: true, ticket: true, sms: true }, changes: [{ type: 'NEW', title: 't', description: 'd', valueText: 'v', deepLink: '/sales', sortOrder: 0 }] };
  const deliveries = new Map<string, Row>();
  const tickets: Row[] = [];
  const dbs = Object.fromEntries(opts.tenants.map((t) => [t, makeTenantDb(opts.users?.[t] ?? ['u1', 'u2'])]));
  const tenantRows = opts.tenants.map((id) => ({ id, slug: id, name: id, dbHost: 'h', dbPort: 1, dbName: id, status: 'ACTIVE' }));
  const key = (w: any) => `${w.releaseId}|${w.tenantId}|${w.channel}`;
  const controlDb: any = {
    moduleRelease: { findUnique: vi.fn(async () => release) },
    moduleDefinition: { findUnique: vi.fn(async () => ({ name: 'فروش' })) },
    tenant: { findMany: vi.fn(async () => tenantRows), findUnique: vi.fn(async ({ where }: any) => tenantRows.find((t) => t.id === where.id) ?? null) },
    tenantMembership: { findFirst: vi.fn(async () => ({ globalUserId: 'g1' })) },
    supportTicket: {
      create: vi.fn(async ({ data }: any) => {
        if (tickets.some((t) => t.tenantId === data.tenantId && t.sourceRef === data.sourceRef)) throw uniq();
        const t = { id: `tk${tickets.length + 1}`, ...data };
        tickets.push(t);
        return t;
      }),
      findUnique: vi.fn(async ({ where }: any) => tickets.find((t) => t.tenantId === where.tenantId_sourceRef.tenantId && t.sourceRef === where.tenantId_sourceRef.sourceRef) ?? null),
    },
    moduleReleaseDelivery: {
      create: vi.fn(async ({ data }: any) => {
        const k = key(data);
        if (deliveries.has(k)) throw uniq();
        const row = { id: k, attempts: 1, updatedAt: new Date(), ...data };
        deliveries.set(k, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => deliveries.get(key(where.releaseId_tenantId_channel)) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = [...deliveries.values()].find((r) => r.id === where.id);
        if (!row || row.status !== where.status || row.updatedAt !== where.updatedAt) return { count: 0 };
        Object.assign(row, { status: data.status, reason: data.reason, finishedAt: data.finishedAt, attempts: row.attempts + 1, updatedAt: new Date() });
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = [...deliveries.values()].find((r) => r.id === where.id)!;
        Object.assign(row, { status: data.status, sentCount: data.sentCount, failedCount: data.failedCount, reason: data.reason, ticketId: data.ticketId ?? row.ticketId, finishedAt: data.finishedAt, updatedAt: new Date(Date.now() + deliveries.size) });
        return row;
      }),
      upsert: vi.fn(async ({ where, create }: any) => {
        const k = key(where.releaseId_tenantId_channel);
        if (!deliveries.has(k)) deliveries.set(k, { id: k, attempts: 1, updatedAt: new Date(), ...create });
        return deliveries.get(k);
      }),
    },
  };
  const tenantPrisma: any = { forTenant: vi.fn((c: any) => dbs[c.dbName]) };
  const notifications: any = {
    notify: vi.fn(async (db: any, input: any) => {
      db.notifications.push({ userId: input.userId, entityType: input.entityType, entityId: input.entityId, title: input.title, link: input.link });
    }),
  };
  const sms: any = {
    getConnection: vi.fn(async (db: any) => ({ mode: opts.smsMode?.[Object.keys(dbs).find((k) => dbs[k] === db)!] ?? 'OWN' })),
    sendSms: vi.fn(async () => (opts.sendOk ? (opts.sendOk() ? { success: true } : { success: false, error: 'gateway down' }) : { success: true })),
  };
  const svc = new ModuleReleaseFanoutService(controlDb, tenantPrisma, notifications, sms);
  return { svc, controlDb, notifications, sms, dbs, deliveries, tickets };
}

beforeEach(() => {
  for (const k of Object.keys(enabledByTenant)) delete enabledByTenant[k];
  for (const k of Object.keys(managersByTenant)) delete managersByTenant[k];
});

const mgr = (id: string, phone = '09120000000') => ({ tenantUserId: id, name: id, phone, email: null });

describe('module targeting', () => {
  it('only tenants that have the module enabled are processed', async () => {
    Object.assign(enabledByTenant, { A: true, B: false, C: true });
    const { svc } = setup({ tenants: ['A', 'B', 'C'] });
    expect((await svc.eligibleTenants('sales')).map((t) => t.id)).toEqual(['A', 'C']);
  });
  it('fan-out never touches a tenant without the module', async () => {
    Object.assign(enabledByTenant, { A: true, B: false });
    managersByTenant.A = [mgr('m1')];
    const { svc, notifications, deliveries } = setup({ tenants: ['A', 'B'] });
    await svc.run('r1', { retry: false });
    expect([...deliveries.values()].every((d) => d.tenantId === 'A')).toBe(true);
    expect(notifications.notify).toHaveBeenCalled();
  });
});

describe('idempotency', () => {
  it('running twice (and retrying) does not duplicate notifications, tickets or SMS', async () => {
    Object.assign(enabledByTenant, { A: true });
    managersByTenant.A = [mgr('m1'), mgr('m2', '09121111111')];
    const { svc, notifications, sms, tickets } = setup({ tenants: ['A'] });
    await svc.run('r1', { retry: false });
    await svc.run('r1', { retry: false });
    await svc.run('r1', { retry: true });
    expect(notifications.notify).toHaveBeenCalledTimes(2); // u1,u2 once
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ category: 'MODULE_RELEASE', status: 'RESOLVED', sourceRef: 'module-release:r1' });
    expect(tickets[0].messages.create[0].senderType).toBe('SYSTEM');
    expect(sms.sendSms).toHaveBeenCalledTimes(2);
  });
  it('concurrent claims on one (release, tenant, channel) -> exactly one winner', async () => {
    const { svc } = setup({ tenants: ['A'] });
    const results = await Promise.all([svc.claim('r1', 'A', 'SMS', false), svc.claim('r1', 'A', 'SMS', false), svc.claim('r1', 'A', 'SMS', true)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('a second in-process run of the same release is rejected while one is active', async () => {
    Object.assign(enabledByTenant, { A: true });
    const { svc } = setup({ tenants: ['A'] });
    const p1 = svc.run('r1', { retry: false });
    const p2 = await svc.run('r1', { retry: false });
    expect(p2).toBeNull();
    await p1;
  });
});

describe('channel selection and SMS safety', () => {
  it('skips tenants without an SMS channel (and records why)', async () => {
    Object.assign(enabledByTenant, { A: true });
    managersByTenant.A = [mgr('m1')];
    const { svc, sms, deliveries } = setup({ tenants: ['A'], smsMode: { A: 'NONE' } });
    await svc.run('r1', { retry: false });
    expect(sms.sendSms).not.toHaveBeenCalled();
    expect(deliveries.get('r1|A|SMS')).toMatchObject({ status: 'SKIPPED', reason: 'NO_SMS_CHANNEL' });
  });
  it('respects tenant opt-out per channel', async () => {
    Object.assign(enabledByTenant, { A: true });
    managersByTenant.A = [mgr('m1')];
    const { svc, sms, dbs, deliveries, tickets } = setup({ tenants: ['A'] });
    dbs.A.moduleSetting.findUnique = vi.fn(async () => ({ value: { sms: false, ticket: false } })) as never;
    await svc.run('r1', { retry: false });
    expect(sms.sendSms).not.toHaveBeenCalled();
    expect(tickets).toHaveLength(0);
    expect(deliveries.get('r1|A|SMS')).toMatchObject({ status: 'SKIPPED', reason: 'OPTED_OUT' });
    expect(deliveries.get('r1|A|NOTIFY')?.status).toBe('SENT');
  });
  it('SMS is OFF by default for a tenant that never opted in (no stored prefs) — no SMS credit is consumed', async () => {
    Object.assign(enabledByTenant, { A: true });
    managersByTenant.A = [mgr('m1')];
    const { svc, sms, dbs, deliveries } = setup({ tenants: ['A'] });
    dbs.A.moduleSetting.findUnique = vi.fn(async () => null) as never;
    await svc.run('r1', { retry: false });
    expect(sms.sendSms).not.toHaveBeenCalled();
    expect(deliveries.get('r1|A|SMS')).toMatchObject({ status: 'SKIPPED', reason: 'OPTED_OUT' });
    expect(deliveries.get('r1|A|NOTIFY')?.status).toBe('SENT');
  });
  it('enforces the per-tenant daily SMS cap and limits recipients per release', async () => {
    Object.assign(enabledByTenant, { A: true });
    managersByTenant.A = [mgr('m1'), mgr('m2'), mgr('m3'), mgr('m4')];
    const { svc, sms, dbs, deliveries } = setup({ tenants: ['A'] });
    // سقف روزانه تقریباً پر است: ۵ از ۶ جایگاه مصرف شده
    const day = new Date(Date.now() + 12_600_000).toISOString().slice(0, 10);
    for (let n = 0; n < 5; n++) dbs.A.settings.set(`rel:smsday:${day}:${n}`, {});
    await svc.run('r1', { retry: false });
    expect(sms.sendSms).toHaveBeenCalledTimes(1); // فقط یک جایگاه باقی بود (۳ گیرنده‌ی مجاز، ۲ تا به سقف خورد)
    expect(deliveries.get('r1|A|SMS')).toMatchObject({ status: 'PARTIAL', reason: 'DAILY_CAP' });
  });
  it('a failed send releases its claims so retry can resend, and succeeded ones are not repeated', async () => {
    Object.assign(enabledByTenant, { A: true });
    managersByTenant.A = [mgr('m1'), mgr('m2')];
    let ok = false;
    const { svc, sms, deliveries } = setup({ tenants: ['A'], sendOk: () => ok });
    await svc.run('r1', { retry: false });
    expect(deliveries.get('r1|A|SMS')?.status).toBe('FAILED');
    ok = true;
    await svc.run('r1', { retry: true });
    expect(deliveries.get('r1|A|SMS')?.status).toBe('SENT');
    expect(sms.sendSms).toHaveBeenCalledTimes(4); // 2 failed + 2 resent
    await svc.run('r1', { retry: true });
    expect(sms.sendSms).toHaveBeenCalledTimes(4);
  });
  it('SMS carries only module name, version and the short link', async () => {
    Object.assign(enabledByTenant, { A: true });
    managersByTenant.A = [mgr('m1')];
    const { svc, sms } = setup({ tenants: ['A'] });
    await svc.run('r1', { retry: false });
    const text = (sms.sendSms.mock.calls[0] as unknown[])[2] as string;
    expect(text).toContain('https://app.example.ir/releases/abc2345');
    expect(text).not.toContain('ارتقا');
  });
  it('without WEB_PANEL_PUBLIC_URL no SMS is sent', async () => {
    Object.assign(enabledByTenant, { A: true });
    managersByTenant.A = [mgr('m1')];
    const { svc, sms, deliveries } = setup({ tenants: ['A'] });
    process.env.WEB_PANEL_PUBLIC_URL = '';
    await svc.run('r1', { retry: false });
    expect(sms.sendSms).not.toHaveBeenCalled();
    expect(deliveries.get('r1|A|SMS')?.reason).toBe('NO_PUBLIC_URL');
  });
});

describe('test send', () => {
  it('does not consume the real delivery rows and notifies managers only', async () => {
    Object.assign(enabledByTenant, { A: true });
    managersByTenant.A = [mgr('m1'), mgr('m2')];
    const { svc, notifications, deliveries, sms } = setup({ tenants: ['A'] });
    const out = await svc.testSend('r1', 'A', { notify: true, ticket: false, sms: true });
    expect(out.notify.sent).toBe(2);
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(sms.sendSms).toHaveBeenCalledTimes(1); // فقط یک پیامک آزمایشی
    expect(deliveries.has('r1|A|TEST')).toBe(true);
    expect(deliveries.has('r1|A|SMS')).toBe(false);
    expect(deliveries.has('r1|A|NOTIFY')).toBe(false);
    // ارسال واقعی بعد از تست هنوز کار می‌کند
    await svc.run('r1', { retry: false });
    expect(deliveries.get('r1|A|NOTIFY')?.status).toBe('SENT');
  });
});
