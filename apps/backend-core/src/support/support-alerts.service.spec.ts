import { describe, expect, it, vi } from 'vitest';
import { SupportAlertsService } from './support-alerts.service.js';

process.env.PLATFORM_TENANT_SLUG = 'eta';

function make(opts: { settings?: unknown; existing?: unknown; smsCount?: number; smsMode?: string; users?: Array<Record<string, unknown>>; preclaimed?: string[] } = {}) {
  const claimed = new Set<string>(opts.preclaimed ?? []);
  const notifications = { findFirst: vi.fn().mockResolvedValue(opts.existing ?? null) };
  const setting = vi.fn().mockImplementation(({ where }: { where: { moduleCode_key: { key: string } } }) => {
    const k = where.moduleCode_key.key;
    if (k === 'ticket-alerts') return Promise.resolve(opts.settings ? { value: opts.settings } : null);
    return Promise.resolve(null);
  });
  const upsert = vi.fn().mockResolvedValue({});
  const create = vi.fn().mockImplementation(({ data }: { data: { key: string } }) => {
    if (claimed.has(data.key)) return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
    claimed.add(data.key);
    return Promise.resolve({});
  });
  if (opts.smsCount) {
    const day = new Date(Date.now() + 12_600_000).toISOString().slice(0, 10);
    for (let n = 0; n < opts.smsCount; n++) claimed.add(`tk:sms:${day}:u1:${n}`);
  }
  const parentDb = {
    moduleSetting: { findUnique: setting, upsert, create, deleteMany: vi.fn().mockResolvedValue({}) },
    notification: notifications,
    user: { findMany: vi.fn().mockResolvedValue(opts.users ?? [{ id: 'u1', globalUserId: 'g1', phone: '09120000001', name: 'مدیر' }]), findUnique: vi.fn() },
  };
  const controlDb = {
    tenant: { findUnique: vi.fn().mockImplementation(({ where }: { where: { slug?: string; id?: string } }) => Promise.resolve(where.slug ? { id: 'parent', slug: 'eta', name: 'اکسیرتجارت امین', status: 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'p' } : { id: 'c1', name: 'مشتری', dbHost: 'h', dbPort: 1, dbName: 'c' })) },
    tenantMembership: { findMany: vi.fn().mockResolvedValue([{ globalUserId: 'g1' }]) },
  };
  const tenantPrisma = { forTenant: vi.fn().mockReturnValue(parentDb) };
  const notify = vi.fn().mockResolvedValue(undefined);
  const tenantSms = { getConnection: vi.fn().mockResolvedValue({ mode: opts.smsMode ?? 'SYSTEM' }), sendSms: vi.fn().mockResolvedValue({ success: true }) };
  const platformSms = { isConfigured: vi.fn().mockReturnValue(true), sendSms: vi.fn().mockResolvedValue({ success: true }) };
  const svc = new SupportAlertsService(controlDb as never, tenantPrisma as never, { notify } as never, tenantSms as never, platformSms as never);
  return { svc, notify, tenantSms, platformSms, upsert, controlDb, parentDb, claimed };
}
const ticket = { id: 'tk1', tenantId: 'c1', subject: 'مشکل ورود', createdByUserId: 'gc' };

