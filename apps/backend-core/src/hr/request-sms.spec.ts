import { describe, expect, it, vi } from 'vitest';
import { HrRequestSmsService } from './request-sms.service.js';
import { LeaveController } from './leave.controller.js';
import { defaultHrSmsSettings, mergeHrSmsSettings, normalizeIranMobile, renderHrSms, sanitizeSmsValue, unknownHrSmsPlaceholders, validateHrSmsSettingsInput } from './request-sms.js';

function makeDb(opts: { settings?: unknown; userPhone?: string | null; tenantCount?: number; personCount?: number } = {}) {
  const claims = new Set<string>();
  const rows = new Map<string, any>();
  const db: any = {
    moduleSetting: { findUnique: vi.fn(async () => (opts.settings === undefined ? null : { value: opts.settings })), upsert: vi.fn() },
    user: { findUnique: vi.fn(async () => ({ phone: opts.userPhone ?? null })) },
    hrRequestSmsLog: {
      create: vi.fn(async ({ data }: any) => {
        if (claims.has(data.claimKey)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        claims.add(data.claimKey);
        const row = { id: `r${rows.size + 1}`, ...data };
        rows.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(rows.get(where.id), data)),
      count: vi.fn(async ({ where }: any) => (where.requesterEmployeeId ? (opts.personCount ?? 1) : (opts.tenantCount ?? 1))),
      findMany: vi.fn(async () => []),
    },
  };
  return { db, rows };
}

function makeService(sendResult: any = { success: true }) {
  const send = vi.fn(async () => sendResult);
  const control = { tenant: { findUnique: vi.fn(async () => ({ name: 'شرکت نمونه' })) } } as any;
  const svc = new HrRequestSmsService({ sendSms: send } as any, control);
  return { svc, send };
}

const emp = { id: 'e1', fullName: 'علی رضایی', phone: '09121234567', userId: 'u1' };
const base = { type: 'LEAVE_REQUEST' as const, requestId: 'L1', event: 'APPROVED' as const, employee: emp, fromDate: '۱۴۰۵/۰۸/۱۰', toDate: '۱۴۰۵/۰۸/۱۲', approverName: 'مدیر' };

describe('request-sms pure helpers', () => {
  it('renders known placeholders only, strips unknown, sanitizes values, single pass', () => {
    const out = renderHrSms('{{employeeName}} {{bogus}} {{note}}', { employeeName: 'علی\n{{orgName}}', note: '<b>x</b> http://evil.com y', orgName: 'HACK' });
    expect(out).not.toContain('bogus');
    expect(out).not.toContain('http');
    expect(out).not.toContain('<');
    expect(out).not.toContain('HACK'); // مقدار حاوی {{orgName}} دوباره جایگزین نمی‌شود
    expect(out).not.toContain('\n');
  });
  it('clips note and total length', () => {
    expect(renderHrSms('{{note}}', { note: 'ا'.repeat(200) }).length).toBeLessThanOrEqual(51);
    expect(renderHrSms('x'.repeat(1000), {}).length).toBeLessThanOrEqual(300);
    expect(sanitizeSmsValue('  a   b ')).toBe('a b');
  });
  it('normalizes Iranian mobiles incl. Persian digits; rejects junk', () => {
    expect(normalizeIranMobile('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
    expect(normalizeIranMobile('+989121234567')).toBe('09121234567');
    expect(normalizeIranMobile('02112345678')).toBeNull();
    expect(normalizeIranMobile('')).toBeNull();
  });
  it('defaults: leave approve/reject ON, submitted/cancelled OFF; settings validation', () => {
    const d = defaultHrSmsSettings();
    expect(d.enabled && d.types.LEAVE_REQUEST && d.events.APPROVED && d.events.REJECTED).toBe(true);
    expect(d.events.SUBMITTED || d.events.CANCELLED).toBe(false);
    expect(unknownHrSmsPlaceholders('{{salary}} {{note}}')).toEqual(['salary']);
    expect(validateHrSmsSettingsInput({ templates: { APPROVED: '{{salary}}' } as any })).toMatch(/ناشناخته/);
    expect(validateHrSmsSettingsInput({ dailyCap: 0 })).toMatch(/سقف/);
    expect(mergeHrSmsSettings({ templates: { APPROVED: '{{evil}}' }, enabled: 'x' }).templates.APPROVED).toBe(d.templates.APPROVED);
  });
  it('default templates contain no salary/amount placeholder', () => {
    expect(JSON.stringify(defaultHrSmsSettings().templates)).not.toMatch(/salary|amount|مبلغ|حقوق/);
  });
});

describe('HrRequestSmsService', () => {
  it('sends exactly one SMS per decision, idempotent on retry', async () => {
    const { db } = makeDb();
    const { svc, send } = makeService();
    const ctx = { tenantId: 't1', tenantDb: db };
    expect((await svc.notify(ctx, base)).status).toBe('SENT');
    expect((await svc.notify(ctx, base)).status).toBe('DUPLICATE');
    expect(send).toHaveBeenCalledTimes(1);
    const text = (send.mock.calls[0] as any[])[2] as string;
    expect(text).toContain('تأیید شد');
    expect(text).toContain('شرکت نمونه');
    expect(text).toContain('علی رضایی');
  });

  it('rejection includes clipped note; approval never does', async () => {
    const { db } = makeDb();
    const { svc, send } = makeService();
    await svc.notify({ tenantId: 't1', tenantDb: db }, { ...base, requestId: 'L2', event: 'REJECTED', note: 'ب'.repeat(300) });
    const t = (send.mock.calls[0] as any[])[2] as string;
    expect(t).toContain('رد شد');
    expect(t.length).toBeLessThan(300);
    await svc.notify({ tenantId: 't1', tenantDb: db }, { ...base, requestId: 'L3', event: 'APPROVED', note: 'SECRETNOTE' });
    expect(((send.mock.calls[1] as any[])[2] as string)).not.toContain('SECRETNOTE');
  });

  it('respects global, per-event and per-type toggles (no log row, no SMS)', async () => {
    for (const settings of [
      { enabled: false },
      { events: { APPROVED: false } },
      { types: { LEAVE_REQUEST: false } },
    ]) {
      const { db } = makeDb({ settings });
      const { svc, send } = makeService();
      expect((await svc.notify({ tenantId: 't1', tenantDb: db }, base)).status).toBe('DISABLED');
      expect(send).not.toHaveBeenCalled();
      expect(db.hrRequestSmsLog.create).not.toHaveBeenCalled();
    }
    // SUBMITTED is off by default, on when enabled
    const off = makeService();
    expect((await off.svc.notify({ tenantId: 't', tenantDb: makeDb().db }, { ...base, event: 'SUBMITTED' })).status).toBe('DISABLED');
    const on = makeService();
    expect((await on.svc.notify({ tenantId: 't', tenantDb: makeDb({ settings: { events: { SUBMITTED: true } } }).db }, { ...base, event: 'SUBMITTED' })).status).toBe('SENT');
  });

  it('missing/invalid phone: falls back to user phone, else skips with audit reason', async () => {
    const a = makeDb({ userPhone: '09351112233' });
    const s1 = makeService();
    await s1.svc.notify({ tenantId: 't', tenantDb: a.db }, { ...base, employee: { ...emp, phone: 'abc' } });
    expect((s1.send.mock.calls[0] as any[])[1]).toBe('09351112233');

    const b = makeDb({ userPhone: null });
    const s2 = makeService();
    const r = await s2.svc.notify({ tenantId: 't', tenantDb: b.db }, { ...base, employee: { ...emp, phone: null } });
    expect(r.status).toBe('SKIPPED');
    expect(s2.send).not.toHaveBeenCalled();
    expect([...b.rows.values()][0]).toMatchObject({ status: 'SKIPPED' });
  });

  it('daily caps (tenant and per person) skip the send', async () => {
    const t = makeDb({ tenantCount: 9999 });
    const s = makeService();
    expect((await s.svc.notify({ tenantId: 't', tenantDb: t.db }, base)).status).toBe('SKIPPED');
    expect(s.send).not.toHaveBeenCalled();
    const p = makeDb({ personCount: 99 });
    const s2 = makeService();
    expect((await s2.svc.notify({ tenantId: 't', tenantDb: p.db }, base)).status).toBe('SKIPPED');
    expect(s2.send).not.toHaveBeenCalled();
  });

  it('cap boundary: cap-1 prior sends still send, exactly cap prior sends skip (>=)', async () => {
    const ok = makeDb({ personCount: 4 });
    const s1 = makeService();
    expect((await s1.svc.notify({ tenantId: 't', tenantDb: ok.db }, base)).status).toBe('SENT');
    const at = makeDb({ personCount: 5 });
    const s2 = makeService();
    expect((await s2.svc.notify({ tenantId: 't', tenantDb: at.db }, base)).status).toBe('SKIPPED');
  });

  it('gateway failure is recorded, never thrown; thrown errors are swallowed', async () => {
    const { db, rows } = makeDb();
    const failing = makeService({ success: false, error: 'no credit' });
    await expect(failing.svc.notify({ tenantId: 't', tenantDb: db }, base)).resolves.toMatchObject({ status: 'FAILED' });
    expect([...rows.values()][0]).toMatchObject({ status: 'FAILED', reason: 'no credit' });

    const boom = makeDb();
    boom.db.moduleSetting.findUnique = vi.fn(async () => {
      throw new Error('db down');
    });
    await expect(makeService().svc.notify({ tenantId: 't', tenantDb: boom.db }, base)).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('log rows hold only a masked phone and no message text', async () => {
    const { db, rows } = makeDb();
    await makeService().svc.notify({ tenantId: 't', tenantDb: db }, base);
    const row = [...rows.values()][0];
    expect(row.maskedPhone).toMatch(/•••/);
    expect(JSON.stringify(row)).not.toContain('09121234567');
    expect(Object.keys(row)).not.toContain('message');
  });
});

describe('LeaveController -> decision SMS', () => {
  function leaveCtx() {
    const leave = { id: 'L9', employeeId: 'e1', status: 'PENDING', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-03'), daysCount: 3 };
    return {
      auth: { role: 'OWNER', sub: 'g1' },
      tenantId: 't1',
      tenantDb: {
        leaveRequest: {
          findUnique: vi.fn(async () => leave),
          update: vi.fn(async ({ data }: any) => ({ ...leave, ...data, employee: { id: 'e1', fullName: 'علی', employeeCode: '1', userId: 'u1', phone: '09121234567' } })),
        },
        user: { findUnique: vi.fn(async () => ({ id: 'u1', name: 'مدیر' })) },
      },
    } as any;
  }
  function makeController(hrSms: any, notifications: any = { notify: vi.fn() }) {
    const approvals = { closeForEntity: vi.fn(), registerHandler: vi.fn() } as any;
    return new (LeaveController as any)(notifications, {}, { emit: vi.fn() }, approvals, hrSms) as LeaveController;
  }

  it('approve triggers exactly one SMS + in-app with entity/category', async () => {
    const hrSms = { notify: vi.fn(async () => ({ status: 'SENT' })) };
    const notifications = { notify: vi.fn() };
    const c = makeController(hrSms, notifications);
    await c.approve('L9', leaveCtx());
    expect(hrSms.notify).toHaveBeenCalledTimes(1);
    expect((hrSms.notify.mock.calls[0] as any[])[1]).toMatchObject({ type: 'LEAVE_REQUEST', requestId: 'L9', event: 'APPROVED' });
    expect((notifications.notify.mock.calls[0] as any[])[1]).toMatchObject({ entityType: 'LEAVE_REQUEST', entityId: 'L9', category: 'approvals' });
  });

  it('reject passes the note; an SMS failure never blocks the decision', async () => {
    const hrSms = { notify: vi.fn(async () => { throw new Error('gateway down'); }) };
    const c = makeController(hrSms);
    const out: any = await c.reject('L9', leaveCtx(), { note: 'ظرفیت نیست' });
    expect(out.status).toBe('REJECTED');
    expect((hrSms.notify.mock.calls[0] as any[])[1]).toMatchObject({ event: 'REJECTED', note: 'ظرفیت نیست' });
  });
});
