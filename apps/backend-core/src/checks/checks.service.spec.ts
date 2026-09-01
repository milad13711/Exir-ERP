import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChecksService } from './checks.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

function makeTenantDb(overrides: Record<string, unknown> = {}) {
  const checkUpdateCalls: Array<Record<string, unknown>> = [];
  const contactUpdateCalls: Array<Record<string, unknown>> = [];

  const tenantDb = {
    check: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn((args: { data: Record<string, unknown> }) => {
        checkUpdateCalls.push(args.data);
        return Promise.resolve({ id: 'chk-1', ...args.data });
      }),
    },
    crmContact: {
      update: vi.fn((args: { data: Record<string, unknown> }) => {
        contactUpdateCalls.push(args.data);
        return Promise.resolve({ id: 'contact-1', ...args.data });
      }),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
  return { tenantDb, checkUpdateCalls, contactUpdateCalls };
}

function makeCtx(tenantDb: unknown): TenantRequestContext {
  return { tenantDb, auth: { type: 'user', sub: 'global-1' }, tenantId: 't1' } as unknown as TenantRequestContext;
}

const controlDbStub = { tenantMembership: { findMany: vi.fn().mockResolvedValue([]) } };
const smsStub = { isConfigured: vi.fn().mockReturnValue(false), sendSms: vi.fn() };
const notificationsStub = { notify: vi.fn().mockResolvedValue(undefined) };

describe('ChecksService — status transitions', () => {
  let service: ChecksService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new ChecksService(controlDbStub as never, smsStub as never, notificationsStub as never);
  });

  it('markDeposited moves PENDING to DEPOSITED', async () => {
    const { tenantDb, checkUpdateCalls } = makeTenantDb();
    tenantDb.check.findUnique.mockResolvedValue({ id: 'chk-1', status: 'PENDING' });
    await service.markDeposited(makeCtx(tenantDb), 'chk-1');
    expect(checkUpdateCalls[0]).toMatchObject({ status: 'DEPOSITED' });
  });

  it('markDeposited refuses a check that is not PENDING', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.check.findUnique.mockResolvedValue({ id: 'chk-1', status: 'DEPOSITED' });
    await expect(service.markDeposited(makeCtx(tenantDb), 'chk-1')).rejects.toThrow();
  });

  it('markCleared works from PENDING', async () => {
    const { tenantDb, checkUpdateCalls } = makeTenantDb();
    tenantDb.check.findUnique.mockResolvedValue({ id: 'chk-1', status: 'PENDING' });
    await service.markCleared(makeCtx(tenantDb), 'chk-1');
    expect(checkUpdateCalls[0]).toMatchObject({ status: 'CLEARED' });
  });

  it('markCleared works from DEPOSITED', async () => {
    const { tenantDb, checkUpdateCalls } = makeTenantDb();
    tenantDb.check.findUnique.mockResolvedValue({ id: 'chk-1', status: 'DEPOSITED' });
    await service.markCleared(makeCtx(tenantDb), 'chk-1');
    expect(checkUpdateCalls[0]).toMatchObject({ status: 'CLEARED' });
  });

  it('markCleared refuses an already-cleared or cancelled check', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.check.findUnique.mockResolvedValue({ id: 'chk-1', status: 'CLEARED' });
    await expect(service.markCleared(makeCtx(tenantDb), 'chk-1')).rejects.toThrow();
  });

  it('cancel works from PENDING or DEPOSITED but not from a terminal state', async () => {
    const { tenantDb: db1, checkUpdateCalls } = makeTenantDb();
    db1.check.findUnique.mockResolvedValue({ id: 'chk-1', status: 'PENDING' });
    await service.cancel(makeCtx(db1), 'chk-1');
    expect(checkUpdateCalls[0]).toMatchObject({ status: 'CANCELLED' });

    const { tenantDb: db2 } = makeTenantDb();
    db2.check.findUnique.mockResolvedValue({ id: 'chk-1', status: 'BOUNCED' });
    await expect(service.cancel(makeCtx(db2), 'chk-1')).rejects.toThrow();
  });
});

