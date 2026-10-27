import { describe, expect, it } from 'vitest';
import { deriveAssigneeTick, deriveTaskTick, taskIdFromNotification } from './task-ticks.js';

const T = new Date('2026-10-24T08:00:00Z');
const pub = { isPublished: true, status: 'NEW' };

describe('deriveTaskTick', () => {
  it('تک‌نفره: sent → delivered → seen', () => {
    expect(deriveTaskTick(pub, [{ userId: 'a', deliveredAt: null, seenAt: null }])).toBe('sent');
    expect(deriveTaskTick(pub, [{ userId: 'a', deliveredAt: T, seenAt: null }])).toBe('delivered');
    expect(deriveTaskTick(pub, [{ userId: 'a', deliveredAt: T, seenAt: T }])).toBe('seen');
  });
  it('seenAt بدون deliveredAt (داده‌ی قدیمی) هم seen است', () => {
    expect(deriveAssigneeTick({ deliveredAt: null, seenAt: T })).toBe('seen');
  });
  it('چندنفره: آبی فقط وقتی همه دیده باشند؛ خاکستری وقتی همه دریافت کرده باشند', () => {
    const a = { userId: 'a', deliveredAt: T, seenAt: T };
    const b = { userId: 'b', deliveredAt: T, seenAt: null };
    const c = { userId: 'c', deliveredAt: null, seenAt: null };
    expect(deriveTaskTick(pub, [a, a])).toBe('seen');
    expect(deriveTaskTick(pub, [a, b])).toBe('delivered');
    expect(deriveTaskTick(pub, [a, b, c])).toBe('sent');
  });
  it('زمان‌بندی‌شده/لغو/بدون ارجاع‌گیرنده: بدون تیک', () => {
    const r = [{ userId: 'a', deliveredAt: T, seenAt: T }];
    expect(deriveTaskTick({ isPublished: false, status: 'NEW' }, r)).toBe('none');
    expect(deriveTaskTick({ isPublished: true, status: 'CANCELLED' }, r)).toBe('none');
    expect(deriveTaskTick(pub, [])).toBe('none');
  });
  it('ارجاع مجدد: ردیف‌ها ریست می‌شوند و تیک به sent برمی‌گردد', () => {
    expect(deriveTaskTick(pub, [{ userId: 'n', deliveredAt: null, seenAt: null }])).toBe('sent');
  });
});

describe('taskIdFromNotification', () => {
  const id = '3f2b8a9e-1111-4222-8333-444455556666';
  it('entityId وقتی نوع Task است', () => expect(taskIdFromNotification({ entityType: 'Task', entityId: id })).toBe(id));
  it('لینک /tasks?open=', () => expect(taskIdFromNotification({ link: `/tasks?open=${id}` })).toBe(id));
  it('نوع دیگر یا لینک نامرتبط: null', () => {
    expect(taskIdFromNotification({ entityType: 'Invoice', entityId: id, link: `/tasks?open=${id}` })).toBeNull();
    expect(taskIdFromNotification({ link: '/sales/invoices?open=abc' })).toBeNull();
    expect(taskIdFromNotification({})).toBeNull();
  });
});
