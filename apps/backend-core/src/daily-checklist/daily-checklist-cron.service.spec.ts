import { describe, expect, it, vi } from 'vitest';
import { DailyChecklistCronService } from './daily-checklist-cron.service.js';

const NOW = new Date('2026-09-25T20:40:00Z'); // ۲۳:۵۰ تهران — امروز = ۲۰۲۶-۰۹-۲۶ تهران
const TODAY = new Date('2026-09-26T00:00:00.000Z');
const TOMORROW = new Date('2026-09-27T00:00:00.000Z');

function makeDb(opts: { marker?: unknown; items: Array<Record<string, unknown>>; attachments?: Array<Record<string, unknown>> }) {
  const attachments = opts.attachments ?? [];
  return {
    attachment: {
      findMany: vi.fn(async ({ where }: any) =>
        attachments.filter((a) => (where.entityType ? a.entityType === where.entityType : true) && (where.entityId?.in ? where.entityId.in.includes(a.entityId) : where.entityId ? a.entityId === where.entityId : true) && (where.sourceAttachmentId ? a.sourceAttachmentId != null : true)),
      ),
      findUnique: vi.fn(async ({ where }: any) => attachments.find((a) => a.id === where.id) ?? null),
      update: vi.fn().mockResolvedValue({}),
      createMany: vi.fn(async ({ data }: any) => {
        for (const d of data) if (!attachments.some((a) => a.entityType === d.entityType && a.entityId === d.entityId && a.sourceAttachmentId === d.sourceAttachmentId)) attachments.push({ id: `c${attachments.length}`, ...d });
        return { count: data.length };
      }),
    },
    dailyChecklistItem: {
      groupBy: vi.fn().mockResolvedValue([{ userId: 'u1', date: TODAY }]),
      findMany: vi.fn(async (args?: { where?: { done?: boolean } }) => (args?.where?.done === false ? opts.items.filter((i) => !i.done) : opts.items)),
      findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    dailyChecklistDayClose: {
      findUnique: vi.fn().mockResolvedValue(opts.marker ?? null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ name: 'علی' }) },
    report: { create: vi.fn().mockResolvedValue({ id: 'r1' }), update: vi.fn().mockResolvedValue({ id: 'manual' }) },
  };
}

function makeService() {
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  return { service: new DailyChecklistCronService({} as never, {} as never, notifications as never, {} as never, {} as never), notifications };
}

describe('DailyChecklistCronService — end of day', () => {
  const items = [
    { id: 'a', title: 'انجام‌شده', description: null, done: true, createdByUserId: 'u1' },
    { id: 'b', title: 'مانده', description: 'جزئیات', done: false, createdByUserId: 'u1' },
  ];

  it('auto-files the report and carries pending items to tomorrow flagged as carried over', async () => {
    const db = makeDb({ items });
    const { service, notifications } = makeService();
    expect(await service.closeDays(db as never, true, NOW)).toBe(1);

    expect(db.report.create).toHaveBeenCalledTimes(1);
    expect(db.report.create.mock.calls[0][0].data.body).toContain('انجام‌شده');
    const created = db.dailyChecklistItem.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ userId: 'u1', title: 'مانده', carriedOver: true, date: TOMORROW });
    expect(db.dailyChecklistDayClose.upsert.mock.calls[0][0].create).toMatchObject({ rolledOver: true, auto: true, reportId: 'r1' });
    expect(notifications.notify).toHaveBeenCalled();
  });

  it('refreshes (not duplicates) a report the user already submitted manually mid-day, and still rolls pending items over', async () => {
    const db = makeDb({ items, marker: { reportId: 'manual', rolledOver: false } });
    const { service } = makeService();
    await service.closeDays(db as never, true, NOW);
    expect(db.report.create).not.toHaveBeenCalled();
    // این دقیقاً همان چیزی است که کاربر خواسته بود: حتی اگر گزارش دستیِ میان‌روزی از قبل
    // ثبت شده باشد، بستنِ واقعیِ آخر شب باید محتوای آن را با وضعیت نهایی به‌روز کند، نه
    // این‌که همان نسخه‌ی نیمه‌کاره را دست‌نخورده رها کند.
    expect(db.report.update).toHaveBeenCalledTimes(1);
    expect(db.report.update.mock.calls[0][0]).toMatchObject({ where: { id: 'manual' } });
    expect(db.report.update.mock.calls[0][0].data.body).toContain('انجام‌شده');
    expect(db.dailyChecklistItem.createMany).toHaveBeenCalledTimes(1);
    expect(db.dailyChecklistDayClose.upsert.mock.calls[0][0].create).toMatchObject({ reportId: 'manual', auto: false });
  });

  it('skips a day that was already closed (idempotent)', async () => {
    const db = makeDb({ items, marker: { reportId: 'r0', rolledOver: true } });
    const { service } = makeService();
    expect(await service.closeDays(db as never, true, NOW)).toBe(0);
    expect(db.report.create).not.toHaveBeenCalled();
    expect(db.dailyChecklistItem.createMany).not.toHaveBeenCalled();
  });

  it('the catch-up run (00:30) only looks at yesterday, never at the current day', async () => {
    const db = makeDb({ items });
    const { service } = makeService();
    await service.closeDays(db as never, false, NOW);
    const where = db.dailyChecklistItem.groupBy.mock.calls[0][0].where.date;
    expect(where.lte.toISOString()).toBe('2026-09-25T00:00:00.000Z');
  });

  it('archives item files into the report and lists them in the body; closing again does not duplicate them', async () => {
    const attachments: Array<Record<string, unknown>> = [
      { id: 'f1', entityType: 'DailyChecklistItem', entityId: 'a', title: 'رسید بانک', fileUrl: 'data:application/pdf;base64,AAAA' },
    ];
    const db = makeDb({ items, attachments });
    const { service } = makeService();
    await service.closeDays(db as never, true, NOW);
    expect(db.report.create.mock.calls[0][0].data.body).toContain('- رسید بانک (مربوط به: انجام‌شده)');
    expect(attachments.filter((a) => a.entityType === 'Report')).toHaveLength(1);

    // بستن دوباره‌ی همان روز با گزارش موجود (مسیر update) → همچنان یک نسخه
    const db2 = makeDb({ items, attachments, marker: { reportId: 'r1', rolledOver: false } });
    await service.closeDays(db2 as never, true, NOW);
    expect(attachments.filter((a) => a.entityType === 'Report')).toHaveLength(1);
  });
});