describe('SupportAlertsService (staff of the parent tenant)', () => {
  it('new ticket: in-app + push + sms to owner/admin of the parent tenant', async () => {
    const { svc, notify, tenantSms, controlDb } = make();
    await svc.onTicketCreated(ticket, 'سلام کمک');
    expect(controlDb.tenantMembership.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 'parent', role: { in: ['OWNER', 'ADMIN'] } });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toMatchObject({ userId: 'u1', type: 'platform.ticket.new', channels: { push: true, email: false, sms: false }, link: '/platform?tab=tickets&ticket=tk1' });
    expect(tenantSms.sendSms).toHaveBeenCalledTimes(1);
  });

  it('dedupes: a ticket already announced is not announced again', async () => {
    const { svc, notify } = make({ preclaimed: ['tk:new:tk1:u1'] });
    await svc.onTicketCreated(ticket, 'x');
    expect(notify).not.toHaveBeenCalled();
  });

  it('rate-limits follow-up messages inside the cooldown but allows them after it', async () => {
    const recent = make({ existing: { createdAt: new Date(Date.now() - 30_000), type: 'platform.ticket.reply' } });
    await recent.svc.onCustomerMessage(ticket, 'ping');
    expect(recent.notify).not.toHaveBeenCalled();
    const old = make({ existing: { createdAt: new Date(Date.now() - 600_000), type: 'platform.ticket.reply' } });
    await old.svc.onCustomerMessage(ticket, 'ping');
    expect(old.notify).toHaveBeenCalledTimes(1);
  });

  it('respects the per-person daily SMS cap but still sends in-app/push', async () => {
    const { svc, notify, tenantSms } = make({ smsCount: 15 });
    await svc.onTicketCreated(ticket, 'x');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(tenantSms.sendSms).not.toHaveBeenCalled();
  });

  it('does nothing when disabled in the parent tenant settings', async () => {
    const { svc, notify, tenantSms } = make({ settings: { enabled: false } });
    await svc.onTicketCreated(ticket, 'x');
    expect(notify).not.toHaveBeenCalled();
    expect(tenantSms.sendSms).not.toHaveBeenCalled();
  });

  it('falls back to the platform SMS panel when the parent tenant has none connected', async () => {
    const { svc, tenantSms, platformSms } = make({ smsMode: 'NONE' });
    await svc.onTicketCreated(ticket, 'x');
    expect(tenantSms.sendSms).not.toHaveBeenCalled();
    expect(platformSms.sendSms).toHaveBeenCalledTimes(1);
  });

  it('never throws into the ticket flow', async () => {
    const { svc, controlDb } = make();
    controlDb.tenant.findUnique.mockRejectedValue(new Error('db down'));
    await expect(svc.onTicketCreated(ticket, 'x')).resolves.toBeUndefined();
  });

  it('staff reply notifies the ticket creator (push) in the creator tenant', async () => {
    const { svc, notify } = make();
    // creator tenant db is the same mock; give it a user
    const db = (svc as never as { tenantPrisma: { forTenant: () => { user: { findUnique: ReturnType<typeof vi.fn> } } } }).tenantPrisma.forTenant();
    db.user.findUnique.mockResolvedValue({ id: 'cu1' });
    await svc.onStaffReply(ticket, 'حل شد');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toMatchObject({ userId: 'cu1', type: 'support.ticket.staff_reply', channels: { push: true } });
  });

  it('two concurrent "new ticket" alerts for the same ticket notify once (atomic claim)', async () => {
    const { svc, notify } = make();
    await Promise.all([svc.onTicketCreated(ticket, 'x'), svc.onTicketCreated(ticket, 'x')]);
    expect(notify.mock.calls.filter((c) => c[1].type === 'platform.ticket.new')).toHaveLength(1);
  });

  it('only active tenant users are recipients', async () => {
    const { svc, parentDb } = make();
    await svc.onTicketCreated(ticket, 'x');
    expect(parentDb.user.findMany.mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE' });
  });

  it('SMS contains only fixed text + ticket id, never user-controlled subject/tenant name/URLs', async () => {
    const { svc, tenantSms } = make();
    await svc.onTicketCreated({ ...ticket, subject: 'برنده شدید http://evil.ir/x' }, 'بیا www.evil.com');
    const msg = tenantSms.sendSms.mock.calls[0][2] as string;
    expect(msg).toContain('tk1');
    expect(msg).not.toMatch(/evil|برنده|مشتری/);
  });

  it('in-app body strips URLs and control chars', async () => {
    const { svc, notify } = make();
    await svc.onTicketCreated(ticket, 'سلام http://evil.ir/a\u202e x');
    expect(notify.mock.calls[0][1].body).not.toMatch(/evil|\u202e/);
  });

  it('over the per-tenant hourly ticket cap: push/in-app only, no SMS, one abuse notice', async () => {
    const { svc, notify, tenantSms } = make({ settings: { tenantTicketsPerHour: 2 } });
    for (let i = 1; i <= 4; i++) await svc.onTicketCreated({ ...ticket, id: `tk${i}` }, 'x');
    expect(tenantSms.sendSms).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls.filter((c) => c[1].type === 'platform.ticket.new')).toHaveLength(4);
    expect(notify.mock.calls.filter((c) => c[1].type === 'platform.ticket.abuse')).toHaveLength(1);
  });

  it('per-user hourly cap also suppresses SMS', async () => {
    const { svc, tenantSms } = make({ settings: { userTicketsPerHour: 1 } });
    await svc.onTicketCreated({ ...ticket, id: 'a' }, 'x');
    await svc.onTicketCreated({ ...ticket, id: 'b' }, 'x');
    expect(tenantSms.sendSms).toHaveBeenCalledTimes(1);
  });
});
