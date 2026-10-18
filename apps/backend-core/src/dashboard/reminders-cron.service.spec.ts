import { describe, expect, it, vi } from 'vitest';
import { RemindersCronService } from './reminders-cron.service.js';
import { DashboardRemindersService } from './dashboard-reminders.service.js';

type Row = Record<string, any>;

/** دیتابیس درون‌حافظه‌ی حداقلی برای dashboardReminder. */
function fakeDb(initial: Row[]) {
  const rows: Row[] = initial.map((r) => ({
    status: 'PENDING', snoozedUntil: null, leadMinutes: [0], alertsSentMin: [], repeatRule: 'NONE', nextSpawned: false,
    channels: ['IN_APP', 'PUSH'], allDay: false, firedAt: null, lastFiredAt: null, smsSentAt: null, note: null, seriesId: null,
    createdByUserId: 'u1', date: new Date(), ...r,
  }));
  const matchNot = (row: Row, not: any) => !not || !(not.alertsSentMin?.has !== undefined && row.alertsSentMin.includes(not.alertsSentMin.has));
  const model = {
    findMany: vi.fn(async (args: any) => {
      const w = args.where ?? {};
      return rows.filter((r) => (!w.status || r.status === w.status) && (!w.createdByUserId || r.createdByUserId === w.createdByUserId)
        && (w.alertsSentMin?.has === undefined || r.alertsSentMin.includes(w.alertsSentMin.has))
        && (w.repeatRule?.not === undefined || r.repeatRule !== w.repeatRule.not) && (w.nextSpawned === undefined || r.nextSpawned === w.nextSpawned)
        && (!w.OR || w.OR.some((c: any) => {
          if (c.snoozedUntil === null) return r.snoozedUntil === null && r.remindAt >= c.remindAt.gte && r.remindAt <= c.remindAt.lte;
          if (c.snoozedUntil?.gte) return r.snoozedUntil && r.snoozedUntil >= c.snoozedUntil.gte && r.snoozedUntil <= c.snoozedUntil.lte;
          return true;
        }))
        && (!w.remindAt?.lt || (r.remindAt < w.remindAt.lt && r.remindAt > w.remindAt.gt))
        && matchNot(r, w.NOT));
    }),
    updateMany: vi.fn(async (args: any) => {
      const w = args.where; let n = 0;
      for (const r of rows) {
        if (r.id !== w.id) continue;
        if (w.status && r.status !== w.status) continue;
        if (!matchNot(r, w.NOT)) continue;
        if (w.nextSpawned !== undefined && r.nextSpawned !== w.nextSpawned) continue;
        for (const [k, v] of Object.entries(args.data as Row)) {
          if (v && typeof v === 'object' && 'push' in v) r[k] = [...r[k], (v as any).push]; else r[k] = v;
        }
        n++;
      }
      return { count: n };
    }),
    update: vi.fn(async (args: any) => { const r = rows.find((x) => x.id === args.where.id)!; Object.assign(r, args.data); return r; }),
    findUnique: vi.fn(async (args: any) => rows.find((x) => x.id === args.where.id) ?? null),
    create: vi.fn(async (args: any) => { const r = { id: `n${rows.length}`, status: 'PENDING', snoozedUntil: null, nextSpawned: false, ...args.data }; rows.push(r); return r; }),
    count: vi.fn(async (args: any) => rows.filter((r) => r.createdByUserId === args.where.createdByUserId && r.smsSentAt && r.smsSentAt >= args.where.smsSentAt.gte).length),
    delete: vi.fn(),
  };
  const db: any = { dashboardReminder: model, $transaction: async (fn: any) => fn(db), user: { findUnique: vi.fn(async () => ({ id: 'u1' })) } };
  return { db, rows };
}

const NOW = new Date('2026-10-14T10:30:30Z');
const due = (o: Row = {}) => ({ id: 'a', title: 'تماس', remindAt: new Date('2026-10-14T10:30:00Z'), ...o });

function makeCron() {
  const notify = vi.fn(async (_db: unknown, _input: any) => {});
  const cron = new RemindersCronService({} as any, {} as any, { notify } as any);
  return { cron, notify };
}