describe('ChecksService.markBounced', () => {
  let service: ChecksService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new ChecksService(controlDbStub as never, smsStub as never, notificationsStub as never);
  });

  it('flags the customer credit record for a bounced RECEIVED check', async () => {
    const { tenantDb, contactUpdateCalls } = makeTenantDb();
    const checkRow = {
      id: 'chk-1',
      status: 'PENDING',
      direction: 'RECEIVED',
      contactId: 'contact-1',
      contact: { name: 'رضا احمدی' },
      sayadId: '123',
      amount: 1000,
    };
    tenantDb.check.findUnique.mockResolvedValue(checkRow);
    // The real Prisma update returns the full row (unselected fields included);
    // this mock's default only spreads args.data, so merge with the original here.
    tenantDb.check.update.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...checkRow, ...args.data }),
    );
    tenantDb.check.findUniqueOrThrow.mockResolvedValue({ id: 'chk-1', status: 'BOUNCED' });

    await service.markBounced(makeCtx(tenantDb), 'chk-1');

    expect(contactUpdateCalls[0]).toMatchObject({ hasBouncedChecks: true });
  });

  it('does not touch CrmContact for a bounced ISSUED check', async () => {
    const { tenantDb, contactUpdateCalls } = makeTenantDb();
    const checkRow = {
      id: 'chk-1',
      status: 'PENDING',
      direction: 'ISSUED',
      contactId: 'sup-1',
      contact: { name: 'تأمین‌کننده الف' },
      sayadId: '456',
      amount: 2000,
    };
    tenantDb.check.findUnique.mockResolvedValue(checkRow);
    tenantDb.check.update.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...checkRow, ...args.data }),
    );
    tenantDb.check.findUniqueOrThrow.mockResolvedValue({ id: 'chk-1', status: 'BOUNCED' });

    await service.markBounced(makeCtx(tenantDb), 'chk-1');

    expect(contactUpdateCalls).toHaveLength(0);
  });

  it('refuses to bounce a check that is already CLEARED', async () => {
    const { tenantDb } = makeTenantDb();
    tenantDb.check.findUnique.mockResolvedValue({ id: 'chk-1', status: 'CLEARED' });
    await expect(service.markBounced(makeCtx(tenantDb), 'chk-1')).rejects.toThrow();
  });

  it('sends an in-app+email notification and SMS to every owner/admin', async () => {
    const { tenantDb } = makeTenantDb({
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'tu-1', globalUserId: 'gu-1', name: 'مدیر' }]) },
    });
    tenantDb.check.findUnique.mockResolvedValue({
      id: 'chk-1',
      status: 'PENDING',
      direction: 'RECEIVED',
      contactId: 'contact-1',
      contact: { name: 'رضا احمدی' },
      sayadId: '123',
      amount: 1000,
    });
    tenantDb.check.findUniqueOrThrow.mockResolvedValue({ id: 'chk-1', status: 'BOUNCED' });

    controlDbStub.tenantMembership.findMany = vi
      .fn()
      .mockResolvedValue([{ globalUserId: 'gu-1', globalUser: { id: 'gu-1', phone: '0912xxx' } }]);
    smsStub.isConfigured = vi.fn().mockReturnValue(true);

    await service.markBounced(makeCtx(tenantDb), 'chk-1');

    expect(notificationsStub.notify).toHaveBeenCalledWith(
      tenantDb,
      expect.objectContaining({ userId: 'tu-1', type: 'check.bounced' }),
    );
    expect(smsStub.sendSms).toHaveBeenCalledWith('0912xxx', expect.stringContaining('هشدار فوری'));
  });

  it('skips SMS when the tenant has no SMS gateway configured', async () => {
    const { tenantDb } = makeTenantDb({
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'tu-1', globalUserId: 'gu-1', name: 'مدیر' }]) },
    });
    tenantDb.check.findUnique.mockResolvedValue({
      id: 'chk-1',
      status: 'PENDING',
      direction: 'ISSUED',
      contactId: 'sup-1',
      contact: { name: 'تأمین‌کننده' },
      sayadId: '789',
      amount: 500,
    });
    tenantDb.check.findUniqueOrThrow.mockResolvedValue({ id: 'chk-1', status: 'BOUNCED' });
    controlDbStub.tenantMembership.findMany = vi
      .fn()
      .mockResolvedValue([{ globalUserId: 'gu-1', globalUser: { id: 'gu-1', phone: '0912xxx' } }]);
    smsStub.isConfigured = vi.fn().mockReturnValue(false);
    smsStub.sendSms = vi.fn();

    await service.markBounced(makeCtx(tenantDb), 'chk-1');

    expect(smsStub.sendSms).not.toHaveBeenCalled();
    expect(notificationsStub.notify).toHaveBeenCalled();
  });
});
