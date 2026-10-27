import { describe, expect, it } from 'vitest';
import {
  buildTimelineCsv,
  csvCellSafe,
  decodeCursor,
  dedupeNearDuplicates,
  encodeCursor,
  mapActivity,
  mapRevision,
  mapSignature,
  mapTaskEvent,
  mergeTimelines,
  parseDayParam,
  parseRetentionDays,
  parseTimelineFilters,
  summarizeDevice,
  systemRowsRetentionDays,
  type TimelineItem,
} from './user-activity.logic.js';

const item = (id: string, at: string, over: Partial<TimelineItem> = {}): TimelineItem => ({
  id, at, source: 'activity', moduleCode: 'crm', moduleLabel: 'مشتریان', actionType: 'update', title: id, entityType: null, entityId: null, actorType: 'MANUAL', ...over,
});

describe('mergeTimelines', () => {
  it('ادغام چند منبع به‌ترتیب نزولی و برش به limit با nextCursor', () => {
    const a = [item('activity:a1', '2026-10-24T10:00:00Z'), item('activity:a2', '2026-10-24T08:00:00Z')];
    const b = [item('task:t1', '2026-10-24T09:00:00Z', { source: 'task' }), item('task:t2', '2026-10-24T07:00:00Z', { source: 'task' })];
    const r = mergeTimelines([a, b], { limit: 3 });
    expect(r.items.map((i) => i.id)).toEqual(['activity:a1', 'task:t1', 'activity:a2']);
    expect(r.nextCursor).not.toBeNull();
    const next = mergeTimelines([a, b], { limit: 3, cursor: decodeCursor(r.nextCursor) });
    expect(next.items.map((i) => i.id)).toEqual(['task:t2']);
    expect(next.nextCursor).toBeNull();
  });
  it('زمان برابر: ترتیب پایدار با شناسه و بدون تکرار/جاافتادگی بین صفحه‌ها', () => {
    const same = ['b', 'a', 'c'].map((x) => item(`activity:${x}`, '2026-10-24T10:00:00Z'));
    const p1 = mergeTimelines([same], { limit: 2 });
    const p2 = mergeTimelines([same], { limit: 2, cursor: decodeCursor(p1.nextCursor) });
    expect([...p1.items, ...p2.items].map((i) => i.id)).toEqual(['activity:c', 'activity:b', 'activity:a']);
  });
  it('اگر یک منبع پر باشد (anySourceFull) cursor باز هم داده می‌شود', () => {
    const r = mergeTimelines([[item('activity:x', '2026-10-24T10:00:00Z')]], { limit: 5, anySourceFull: true });
    expect(r.nextCursor).not.toBeNull();
    expect(mergeTimelines([[item('activity:x', '2026-10-24T10:00:00Z')]], { limit: 5 }).nextCursor).toBeNull();
  });
  it('cursor خراب نادیده گرفته می‌شود', () => {
    expect(decodeCursor('###')).toBeNull();
    expect(decodeCursor(encodeCursor(item('activity:z', '2026-10-24T10:00:00Z')))).toMatchObject({ id: 'activity:z' });
  });
});

describe('dedupeNearDuplicates', () => {
  it('لاگ HTTP همان وظیفه نزدیک به TaskEvent حذف می‌شود، نه ردیف دورتر/موجودیت دیگر', () => {
    const task = mapTaskEvent({ id: 'e1', taskId: 'T1', type: 'started', createdAt: new Date('2026-10-24T10:00:00Z') });
    const dup = item('activity:l1', '2026-10-24T10:00:02Z', { moduleCode: 'tasks', entityId: 'T1' });
    const far = item('activity:l2', '2026-10-24T10:10:00Z', { moduleCode: 'tasks', entityId: 'T1' });
    const other = item('activity:l3', '2026-10-24T10:00:01Z', { moduleCode: 'tasks', entityId: 'T2' });
    expect(dedupeNearDuplicates([task, dup, far, other]).map((i) => i.id)).toEqual(['task:e1', 'activity:l2', 'activity:l3']);
  });
});

