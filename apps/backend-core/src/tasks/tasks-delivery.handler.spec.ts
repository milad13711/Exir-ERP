import { describe, expect, it, vi } from 'vitest';
import { TasksDeliveryHandler } from './tasks-delivery.handler.js';

function make(tenant: unknown = { dbHost: 'h', dbPort: 5432, dbName: 'd' }) {
  let registered: ((e: never) => Promise<void>) | null = null;
  const delivery = { registerHandler: vi.fn((h: never) => { registered = h; return () => undefined; }) };
  const controlDb = { tenant: { findUnique: vi.fn(async () => tenant) } };
  const db = { __db: true };
  const tenantPrisma = { forTenant: vi.fn(() => db) };
  const tasks = { handleNotificationDelivered: vi.fn(async () => 1) };
  const h = new TasksDeliveryHandler(delivery as never, controlDb as never, tenantPrisma as never, tasks as never);
  h.onModuleInit();
  return { h, delivery, tasks, db, controlDb, run: (e: Record<string, unknown>) => registered!(e as never) };
}

describe('TasksDeliveryHandler', () => {
  it('در onModuleInit ثبت می‌شود و اعلان وظیفه را به markDelivered همان کاربر می‌رساند', async () => {
    const m = make();
    expect(m.delivery.registerHandler).toHaveBeenCalledTimes(1);
    await m.run({ tenantId: 't1', userId: 'u1', notificationId: 'n1', entityType: 'Task', entityId: 'task-1' });
    expect(m.tasks.handleNotificationDelivered).toHaveBeenCalledWith(m.db, expect.objectContaining({ userId: 'u1', entityId: 'task-1' }));
  });
  it('اعلان غیر وظیفه یا بدون tenantId نادیده گرفته می‌شود', async () => {
    const m = make();
    await m.run({ tenantId: 't1', userId: 'u1', notificationId: 'n', entityType: 'Invoice', entityId: 'i1' });
    await m.run({ userId: 'u1', notificationId: 'n', entityType: 'Task', entityId: 't' });
    expect(m.tasks.handleNotificationDelivered).not.toHaveBeenCalled();
  });
  it('تننت ناشناس: بی‌صدا رد می‌شود', async () => {
    const m = make(null);
    await m.run({ tenantId: 'x', userId: 'u1', notificationId: 'n', entityType: 'Task', entityId: 't' });
    expect(m.tasks.handleNotificationDelivered).not.toHaveBeenCalled();
  });
});
