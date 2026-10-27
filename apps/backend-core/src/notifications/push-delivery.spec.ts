import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) } }));

process.env.VAPID_PUBLIC_KEY = 'BPublicKeyForTestsOnly';
process.env.VAPID_PRIVATE_KEY = 'privatekeyfortests';
process.env.APP_SECRETS_KEY = 'a'.repeat(64);

const { PushNotificationsService, vapidKeyHash } = await import('./push-notifications.service.js');
const { NotificationDeliveryService } = await import('./notification-delivery.service.js');
const { NotificationsService } = await import('./notifications.service.js');
const { PushAckController } = await import('./push-ack.controller.js');
const { ackKey } = await import('./push-tokens.js');
const { signAckToken, signRotateToken } = await import('./push-logic.js');
const { rotateKey } = await import('./push-tokens.js');
const { NotificationsController } = await import('./notifications.controller.js');

type Sub = { id: string; userId: string; endpoint: string; p256dh: string; auth: string; label: string | null; failureCount: number; vapidKeyHash: string | null; rotateNonce?: string | null; lastRotateAt?: Date | null };

function sub(id: string, over: Partial<Sub> = {}): Sub {
  return { id, userId: 'u1', endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'k', auth: 'a', label: `dev-${id}`, failureCount: 0, vapidKeyHash: null, ...over };
}

const userStatus = { value: 'ACTIVE' };

function fakeTenantDb(subs: Sub[]) {
  const attempts: Record<string, unknown>[] = [];
  const claimKeys = new Set<string>();
  const notifications = new Map<string, { id: string; userId: string; deliveredAt: Date | null; deliveredVia: string | null; entityType: string | null; entityId: string | null; link: string | null }>();
  const db = {
    pushSubscription: {
      findMany: vi.fn(async () => subs.filter((s) => true)),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = subs.find((x) => x.id === where.id);
        if (!s) throw new Error('gone');
        for (const [k, v] of Object.entries(data)) {
          if (k === 'failureCount' && v && typeof v === 'object') s.failureCount += (v as { increment: number }).increment;
          else (s as Record<string, unknown>)[k] = v;
        }
        return s;
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => subs.find((x) => x.id === where.id && x.userId === where.userId) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; rotateNonce?: string }; data: Record<string, unknown> }) => {
        const s = subs.find((x) => x.id === where.id && (where.rotateNonce === undefined || x.rotateNonce === where.rotateNonce));
        if (!s) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { endpoint: string; NOT: { id: string } } }) => {
        const before = subs.length;
        for (let i = subs.length - 1; i >= 0; i--) if (subs[i].endpoint === where.endpoint && subs[i].id !== where.NOT.id) subs.splice(i, 1);
        return { count: before - subs.length };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const i = subs.findIndex((x) => x.id === where.id);
        if (i >= 0) subs.splice(i, 1);
      }),
    },
    pushAttempt: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => void attempts.push(...data)),
      updateMany: vi.fn(async ({ where, data }: { where: { claimKey?: string }; data: Record<string, unknown> }) => {
        const row = attempts.find((a) => a.claimKey === where.claimKey);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.claimKey) {
          if (claimKeys.has(data.claimKey as string)) throw Object.assign(new Error('unique'), { code: 'P2002' });
          claimKeys.add(data.claimKey as string);
        }
        attempts.push(data);
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `n${notifications.size + 1}`, deliveredAt: null, deliveredVia: null, entityType: null, entityId: null, link: null, ...data } as never;
        notifications.set((row as { id: string }).id, row);
        return row;
      }),
      count: vi.fn(async () => 3),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; userId: string } }) =>
        [...notifications.values()].filter((n) => where.id.in.includes(n.id) && n.userId === where.userId && n.deliveredAt === null),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; userId: string; deliveredAt: null }; data: { deliveredAt: Date; deliveredVia: string } }) => {
        const n = notifications.get(where.id);
        if (!n || n.userId !== where.userId || n.deliveredAt !== null) return { count: 0 };
        n.deliveredAt = data.deliveredAt;
        n.deliveredVia = data.deliveredVia;
        return { count: 1 };
      }),
    },
    notificationPreference: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({ id: 'u1', email: null, phone: '09120000000', status: userStatus.value, globalUserId: 'g1' })) },
  };
  return { db: db as never, raw: db, attempts, notifications, subs };
}

