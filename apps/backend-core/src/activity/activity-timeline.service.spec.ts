import { describe, expect, it, vi } from 'vitest';
import { ActivityTimelineService, linkTarget } from './activity-timeline.service.js';
import type { ArchiveAccess } from './user-activity-access.js';

const T = (m: number) => new Date(Date.UTC(2026, 9, 24, 10, m));
const access = (over: Partial<ArchiveAccess> = {}): ArchiveAccess => ({
  level: 'admin', viewerId: 'v', target: { id: 'u1', name: 'x', status: 'ACTIVE', globalUserId: 'g' }, tombstone: null, canSeeNetwork: true, canExport: true, canSeeLabels: true, ...over,
});

function setup() {
  const db = {
    activityLog: { findMany: vi.fn(async () => [{ id: 'a1', action: 'sales.invoices.updated', actorType: 'MANUAL', moduleCode: 'sales', actionType: 'update', summary: 'ویرایش فاکتور', entityType: 'invoice', entityId: 'i1', ip: '1.2.3.x', createdAt: T(5) }]) },
    taskEvent: { findMany: vi.fn(async () => [{ id: 'e1', taskId: 'task-1234', type: 'started', createdAt: T(9) }]) },
    corrEvent: { findMany: vi.fn(async () => [{ id: 'c1', letterId: 'letter-1234', type: 'SIGNED', createdAt: T(7) }]) },
    shipmentEvent: { findMany: vi.fn(async () => []) },
    documentRevision: { findMany: vi.fn(async () => { throw new Error('table missing'); }) },
    signatureEvidence: { findMany: vi.fn(async () => [{ id: 's1', entityType: 'Contract', entityId: 'ct-12345', action: 'SIGN', ip: '203.0.113.77', createdAt: T(1) }]) },
    userOffboardingRun: { findMany: vi.fn(async () => []) },
    task: { findMany: vi.fn(async () => [{ id: 'task-1234', number: 1, title: 'تهیه‌ی گزارش' }]) },
  };
  const permissions = { getEffective: vi.fn(async (_c: unknown, m: string) => ({ canViewAll: m === 'tasks', canViewOwn: true })) };
  const svc = new ActivityTimelineService(permissions as never);
  return { svc, db, ctx: { tenantDb: db } as never, permissions };
}

describe('ActivityTimelineService.query', () => {
  it('منابع را ادغام و مرتب می‌کند؛ منبع خراب کل پاسخ را نمی‌شکند', async () => {
    const { svc, ctx } = setup();
    const r = await svc.query(ctx, access(), 'u1', {}, { limit: 10 });
    expect(r.items.map((i) => i.id)).toEqual(['task:e1', 'correspondence:c1', 'activity:a1', 'signature:s1']);
  });
  it('select ایمن: هیچ منبعی metadata/before/after/note نمی‌خواند', async () => {
    const { svc, db, ctx } = setup();
    await svc.query(ctx, access(), 'u1', {}, { limit: 10 });
    for (const m of [db.activityLog, db.taskEvent, db.corrEvent, db.signatureEvidence]) {
      const sel = (m.findMany.mock.calls[0] as unknown as [{ select: Record<string, boolean> }])[0].select;
      for (const bad of ['metadata', 'before', 'after', 'note', 'meta', 'userAgent', 'lat', 'lng', 'device']) expect(sel[bad]).toBeUndefined();
    }
  });
  it('هر منبع حداکثر limit+1 ردیف می‌خواند', async () => {
    const { svc, db, ctx } = setup();
    await svc.query(ctx, access(), 'u1', {}, { limit: 20 });
    expect((db.activityLog.findMany.mock.calls[0] as unknown as [{ take: number }])[0].take).toBe(21);
    expect((db.taskEvent.findMany.mock.calls[0] as unknown as [{ take: number }])[0].take).toBe(21);
  });
  it('مدیر HR: IP حذف می‌شود و عنوان وظیفه نمی‌آید؛ مدیر سیستم هر دو را می‌بیند', async () => {
    const hr = setup();
    const a = await hr.svc.query(hr.ctx, access({ level: 'hr', canSeeNetwork: false, canSeeLabels: false }), 'u1', {}, { limit: 10 });
    expect(a.items.every((i) => !i.ip)).toBe(true);
    expect(a.items.find((i) => i.id === 'task:e1')!.title).toBe('شروع وظیفه');
    expect(hr.db.task.findMany).not.toHaveBeenCalled();
    const ad = setup();
    const b = await ad.svc.query(ad.ctx, access(), 'u1', {}, { limit: 10 });
    expect(b.items.find((i) => i.id === 'task:e1')!.title).toContain('تهیه‌ی گزارش');
    expect(b.items.find((i) => i.id === 'signature:s1')!.ip).toBe('203.0.113.x');
  });
  it('لینک فقط با دسترسی: HR با tasks.canViewAll لینک وظیفه دارد، نامه (فقط canViewOwn) ندارد', async () => {
    const { svc, ctx } = setup();
    const r = await svc.query(ctx, access({ level: 'hr', canSeeNetwork: false, canSeeLabels: false }), 'u1', {}, { limit: 10 });
    expect(r.items.find((i) => i.id === 'task:e1')!.link).toBe('/tasks?open=task-1234');
    expect(r.items.find((i) => i.id === 'correspondence:c1')!.link).toBeUndefined();
  });
  it('فیلتر ماژول: فقط منبع مربوط پرس‌وجو می‌شود', async () => {
    const { svc, db, ctx } = setup();
    await svc.query(ctx, access(), 'u1', { module: 'tasks' }, { limit: 10 });
    expect(db.taskEvent.findMany).toHaveBeenCalled();
    expect(db.corrEvent.findMany).not.toHaveBeenCalled();
    expect(db.signatureEvidence.findMany).not.toHaveBeenCalled();
  });
  it('linkTarget: فقط موجودیت‌های شناخته‌شده و شناسه‌ی امن', () => {
    expect(linkTarget({ entityType: 'Task', entityId: 'abc-123456' })?.href).toBe('/tasks?open=abc-123456');
    expect(linkTarget({ entityType: 'Task', entityId: 'a/../b' })).toBeNull();
    expect(linkTarget({ entityType: 'invoice', entityId: 'abc-123456' })).toBeNull();
  });
});