describe('no payload leakage', () => {
  it('mapperها فقط فیلدهای ایمن را برمی‌گردانند', () => {
    const act = mapActivity({ id: '1', action: 'sales.invoices.updated', actorType: 'MANUAL', moduleCode: 'sales', actionType: 'update', summary: 'ویرایش فاکتور', entityType: 'invoice', entityId: 'i1', ip: '1.2.3.x', createdAt: new Date(), metadata: { secret: 'S' } } as never);
    expect(JSON.stringify(act)).not.toContain('secret');
    const rev = mapRevision({ id: 'r', entityType: 'sales_invoice', entityId: 'i1', revisionNo: 2, action: 'EDIT', createdAt: new Date(), before: { a: 1 }, after: { b: 2 }, reason: 'خصوصی' } as never);
    expect(JSON.stringify(rev)).not.toMatch(/خصوصی|"before"|"after"/);
    const sig = mapSignature({ id: 's', entityType: 'Contract', entityId: 'c1', action: 'SIGN', ip: '203.0.113.77', createdAt: new Date(), lat: 35.7, lng: 51.4, userAgent: 'UA', signerPhone: '0912' } as never);
    expect(sig.ip).toBe('203.0.113.x');
    expect(JSON.stringify(sig)).not.toMatch(/35\.7|0912|"UA"/);
  });
});

describe('parseDayParam / parseTimelineFilters', () => {
  it('تاریخ جلالی و میلادی به همان بازه‌ی UTC تهران تبدیل می‌شوند', () => {
    const g = parseDayParam('2026-10-24', false)!;
    const j = parseDayParam('1405-08-02', false)!; // 2026-10-24
    expect(j.toISOString()).toBe(g.toISOString());
    expect(g.toISOString()).toBe('2026-10-23T20:30:00.000Z');
    expect(parseDayParam('2026-10-24', true)!.getTime() - g.getTime()).toBe(86_400_000 - 1);
  });
  it('ورودی نامعتبر ۴۰۰', () => {
    expect(() => parseDayParam('abc', false)).toThrow();
    expect(() => parseTimelineFilters({ actionType: 'hack' })).toThrow();
    expect(() => parseTimelineFilters({ from: '2026-10-25', to: '2026-10-24' })).toThrow();
  });
  it('شناسه‌ها و متن پاک‌سازی می‌شوند', () => {
    const f = parseTimelineFilters({ module: 'crm; drop', entityId: 'abc-123', q: '  x '.repeat(80) });
    expect(f.module).toBeUndefined();
    expect(f.entityId).toBe('abc-123');
    expect(f.q!.length).toBeLessThanOrEqual(100);
  });
});

describe('CSV', () => {
  it('خنثی‌سازی فرمول و نقل‌قول', () => {
    expect(csvCellSafe('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCellSafe('+1')).toBe("'+1");
    expect(csvCellSafe('-2')).toBe("'-2");
    expect(csvCellSafe('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCellSafe('\tx')).toBe("'\tx");
    expect(csvCellSafe('a,b')).toBe('"a,b"');
  });
  it('CSV: عنوان‌های مخرب خنثی و ستون IP فقط برای مجاز', () => {
    const items = [item('activity:1', '2026-10-24T10:00:00Z', { title: '=cmd|calc', ip: '1.2.3.x' })];
    const withNet = buildTimelineCsv(items, { includeNetwork: true });
    expect(withNet).toContain("'=cmd|calc");
    expect(withNet).toContain('1.2.3.x');
    const without = buildTimelineCsv(items, { includeNetwork: false });
    expect(without).not.toContain('1.2.3.x');
    expect(without.split('\r\n')[0].split(',')).toHaveLength(7);
  });
});

describe('misc', () => {
  it('خلاصه‌ی دستگاه بدون UA خام', () => {
    expect(summarizeDevice('Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36')).toBe('Chrome · Android');
    expect(summarizeDevice(null)).toBeNull();
  });
  it('نگهداشت: پیش‌فرض برای همیشه', () => {
    expect(parseRetentionDays(undefined)).toBeNull();
    expect(parseRetentionDays('0')).toBeNull();
    expect(parseRetentionDays('10')).toBe(30);
    expect(parseRetentionDays('365')).toBe(365);
    expect(systemRowsRetentionDays(undefined)).toBe(180);
    expect(systemRowsRetentionDays('400')).toBe(400);
  });
});