const tenantPrisma = { dbNameOf: () => 'tenant_db', forTenant: vi.fn() };
const membership = { status: 'ACTIVE', tokenVersion: 0 };
const epochState = { global: 0 };
const controlDb = {
  tenant: { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ tokenVersion: 0 })) },
  tenantMembership: { findUnique: vi.fn(async () => membership) },
  adminPushSubscription: { findMany: vi.fn(async () => []), delete: vi.fn() },
};
const epoch = { effective: async (...v: Array<number | null | undefined>) => epochState.global + v.reduce<number>((a, b) => a + (b ?? 0), 0) };
const events = { record: vi.fn() };

function pushService() {
  return new PushNotificationsService(controlDb as never, tenantPrisma as never, epoch as never, events as never);
}

beforeEach(() => {
  userStatus.value = 'ACTIVE';
  membership.status = 'ACTIVE';
  epochState.global = 0;
  events.record.mockClear();
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201 });
});

describe('PushNotificationsService.sendToTenantUser', () => {
  it('sends to every device with urgency/TTL/topic, records attempts and success stats', async () => {
    const { db, raw, attempts } = fakeTenantDb([sub('a'), sub('b')]);
    const r = await pushService().sendToTenantUser(db, 'u1', { title: 'T', body: 'B', url: '/tasks?open=1', tag: 'task-1' }, { category: 'tasks', notificationId: 'n1' });
    expect(r).toMatchObject({ total: 2, sent: 2, failed: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [, payloadJson, opts] = sendNotification.mock.calls[0];
    expect(opts).toMatchObject({ urgency: 'normal', TTL: 86400, timeout: 10_000 });
    expect(opts.topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    const payload = JSON.parse(payloadJson as string);
    expect(payload.ackToken).toContain('.');
    expect(payload).toMatchObject({ url: '/tasks?open=1', category: 'tasks' });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ status: 'sent', pushId: 'n1', notificationId: 'n1' });
    expect(raw.pushSubscription.update).toHaveBeenCalledTimes(2);
  });

  it('critical alarms use high urgency + short TTL', async () => {
    const { db } = fakeTenantDb([sub('a')]);
    await pushService().sendToTenantUser(db, 'u1', { title: 'آلارم', body: '' }, { category: 'reminders', critical: true });
    expect(sendNotification.mock.calls[0][2]).toMatchObject({ urgency: 'high', TTL: 600 });
    expect(JSON.parse(sendNotification.mock.calls[0][1] as string).requireInteraction).toBe(true);
  });

  it('deletes a subscription immediately on 404/410 and keeps the healthy one', async () => {
    const { db, subs, attempts } = fakeTenantDb([sub('dead'), sub('ok')]);
    sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith('dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      return { statusCode: 201 };
    });
    const r = await pushService().sendToTenantUser(db, 'u1', { title: 'T', body: 'B' });
    expect(r).toMatchObject({ sent: 1, failed: 1 });
    expect(subs.map((s) => s.id)).toEqual(['ok']);
    expect(attempts.find((a) => a.subscriptionId === 'dead')).toMatchObject({ status: 'expired', httpCode: 410, reason: 'expired' });
  });

  it('removes a device after N consecutive counted failures, but not for transient errors', async () => {
    const { db, subs } = fakeTenantDb([sub('flaky', { failureCount: 7 }), sub('slow', { failureCount: 50 })]);
    sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith('flaky')) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
      throw Object.assign(new Error('Service Unavailable'), { statusCode: 503 });
    });
    await pushService().sendToTenantUser(db, 'u1', { title: 'T', body: 'B' });
    expect(subs.map((s) => s.id)).toEqual(['slow']);
  });

  it('one failing device never blocks the others and never throws', async () => {
    const { db } = fakeTenantDb([sub('a'), sub('b'), sub('c')]);
    sendNotification.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const r = await pushService().sendToTenantUser(db, 'u1', { title: 'T', body: 'B' });
    expect(r.sent).toBe(2);
  });

  it('skips devices subscribed with a rotated VAPID key', async () => {
    const { db, attempts } = fakeTenantDb([sub('old', { vapidKeyHash: 'deadbeefdeadbeef' }), sub('new', { vapidKeyHash: vapidKeyHash(process.env.VAPID_PUBLIC_KEY) })]);
    const r = await pushService().sendToTenantUser(db, 'u1', { title: 'T', body: 'B' });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(r.results.find((x) => x.subscriptionId === 'old')).toMatchObject({ status: 'skipped', reason: 'vapid_mismatch' });
    expect(attempts).toHaveLength(2);
  });

  it('reports no_device and survives a DB failure', async () => {
    const { db } = fakeTenantDb([]);
    expect((await pushService().sendToTenantUser(db, 'u1', { title: 'T', body: 'B' })).skipped).toBe('no_device');
    const broken = { pushSubscription: { findMany: vi.fn(async () => { throw new Error('db down'); }) } } as never;
    await expect(pushService().sendToTenantUser(broken, 'u1', { title: 'T', body: 'B' })).resolves.toMatchObject({ sent: 0 });
  });
});