describe('RemindersCronService.processTenant', () => {
  it('fires a due reminder once, even when the tick runs twice (idempotent)', async () => {
    const { db, rows } = fakeDb([due()]);
    const { cron, notify } = makeCron();
    await cron.processTenant(db, 't', NOW);
    await cron.processTenant(db, 't', new Date(NOW.getTime() + 60_000));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(rows[0].alertsSentMin).toEqual([0]);
    expect(rows[0].firedAt).toBeTruthy();
    expect(notify.mock.calls[0][1]).toMatchObject({ userId: 'u1', channels: { push: true, email: false, sms: false } });
  });

  it('two concurrent instances only deliver once (claim)', async () => {
    const { db } = fakeDb([due()]);
    const a = makeCron(); const b = makeCron();
    await Promise.all([a.cron.processTenant(db, 't', NOW), b.cron.processTenant(db, 't', NOW)]);
    expect(a.notify.mock.calls.length + b.notify.mock.calls.length).toBe(1);
  });

  it('does not fire before the time; fires pre-alerts at their offset', async () => {
    const { db } = fakeDb([due({ leadMinutes: [60, 0], alertsSentMin: [] })]);
    const { cron, notify } = makeCron();
    await cron.processTenant(db, 't', new Date('2026-10-14T09:29:00Z'));
    expect(notify).not.toHaveBeenCalled();
    await cron.processTenant(db, 't', new Date('2026-10-14T09:31:00Z'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1].title).toContain('1 ساعت دیگر');
  });

  it('catch-up after downtime within 1h; none after', async () => {
    const f1 = fakeDb([due()]); const c1 = makeCron();
    await c1.cron.processTenant(f1.db, 't', new Date('2026-10-14T11:20:00Z'));
    expect(c1.notify).toHaveBeenCalledTimes(1);
    const f2 = fakeDb([due()]); const c2 = makeCron();
    await c2.cron.processTenant(f2.db, 't', new Date('2026-10-14T11:40:00Z'));
    expect(c2.notify).not.toHaveBeenCalled();
  });

  it('spawns the next occurrence exactly once for repeats', async () => {
    const { db, rows } = fakeDb([due({ repeatRule: 'DAILY', seriesId: 'a' })]);
    const { cron } = makeCron();
    await cron.processTenant(db, 't', NOW);
    await cron.processTenant(db, 't', new Date(NOW.getTime() + 60_000));
    expect(rows).toHaveLength(2);
    expect(rows[1].remindAt.toISOString()).toBe('2026-10-15T10:30:00.000Z');
    expect(rows[0].nextSpawned).toBe(true);
    expect(rows[1].seriesId).toBe('a');
  });

  it('missed repeating reminder continues the chain silently', async () => {
    const { db, rows } = fakeDb([due({ repeatRule: 'DAILY' })]);
    const { cron, notify } = makeCron();
    const r = await cron.processTenant(db, 't', new Date('2026-10-14T15:00:00Z'));
    expect(notify).not.toHaveBeenCalled();
    expect(r.missed).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[1].remindAt.toISOString()).toBe('2026-10-15T10:30:00.000Z');
  });

  it('done reminders are never fired', async () => {
    const { db } = fakeDb([due({ status: 'DONE' })]);
    const { cron, notify } = makeCron();
    await cron.processTenant(db, 't', NOW);
    expect(notify).not.toHaveBeenCalled();
  });

  it('SMS only when selected and under the daily cap', async () => {
    const { db } = fakeDb([due({ channels: ['IN_APP', 'SMS'] })]);
    const { cron, notify } = makeCron();
    await cron.processTenant(db, 't', NOW);
    expect(notify.mock.calls[0][1].channels).toMatchObject({ sms: true, push: false });
    const capped = fakeDb([due({ channels: ['IN_APP', 'SMS'] }), ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, remindAt: new Date('2026-10-20T10:00:00Z'), smsSentAt: new Date('2026-10-14T08:00:00Z') }))]);
    const c = makeCron();
    await c.cron.processTenant(capped.db, 't', NOW);
    expect(c.notify.mock.calls[0][1].channels.sms).toBe(false);
  });

  it('snooze re-fires the main alarm once at the snoozed time', async () => {
    const { db, rows } = fakeDb([due({ alertsSentMin: [0], snoozedUntil: new Date('2026-10-14T10:40:00Z') })]);
    // snooze service clears 0; simulate
    rows[0].alertsSentMin = [];
    const { cron, notify } = makeCron();
    await cron.processTenant(db, 't', new Date('2026-10-14T10:39:00Z'));
    expect(notify).not.toHaveBeenCalled();
    await cron.processTenant(db, 't', new Date('2026-10-14T10:40:10Z'));
    await cron.processTenant(db, 't', new Date('2026-10-14T10:41:10Z'));
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe('DashboardRemindersService scope + snooze', () => {
  const ctxFor = (db: any, sub = 'g1') => ({ tenantDb: db, auth: { type: 'user', sub } }) as any;
  it('a user cannot edit, snooze, complete or delete someone else\'s reminder', async () => {
    const { db } = fakeDb([due({ createdByUserId: 'other' })]);
    const svc = new DashboardRemindersService();
    await expect(svc.update(ctxFor(db), 'a', { title: 'x' })).rejects.toThrow('یادآوری یافت نشد');
    await expect(svc.snooze(ctxFor(db), 'a', 10)).rejects.toThrow();
    await expect(svc.markDone(ctxFor(db), 'a')).rejects.toThrow();
    await expect(svc.remove(ctxFor(db), 'a')).rejects.toThrow();
  });
  it('snooze sets snoozedUntil and clears the main-alarm mark; done clears snooze', async () => {
    const { db, rows } = fakeDb([due({ alertsSentMin: [10, 0] })]);
    const svc = new DashboardRemindersService();
    const now = new Date('2026-10-14T10:31:00Z');
    await svc.snooze(ctxFor(db), 'a', 10, now);
    expect(rows[0].snoozedUntil.toISOString()).toBe('2026-10-14T10:41:00.000Z');
    expect(rows[0].alertsSentMin).toEqual([10]);
    await svc.markDone(ctxFor(db), 'a', now);
    expect(rows[0].status).toBe('DONE');
    expect(rows[0].snoozedUntil).toBeNull();
  });
  it('create stores Tehran wall-clock time and pre-marks past leads', async () => {
    const { db, rows } = fakeDb([]);
    const svc = new DashboardRemindersService();
    const view = await svc.create(ctxFor(db), { date: '2026-10-14', time: '14:00', title: 'جلسه', leadMinutes: [60, 0] }, new Date('2026-10-14T09:50:00Z'));
    expect(view.time).toBe('14:00');
    expect(rows[0].remindAt.toISOString()).toBe('2026-10-14T10:30:00.000Z');
    expect(rows[0].alertsSentMin).toEqual([60]);
  });
});
