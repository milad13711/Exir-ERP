import { describe, expect, it, vi } from 'vitest';
import { ActivityLogService, inferOriginFromStack } from './activity-log.service.js';
import { activityActorStorage } from './activity-context.js';

function mkDb(over: Record<string, unknown> = {}) {
  return {
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1', globalUserId: 'g1' }]) },
    activityLog: { createMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    ...over,
  } as never as { activityLog: { createMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> } };
}

describe('ActivityLogService.logSystem', () => {
  it('records an AUTOMATIC row with module/summary and no user by default', async () => {
    const db = mkDb();
    const svc = new ActivityLogService();
    svc.logSystem(db as never, { action: 'sales.recurring-invoice.generated', moduleCode: 'sales', summary: 'صدور خودکار فاکتور', entityId: 'i1' });
    await svc.flush();
    const [row] = db.activityLog.createMany.mock.calls[0][0].data;
    expect(row).toMatchObject({ actorType: 'AUTOMATIC', userId: null, moduleCode: 'sales', actionType: 'other', entityId: 'i1' });
    expect(row.metadata).toMatchObject({ src: 'system' });
  });

  it('can attribute to a person (e.g. auto-filed daily report) and supports SYSTEM actor', async () => {
    const db = mkDb();
    const svc = new ActivityLogService();
    svc.logSystem(db as never, { action: 'x.y', moduleCode: 'x', summary: 's', userId: 'u9', actorType: 'SYSTEM' });
    await svc.flush();
    expect(db.activityLog.createMany.mock.calls[0][0].data[0]).toMatchObject({ userId: 'u9', actorType: 'SYSTEM' });
  });

  it('never throws and swallows database errors', async () => {
    const db = mkDb({ activityLog: { createMany: vi.fn().mockRejectedValue(new Error('x')), create: vi.fn().mockRejectedValue(new Error('y')), findMany: vi.fn().mockResolvedValue([]) } });
    const svc = new ActivityLogService();
    expect(() => svc.logSystem(db as never, { action: 'a.b', moduleCode: 'a', summary: 's' })).not.toThrow();
    await expect(svc.flush()).resolves.toBeUndefined();
  });

  it('batches many rows into a single insert', async () => {
    const db = mkDb();
    const svc = new ActivityLogService();
    for (let i = 0; i < 10; i += 1) svc.logSystem(db as never, { action: 'a.b', moduleCode: 'a', summary: String(i) });
    await svc.flush();
    expect(db.activityLog.createMany).toHaveBeenCalledTimes(1);
    expect(db.activityLog.createMany.mock.calls[0][0].data).toHaveLength(10);
  });
});

describe('ActivityLogService.logSms', () => {
  const secret = 'کد ورود شما 123456 است https://x.ir/s/TOKEN123abc';

  it('stores masked recipient, length/parts and purpose; never the full text, code or link token', async () => {
    const db = mkDb();
    const svc = new ActivityLogService();
    svc.logSms(db as never, { phone: '09123456789', message: secret, success: true, purpose: 'otp' }, 't1');
    await svc.flush();
    const row = db.activityLog.createMany.mock.calls[0][0].data[0];
    const json = JSON.stringify(row);
    expect(json).not.toContain('123456');
    expect(json).not.toContain('TOKEN123abc');
    expect(json).not.toContain('09123456789');
    expect(row).toMatchObject({ action: 'sms.sent', actionType: 'send', actorType: 'SYSTEM' });
    expect(row.metadata).toMatchObject({ recipient: '0912•••789', purpose: 'otp', success: true, length: secret.length, parts: 1, preview: null });
  });

  it('redacts digits and links in a normal message preview and records failures with the error', async () => {
    const db = mkDb();
    const svc = new ActivityLogService();
    svc.logSms(db as never, { phone: '09123456789', message: 'فاکتور شماره 1001 به مبلغ 2500000 تومان https://a.ir/p/abcdef', success: false, error: 'اعتبار تمام شده', purpose: 'invoice-reminder' }, 't1');
    await svc.flush();
    const row = db.activityLog.createMany.mock.calls[0][0].data[0];
    expect(row.action).toBe('sms.failed');
    expect(row.metadata.preview).toContain('••••');
    expect(row.metadata.preview).toContain('[لینک]');
    expect(row.metadata.preview).not.toContain('2500000');
    expect(row.metadata.error).toBe('اعتبار تمام شده');
  });

  it('attributes a manual send to the requesting user and an unattended (cron) send to SYSTEM', async () => {
    const db = mkDb();
    const svc = new ActivityLogService();
    activityActorStorage.run({ actorType: 'MANUAL', globalUserId: 'g1', tenantId: 't1', moduleCode: 'sales' }, () => {
      svc.logSms(db as never, { phone: '09123456789', message: 'سلام', success: true }, 't1');
    });
    svc.logSms(db as never, { phone: '09123456789', message: 'سلام', success: true }, 't1');
    await svc.flush();
    const [manual, system] = db.activityLog.createMany.mock.calls[0][0].data;
    expect(manual).toMatchObject({ actorType: 'MANUAL', userId: 'u1', moduleCode: 'sales' });
    expect(system).toMatchObject({ actorType: 'SYSTEM', userId: null });
  });

  it('lets an automation force AUTOMATIC even inside a user request', async () => {
    const db = mkDb();
    const svc = new ActivityLogService();
    activityActorStorage.run({ actorType: 'MANUAL', globalUserId: 'g1', tenantId: 't1' }, () => {
      svc.logSms(db as never, { phone: '09123456789', message: 'سلام', success: true, actorType: 'AUTOMATIC', purpose: 'automation' }, 't1');
    });
    await svc.flush();
    expect(db.activityLog.createMany.mock.calls[0][0].data[0].actorType).toBe('AUTOMATIC');
  });
});

describe('inferOriginFromStack', () => {
  it('finds the calling module and file, skipping sms/activity frames', () => {
    const stack = ['Error', '    at TenantSmsService.sendSms (/app/src/sms/tenant-sms.service.ts:70:19)', '    at PaymentReminderService.run (/app/src/sales/payment-reminder.service.ts:122:40)'].join('\n');
    expect(inferOriginFromStack(stack)).toEqual({ dir: 'sales', file: 'payment-reminder' });
    expect(inferOriginFromStack('Error\n at x (/app/dist/mentoring/sessions.service.js:1:1)')).toEqual({ dir: 'mentoring', file: 'sessions' });
  });
});