describe('NotificationDeliveryService', () => {
  function svc() {
    return new NotificationDeliveryService(controlDb as never, tenantPrisma as never);
  }

  it('marks delivered once, is idempotent and invokes handlers only for the first delivery', async () => {
    const { db, notifications } = fakeTenantDb([]);
    notifications.set('n1', { id: 'n1', userId: 'u1', deliveredAt: null, deliveredVia: null, entityType: 'Task', entityId: 't1', link: '/tasks?open=t1' });
    const s = svc();
    const handler = vi.fn(async () => undefined);
    s.registerHandler(handler);
    expect(await s.markDelivered(db, 'u1', ['n1', 'n1'], 'push', 'tenant-1')).toBe(1);
    expect(await s.markDelivered(db, 'u1', ['n1'], 'in-app', 'tenant-1')).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'u1', notificationId: 'n1', entityType: 'Task', entityId: 't1', link: '/tasks?open=t1' });
    expect(notifications.get('n1')).toMatchObject({ deliveredVia: 'push' });
  });

  it("cannot mark another user's notification and a throwing handler doesn't break others", async () => {
    const { db, notifications } = fakeTenantDb([]);
    notifications.set('n1', { id: 'n1', userId: 'someone-else', deliveredAt: null, deliveredVia: null, entityType: null, entityId: null, link: null });
    notifications.set('n2', { id: 'n2', userId: 'u1', deliveredAt: null, deliveredVia: null, entityType: null, entityId: null, link: null });
    const s = svc();
    const good = vi.fn(async () => undefined);
    s.registerHandler(async () => {
      throw new Error('bad handler');
    });
    s.registerHandler(good);
    expect(await s.markDelivered(db, 'u1', ['n1', 'n2'], 'in-app')).toBe(1);
    expect(notifications.get('n1')!.deliveredAt).toBeNull();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('unregister works', async () => {
    const { db, notifications } = fakeTenantDb([]);
    notifications.set('n1', { id: 'n1', userId: 'u1', deliveredAt: null, deliveredVia: null, entityType: null, entityId: null, link: null });
    const s = svc();
    const h = vi.fn(async () => undefined);
    s.registerHandler(h)();
    await s.markDelivered(db, 'u1', ['n1'], 'socket');
    expect(h).not.toHaveBeenCalled();
  });

  it('ackByToken: valid token delivers via push; invalid/expired/unknown tenant is silently ignored', async () => {
    const { db, notifications } = fakeTenantDb([]);
    notifications.set('n1', { id: 'n1', userId: 'u1', deliveredAt: null, deliveredVia: null, entityType: null, entityId: null, link: null });
    controlDb.tenant.findFirst.mockResolvedValue({ id: 'tid', status: 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'tenant_db' });
    tenantPrisma.forTenant.mockReturnValue(db);
    const s = svc();
    const key = ackKey()!;
    const tok = signAckToken({ n: 'n1', u: 'u1', t: 'tenant_db' }, key);
    await expect(s.ackByToken(tok)).resolves.toBeUndefined();
    expect(notifications.get('n1')).toMatchObject({ deliveredVia: 'push' });
    // idempotent
    await expect(s.ackByToken(tok)).resolves.toBeUndefined();
    // garbage / tampered / expired
    await expect(s.ackByToken('garbage')).resolves.toBeUndefined();
    await expect(s.ackByToken(tok.slice(0, -3) + 'abc')).resolves.toBeUndefined();
    const expired = signAckToken({ n: 'n1', u: 'u1', t: 'tenant_db' }, key, Date.now() - 8 * 86400_000);
    controlDb.tenant.findFirst.mockClear();
    await s.ackByToken(expired);
    expect(controlDb.tenant.findFirst).not.toHaveBeenCalled();
    // suspended tenant
    controlDb.tenant.findFirst.mockResolvedValue({ id: 'tid', status: 'SUSPENDED', dbHost: 'h', dbPort: 1, dbName: 'tenant_db' });
    notifications.set('n3', { id: 'n3', userId: 'u1', deliveredAt: null, deliveredVia: null, entityType: null, entityId: null, link: null });
    await s.ackByToken(signAckToken({ n: 'n3', u: 'u1', t: 'tenant_db' }, key));
    expect(notifications.get('n3')!.deliveredAt).toBeNull();
  });

  it('ack endpoint always resolves (204 contract) and is rate limited per IP without errors', async () => {
    const delivery = { ackByToken: vi.fn(async () => undefined) };
    const ctrl = new PushAckController(delivery as never, { rotateByToken: vi.fn() } as never);
    for (let i = 0; i < 200; i++) await expect(ctrl.ack({ t: 'x' }, { ip: '1.2.3.4' } as never)).resolves.toBeUndefined();
    expect(delivery.ackByToken.mock.calls.length).toBeLessThan(200); // سقف ۱۲۰ در دقیقه
    await expect(ctrl.ack(undefined as never, { ip: '5.6.7.8' } as never)).resolves.toBeUndefined();
  });
});

describe('NotificationsService.notify', () => {
  function make(subs: Sub[], pref: Record<string, unknown> | null = null) {
    const f = fakeTenantDb(subs);
    f.raw.notificationPreference.findUnique = vi.fn(async () => pref) as never;
    const email = { isConfigured: () => false, sendEmail: vi.fn() };
    const sms = { sendSms: vi.fn(async () => ({ success: true })) };
    const push = pushService();
    return { ...f, sms, svc: new NotificationsService(email as never, sms as never, push) };
  }
  const flush = () => new Promise((r) => setTimeout(r, 20));

  it('never throws into callers, even when the DB write fails', async () => {
    const { db, raw, svc } = make([]);
    raw.notification.create = vi.fn(async () => {
      throw new Error('db down');
    }) as never;
    await expect(svc.notify(db, { userId: 'u1', type: 'task.assigned', title: 't' })).resolves.toBeUndefined();
  });

  it('stores entity/category, pushes with ack token and unread badge', async () => {
    const { db, svc, raw } = make([sub('a')]);
    await svc.notify(db, { userId: 'u1', type: 'task.assigned', title: 'وظیفه', link: '/tasks?open=t1', entityType: 'Task', entityId: 't1' });
    await flush();
    expect(raw.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entityType: 'Task', entityId: 't1', category: 'tasks', readAt: null }) });
    const payload = JSON.parse(sendNotification.mock.calls[0][1] as string);
    expect(payload).toMatchObject({ badgeCount: 3, entityId: 't1', url: '/tasks?open=t1' });
    expect(payload.ackToken).toBeTruthy();
  });

  it('quiet hours: no push for normal categories, but critical reminder alarms still push', async () => {
    const pref = { quietHoursEnabled: true, quietStart: '00:00', quietEnd: '23:59', smsEnabled: false, categoryPrefs: {} };
    const a = make([sub('a')], pref);
    await a.svc.notify(a.db, { userId: 'u1', type: 'task.assigned', title: 't' });
    await flush();
    expect(sendNotification).not.toHaveBeenCalled();
    const b = make([sub('a')], pref);
    await b.svc.notify(b.db, { userId: 'u1', type: 'reminder.alarm', title: 'آلارم', channels: { push: true } });
    await flush();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('per-category in-app off keeps a history row that is already read', async () => {
    const { db, svc, raw } = make([], { categoryPrefs: { marketing: { inApp: false } }, smsEnabled: false });
    await svc.notify(db, { userId: 'u1', type: 'marketing.promo', title: 'تخفیف' });
    const data = (raw.notification.create as unknown as { mock: { calls: [{ data: { readAt: Date | null } }][] } }).mock.calls[0][0].data;
    expect(data.readAt).toBeInstanceOf(Date);
  });

  it('confidential notifications push a generic text', async () => {
    const { db, svc } = make([sub('a')]);
    await svc.notify(db, { userId: 'u1', type: 'correspondence.sign', title: 'موضوع محرمانه', body: 'متن حساس', confidential: true });
    await flush();
    const payload = JSON.parse(sendNotification.mock.calls[0][1] as string);
    expect(payload.title).toBe('اعلان جدید');
    expect(JSON.stringify(payload)).not.toContain('حساس');
  });

  it('SMS fallback: off by default; when enabled sends once for important notifications with no working device', async () => {
    const off = make([], { smsFallbackEnabled: false, categoryPrefs: {}, smsEnabled: false });
    await off.svc.notify(off.db, { userId: 'u1', type: 'task.assigned', title: 'فوری', important: true });
    await flush();
    expect(off.sms.sendSms).not.toHaveBeenCalled();

    const on = make([], { smsFallbackEnabled: true, categoryPrefs: {}, smsEnabled: false });
    await on.svc.notify(on.db, { userId: 'u1', type: 'task.assigned', title: 'فوری', important: true });
    await flush();
    expect(on.sms.sendSms).toHaveBeenCalledTimes(1);
    expect(on.attempts.at(-1)).toMatchObject({ channel: 'sms', status: 'sent' });

    const ok = make([sub('a')], { smsFallbackEnabled: true, categoryPrefs: {}, smsEnabled: false });
    await ok.svc.notify(ok.db, { userId: 'u1', type: 'task.assigned', title: 'فوری', important: true });
    await flush();
    expect(ok.sms.sendSms).not.toHaveBeenCalled(); // پوش رسید

    const notImportant = make([], { smsFallbackEnabled: true, categoryPrefs: {}, smsEnabled: false });
    await notImportant.svc.notify(notImportant.db, { userId: 'u1', type: 'task.assigned', title: 'عادی' });
    await flush();
    expect(notImportant.sms.sendSms).not.toHaveBeenCalled();
  });
});

describe('SSRF hardening on send', () => {
  it('never contacts non-allowlisted endpoints and removes the row', async () => {
    const { db, subs } = fakeTenantDb([sub('ok'), sub('evil', { endpoint: 'https://169.254.169.254/latest' }), sub('lookalike', { endpoint: 'https://fcm.googleapis.com.evil.io/x' })]);
    const r = await pushService().sendToTenantUser(db, 'u1', { title: 'T', body: 'B' });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(r.results.filter((x) => x.reason === 'endpoint_not_allowed')).toHaveLength(2);
    expect(subs.map((s) => s.id)).toEqual(['ok']);
  });
  it('passes a guarded https agent (DNS rebinding defence) to web-push', async () => {
    const { db } = fakeTenantDb([sub('a')]);
    await pushService().sendToTenantUser(db, 'u1', { title: 'T', body: 'B' });
    expect(sendNotification.mock.calls[0][2].agent).toBeTruthy();
  });
  it('an ESSRF connect error deletes the subscription', async () => {
    const { db, subs } = fakeTenantDb([sub('a')]);
    sendNotification.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'ESSRF' }));
    await pushService().sendToTenantUser(db, 'u1', { title: 'T', body: 'B' });
    expect(subs).toHaveLength(0);
  });
});

describe('rotate token chain', () => {
  const ep = 'https://fcm.googleapis.com/fcm/send/NEW';
  async function setup() {
    const f = fakeTenantDb([sub('d1')]);
    controlDb.tenant.findFirst.mockResolvedValue({ id: 'tid', status: 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'tenant_db' });
    tenantPrisma.forTenant.mockReturnValue(f.db);
    const svc = pushService();
    const token = await svc.issueRotateToken(f.db, 'd1', 'u1', 'tid', 'g1');
    return { ...f, svc, token: token! };
  }

  it('issues a token only for ACTIVE memberships', async () => {
    const f = fakeTenantDb([sub('d1')]);
    membership.status = 'SUSPENDED';
    expect(await pushService().issueRotateToken(f.db, 'd1', 'u1', 'tid', 'g1')).toBeNull();
  });

  it('rotates once, returns the next token and invalidates the previous one', async () => {
    const { svc, token, subs } = await setup();
    const next = await svc.rotateByToken(token, ep, 'newp256', 'newauth');
    expect(next).toBeTruthy();
    expect(next).not.toBe(token);
    expect(subs[0]).toMatchObject({ endpoint: ep, p256dh: 'newp256' });
    expect(subs[0].lastRotateAt).toBeInstanceOf(Date);
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'PUSH_ENDPOINT_ROTATED' }));
    // توکن قبلی (یک‌بارمصرف) باطل است
    expect(await svc.rotateByToken(token, 'https://fcm.googleapis.com/fcm/send/EVIL', 'p', 'a')).toBeNull();
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'PUSH_ENDPOINT_REJECTED' }));
    // توکن جدید کار می‌کند و زنجیره ادامه دارد
    expect(await svc.rotateByToken(next, 'https://fcm.googleapis.com/fcm/send/NEXT', 'p', 'a')).toBeTruthy();
  });

  it('a new subscribe (re-issue) invalidates the old token', async () => {
    const { svc, token, db } = await setup();
    const fresh = await svc.issueRotateToken(db, 'd1', 'u1', 'tid', 'g1');
    expect(await svc.rotateByToken(token, ep, 'p', 'a')).toBeNull();
    expect(await svc.rotateByToken(fresh, ep, 'p', 'a')).toBeTruthy();
  });

  it('rejects non-allowlisted endpoints (SSRF) without consuming the token', async () => {
    const { svc, token } = await setup();
    for (const bad of ['https://169.254.169.254/x', 'http://fcm.googleapis.com/x', 'https://evil.com/fcm.googleapis.com', 5, undefined]) {
      expect(await svc.rotateByToken(token, bad, 'p', 'a')).toBeNull();
    }
    expect(await svc.rotateByToken(token, ep, 'p', 'a')).toBeTruthy();
  });

  it('is rejected when membership is not ACTIVE, user disabled, or session epoch changed', async () => {
    let c = await setup();
    membership.status = 'SUSPENDED';
    expect(await c.svc.rotateByToken(c.token, ep, 'p', 'a')).toBeNull();
    membership.status = 'ACTIVE';
    c = await setup();
    userStatus.value = 'DISABLED';
    expect(await c.svc.rotateByToken(c.token, ep, 'p', 'a')).toBeNull();
    userStatus.value = 'ACTIVE';
    c = await setup();
    epochState.global = 1; // «خروج اجباری همه»
    expect(await c.svc.rotateByToken(c.token, ep, 'p', 'a')).toBeNull();
  });

  it('rejects tampered, expired, wrong-user and wrong-device tokens; concurrent use succeeds only once', async () => {
    const c = await setup();
    expect(await c.svc.rotateByToken(c.token.slice(0, -3) + 'abc', ep, 'p', 'a')).toBeNull();
    const key = rotateKey()!;
    const expired = signRotateToken({ s: 'd1', u: 'u1', t: 'tenant_db', k: 'x', v: 0 }, key, Date.now() - 50 * 86400_000);
    expect(await c.svc.rotateByToken(expired, ep, 'p', 'a')).toBeNull();
    const otherUser = signRotateToken({ s: 'd1', u: 'someone', t: 'tenant_db', k: 'x', v: 0 }, key);
    expect(await c.svc.rotateByToken(otherUser, ep, 'p', 'a')).toBeNull();
    const results = await Promise.all([c.svc.rotateByToken(c.token, ep, 'p', 'a'), c.svc.rotateByToken(c.token, ep, 'p', 'a')]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('SMS claim (race-safe caps)', () => {
  function make(pref: Record<string, unknown>) {
    const f = fakeTenantDb([]);
    f.raw.notificationPreference.findUnique = vi.fn(async () => pref) as never;
    const sms = { sendSms: vi.fn(async () => ({ success: true })) };
    return { ...f, sms, svc: new NotificationsService({ isConfigured: () => false } as never, sms as never, pushService()) };
  }
  const flush = () => new Promise((r) => setTimeout(r, 30));

  it('parallel important notifications send exactly one fallback SMS (cooldown claim)', async () => {
    const m = make({ smsFallbackEnabled: true, categoryPrefs: {}, smsEnabled: false });
    await Promise.all([1, 2, 3, 4, 5].map((i) => m.svc.notify(m.db, { userId: 'u1', type: 'task.assigned', title: `فوری ${i}`, important: true })));
    await flush();
    expect(m.sms.sendSms).toHaveBeenCalledTimes(1);
  });

  it('batch SMS path honours the per-user daily cap and sends the fixed template only', async () => {
    process.env.NOTIFY_SMS_DAILY_CAP = '3';
    try {
      const m = make({ smsEnabled: true, categoryPrefs: {} });
      for (let i = 0; i < 6; i++) await m.svc.notify(m.db, { userId: 'u1', type: 'task.assigned', title: `عنوان ${i} http://evil.com`, body: 'متن آزاد کاربر' });
      await flush();
      expect(m.sms.sendSms).toHaveBeenCalledTimes(3);
      const text = (m.sms.sendSms.mock.calls[0] as unknown[])[2] as string;
      expect(text).not.toContain('http');
      expect(text).not.toContain('متن آزاد');
      expect(text).toContain('برای مشاهده وارد برنامه شوید');
    } finally {
      delete process.env.NOTIFY_SMS_DAILY_CAP;
    }
  });

  it('concurrent batch sends never exceed the cap', async () => {
    process.env.NOTIFY_SMS_DAILY_CAP = '2';
    try {
      const m = make({ smsEnabled: true, categoryPrefs: {} });
      await Promise.all(Array.from({ length: 8 }, (_, i) => m.svc.notify(m.db, { userId: 'u1', type: 'task.assigned', title: `t${i}` })));
      await flush();
      expect(m.sms.sendSms).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.NOTIFY_SMS_DAILY_CAP;
    }
  });
});

describe('NotificationsController hardening', () => {
  const push = { getPublicKey: () => 'k', currentKeyHash: () => 'h', isConfigured: () => true, issueRotateToken: vi.fn(async () => 'tok'), sendToTenantUser: vi.fn(async () => ({ total: 1, sent: 1, failed: 0, skipped: null, results: [] })) };
  const delivery = { markDelivered: vi.fn(async () => 0) };
  const ctrl = () => new NotificationsController(push as never, delivery as never);
  const userCtx = (db: unknown) => ({ auth: { type: 'user', sub: 'g1' }, tenantId: 'tid', tenantDb: db }) as never;

  it('markRead with an API key (no tenant user) is forbidden instead of matching every notification', async () => {
    const db = { notification: { updateMany: vi.fn() } };
    await expect(ctrl().markRead('n1', { auth: { type: 'api_key', sub: 'k' }, tenantId: 'tid', tenantDb: db } as never)).rejects.toThrow(/API/);
    expect(db.notification.updateMany).not.toHaveBeenCalled();
  });

  it('subscribe rejects non-allowlisted endpoints and is rate limited per user', async () => {
    const { db } = fakeTenantDb([]);
    (db as never as { user: unknown }).user = { findUnique: vi.fn(async () => ({ id: 'rl-user' })) };
    const raw = db as never as { pushSubscription: { upsert: unknown } };
    raw.pushSubscription.upsert = vi.fn(async () => ({ id: 's1', label: 'x' }));
    const c = ctrl();
    const bad = { endpoint: 'https://169.254.169.254/x', p256dh: 'p', auth: 'a' };
    await expect(c.subscribePush(bad, userCtx(db), 'UA')).rejects.toThrow();
    const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'p', auth: 'a' };
    expect(await c.subscribePush(good, userCtx(db), 'UA')).toMatchObject({ success: true, rotateToken: 'tok' });
    let blocked = 0;
    for (let i = 0; i < 30; i++) await c.subscribePush(good, userCtx(db), 'UA').catch(() => blocked++);
    expect(blocked).toBeGreaterThan(0);
  });

  it('push test is limited to 5 per minute per user', async () => {
    const { db } = fakeTenantDb([]);
    (db as never as { user: unknown }).user = { findUnique: vi.fn(async () => ({ id: 'test-user' })) };
    const c = ctrl();
    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 8; i++) {
      await c.sendTest({}, userCtx(db)).then(() => ok++, () => limited++);
    }
    expect(ok).toBe(5);
    expect(limited).toBe(3);
  });
});

describe('MarkDeliveredDto validation', () => {
  it('requires an array of at most 100 UUIDs', async () => {
    const { validate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const { MarkDeliveredDto } = await import('./dto/subscribe-push.dto.js');
    const check = (ids: unknown) => validate(plainToInstance(MarkDeliveredDto, { ids }));
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(await check([id])).toHaveLength(0);
    expect(await check('not-array')).not.toHaveLength(0);
    expect(await check(['x'])).not.toHaveLength(0);
    expect(await check(Array(101).fill(id))).not.toHaveLength(0);
  });
});

describe('push token keys fail closed in production', () => {
  it('without a valid APP_SECRETS_KEY no tokens are issued in production, but dev falls back', async () => {
    const saved = { k: process.env.APP_SECRETS_KEY, n: process.env.NODE_ENV };
    try {
      process.env.APP_SECRETS_KEY = 'short';
      process.env.NODE_ENV = 'production';
      expect(ackKey()).toBeNull();
      expect(rotateKey()).toBeNull();
      process.env.NODE_ENV = 'test';
      expect(ackKey()).not.toBeNull();
    } finally {
      process.env.APP_SECRETS_KEY = saved.k;
      process.env.NODE_ENV = saved.n;
    }
  });
});
