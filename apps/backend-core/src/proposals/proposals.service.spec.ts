import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProposalsService } from './proposals.service.js';
import { proposalScope } from '../permissions/entity-scopes.js';
import type { TenantRequestContext } from '../common/request-context.js';

const SCOPE = { OR: [{ createdByUserId: 'me' }, { assignedUserId: 'me' }] };

function baseProposal(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    proposalNo: 7,
    title: 'سایت فروشگاهی',
    contactId: 'c1',
    dealId: null,
    status: 'ACCEPTED',
    amount: 50_000_000,
    bankInfo: '6037-1111-2222-3333',
    paymentTerms: '۵۰٪ پیش‌پرداخت',
    paymentMethodText: 'کارت به کارت',
    paymentDeadline: '۷ روز',
    paymentDueAt: new Date('2026-11-01T00:00:00.000Z'),
    invoiceLines: null,
    invoiceId: null,
    invoicedAt: null,
    sentAt: new Date(),
    validUntil: null,
    ...over,
  };
}

function make(opts: { found?: boolean; proposal?: Record<string, unknown>; salesEnabled?: boolean; defaultBank?: string; smsOk?: boolean } = {}) {
  const proposal = baseProposal(opts.proposal);
  const db: Record<string, any> = {
    proposal: {
      findFirst: vi.fn(async () => (opts.found === false ? null : proposal)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...proposal, ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => []),
      delete: vi.fn(async () => proposal),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...proposal, ...data, id: 'new' })),
    },
    proposalEvent: { create: vi.fn(async () => ({})) },
    proposalComment: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
    crmActivity: { create: vi.fn(async () => ({})) },
    crmContact: { findFirst: vi.fn(async () => ({ id: 'c1' })) },
    crmDeal: { findFirst: vi.fn(async () => ({ id: 'd1' })) },
    attachment: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    user: { findUnique: vi.fn(async () => ({ id: 'me', name: 'علی' })) },
    task: { create: vi.fn(async () => ({})) },
    salesInvoice: { findUnique: vi.fn(async () => null) },
  };
  const ctx = { tenantId: 't1', tenantSlug: 'acme', tenantDb: db, auth: { role: 'MEMBER', sub: 'g1' } } as unknown as TenantRequestContext;
  const controlDb = {
    tenant: { findUnique: vi.fn(async () => ({ name: 'اکسیر' })) },
    moduleDefinition: { findUnique: vi.fn(async () => ({ id: 'm-sales', isCore: false })) },
    tenantModule: { findFirst: vi.fn(async () => (opts.salesEnabled === false ? null : { status: 'INSTALLED' })) },
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const sms = { sendSms: vi.fn(async () => (opts.smsOk === false ? { success: false, error: 'اعتبار نیست' } : { success: true })) };
  const invoices = {
    create: vi.fn(async (..._a: unknown[]) => ({ id: 'inv1', invoiceNo: 31 })),
    getDefaultBankInfo: vi.fn(async () => opts.defaultBank ?? ''),
  };
  const svc = new ProposalsService(controlDb as never, notifications as never, sms as never, invoices as never);
  return { svc, ctx, db, invoices, sms, notifications, controlDb };
}

// resolveTenantUserId reads ctx.tenantDb.user.findUnique -> { id: 'me' }

describe('ProposalsService — scope enforcement on every by-id action', () => {
  const calls: Array<[string, (s: ProposalsService, c: TenantRequestContext) => Promise<unknown>]> = [
    ['detail', (s, c) => s.detail(c, 'p1', SCOPE)],
    ['update', (s, c) => s.update(c, 'p1', { title: 'x y' }, SCOPE, {})],
    ['remove', (s, c) => s.remove(c, 'p1', SCOPE)],
    ['setStatus', (s, c) => s.setStatus(c, 'p1', 'SENT', undefined, SCOPE)],
    ['updateStatusNote', (s, c) => s.updateStatusNote(c, 'p1', 'n', SCOPE)],
    ['assign', (s, c) => s.assign(c, 'p1', { userId: 'u2' }, SCOPE)],
    ['addStaffComment', (s, c) => s.addStaffComment(c, 'p1', 'hi', SCOPE)],
    ['shareLink', (s, c) => s.shareLink(c, 'p1', SCOPE, 'https://app')],
    ['smsPreview', (s, c) => s.smsPreview(c, 'p1', SCOPE, 'https://app')],
    ['sendSms', (s, c) => s.sendSms(c, 'p1', SCOPE, 'https://app')],
    ['issueInvoice', (s, c) => s.issueInvoice(c, 'p1', {}, SCOPE)],
  ];

  for (const [name, call] of calls) {
    it(`${name}: an out-of-scope proposal is a 404 and nothing is written`, async () => {
      const { svc, ctx, db, invoices, sms } = make({ found: false });
      await expect(call(svc, ctx)).rejects.toBeInstanceOf(NotFoundException);
      expect(db.proposal.update).not.toHaveBeenCalled();
      expect(db.proposal.delete).not.toHaveBeenCalled();
      expect(db.proposal.updateMany).not.toHaveBeenCalled();
      expect(invoices.create).not.toHaveBeenCalled();
      expect(sms.sendSms).not.toHaveBeenCalled();
      // scope is part of the query, merged with the id
      expect(db.proposal.findFirst.mock.calls[0][0].where).toEqual({ AND: [{ id: 'p1' }, SCOPE] });
    });
  }

  it('list merges the view scope with the search (AND, so the scope OR is never overridden)', async () => {
    const { svc, ctx, db } = make();
    await svc.list(ctx, SCOPE, { q: 'علی', status: 'SENT' });
    const where = db.proposal.findMany.mock.calls.at(-1)![0].where;
    expect(where.AND[0]).toEqual(SCOPE);
    expect(JSON.stringify(where.AND)).toContain('contact');
    expect(where.AND).toContainEqual({ status: 'SENT' });
  });

  it('create refuses a contact outside the caller\'s CRM scope', async () => {
    const { svc, ctx, db } = make();
    db.crmContact.findFirst.mockResolvedValueOnce(null as never);
    await expect(svc.create(ctx, { title: 'عنوان', contactId: 'c9' }, { ownerUserId: 'me' })).rejects.toBeInstanceOf(NotFoundException);
    expect(db.proposal.create).not.toHaveBeenCalled();
  });
});

describe('ProposalsService — status rules', () => {
  it('an accepted proposal is locked: no edit, no manual status change, no delete-bypass of notes', async () => {
    const { svc, ctx } = make();
    await expect(svc.update(ctx, 'p1', { title: 'تغییر' }, {}, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.setStatus(ctx, 'p1', 'REJECTED', undefined, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('status note stays editable on an accepted proposal', async () => {
    const { svc, ctx, db } = make();
    await svc.updateStatusNote(ctx, 'p1', 'پیگیری شد', {});
    expect(db.proposal.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { statusNote: 'پیگیری شد' } });
  });

  it('manual ACCEPTED is recorded as manual and logs to the customer history', async () => {
    const { svc, ctx, db } = make({ proposal: { status: 'SENT' } });
    await svc.setStatus(ctx, 'p1', 'ACCEPTED', undefined, {});
    const data = db.proposal.update.mock.calls[0][0].data;
    expect(data.status).toBe('ACCEPTED');
    expect(data.acceptedManually).toBe(true);
    expect(db.crmActivity.create).toHaveBeenCalled();
  });

  it('extending validUntil on an expired proposal re-activates it', async () => {
    const { svc, ctx, db } = make({ proposal: { status: 'EXPIRED', validUntil: new Date('2020-01-01') } });
    await svc.update(ctx, 'p1', { validUntil: new Date(Date.now() + 10 * 86400000).toISOString() }, {}, {});
    expect(db.proposal.update.mock.calls[0][0].data.status).toBe('SENT');
  });

  it('delete removes its attachments too', async () => {
    const { svc, ctx, db } = make({ proposal: { status: 'DRAFT' } });
    await svc.remove(ctx, 'p1', {});
    expect(db.attachment.deleteMany).toHaveBeenCalledWith({ where: { entityType: 'Proposal', entityId: 'p1' } });
    expect(db.proposal.delete).toHaveBeenCalled();
  });
});

describe('ProposalsService — SMS', () => {
  let m: ReturnType<typeof make>;
  beforeEach(() => {
    m = make({ proposal: { status: 'DRAFT' } });
    (m.db.proposal.findFirst as any).mockResolvedValue({ ...baseProposal({ status: 'DRAFT', publicToken: 'tok-1' }), contact: { name: 'مشتری', phone: '09120000000' } });
  });

  it('previews the exact message that will be sent', async () => {
    const preview = await m.svc.smsPreview(m.ctx, 'p1', {}, 'https://app.example');
    expect(preview.message).toContain('https://app.example/proposal/');
    expect(preview.message).toContain('tok-1');
    expect(preview.phone).toBe('09120000000');
  });

  it('sends the same message, moves DRAFT to SENT and logs the sms event', async () => {
    const preview = await m.svc.smsPreview(m.ctx, 'p1', {}, 'https://app.example');
    await m.svc.sendSms(m.ctx, 'p1', {}, 'https://app.example');
    expect(m.sms.sendSms).toHaveBeenCalledWith(m.ctx, '09120000000', preview.message);
    expect(m.db.proposal.update.mock.calls[0][0].data.status).toBe('SENT');
    expect(m.db.proposalEvent.create.mock.calls[0][0].data.type).toBe('SMS_SENT');
  });

  it('a gateway failure surfaces and records nothing', async () => {
    const f = make({ smsOk: false });
    (f.db.proposal.findFirst as any).mockResolvedValue({ ...baseProposal({ status: 'DRAFT', publicToken: 't' }), contact: { name: 'x', phone: '0912' } });
    await expect(f.svc.sendSms(f.ctx, 'p1', {}, 'https://a')).rejects.toBeInstanceOf(BadRequestException);
    expect(f.db.proposalEvent.create).not.toHaveBeenCalled();
  });

  it('refuses a customer without a mobile number', async () => {
    (m.db.proposal.findFirst as any).mockResolvedValue({ ...baseProposal({ publicToken: 't' }), contact: { name: 'x', phone: null } });
    await expect(m.svc.sendSms(m.ctx, 'p1', {}, 'https://a')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ProposalsService — issue invoice', () => {
  it('creates a BANK_TRANSFER draft invoice with the proposal card number and notes', async () => {
    const { svc, ctx, invoices, db } = make();
    const res = await svc.issueInvoice(ctx, 'p1', {}, {});
    expect(res).toEqual({ invoiceId: 'inv1', invoiceNo: 31 });
    const dto = invoices.create.mock.calls[0][1] as Record<string, any>;
    expect(dto.paymentMethod).toBe('BANK_TRANSFER');
    expect(dto.paymentBankInfo).toBe('6037-1111-2222-3333');
    expect(dto.contactId).toBe('c1');
    expect(dto.lines).toEqual([{ description: expect.stringContaining('سایت فروشگاهی'), quantity: 1, unitPrice: 50_000_000 }]);
    expect(dto.notes).toContain('تاریخ سررسید:');
    expect(dto.notes).toContain('مهلت پرداخت: ۷ روز');
    expect(dto.notes).toContain('شرایط پرداخت: ۵۰٪ پیش‌پرداخت');
    expect(dto.notes).toContain('۷'); // proposal number
    expect(dto.dueAt).toBe('2026-11-01T00:00:00.000Z');
    // invoice link stored back on the proposal + history event
    expect(db.proposal.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { invoiceId: 'inv1' } });
    expect(db.proposalEvent.create.mock.calls.at(-1)![0].data.type).toBe('INVOICED');
  });

  it('uses user-defined lines when given', async () => {
    const { svc, ctx, invoices } = make();
    await svc.issueInvoice(ctx, 'p1', { lines: [{ description: 'طراحی', quantity: 2, unitPrice: 1000 }] }, {});
    expect((invoices.create.mock.calls[0][1] as any).lines).toEqual([{ description: 'طراحی', quantity: 2, unitPrice: 1000 }]);
  });

  it('only an accepted proposal can be invoiced', async () => {
    const { svc, ctx, invoices } = make({ proposal: { status: 'SENT' } });
    await expect(svc.issueInvoice(ctx, 'p1', {}, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(invoices.create).not.toHaveBeenCalled();
  });

  it('is gated on the sales module being enabled', async () => {
    const { svc, ctx, invoices } = make({ salesEnabled: false });
    await expect(svc.issueInvoice(ctx, 'p1', {}, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(invoices.create).not.toHaveBeenCalled();
  });

  it('never issues two invoices (already invoiced / lost claim race)', async () => {
    const a = make({ proposal: { invoiceId: 'old' } });
    await expect(a.svc.issueInvoice(a.ctx, 'p1', {}, {})).rejects.toBeInstanceOf(ConflictException);
    const b = make();
    b.db.proposal.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(b.svc.issueInvoice(b.ctx, 'p1', {}, {})).rejects.toBeInstanceOf(ConflictException);
    expect(b.invoices.create).not.toHaveBeenCalled();
  });

  it('falls back to the tenant default bank info, and fails clearly with none', async () => {
    const a = make({ proposal: { bankInfo: null }, defaultBank: '5022-9999' });
    await a.svc.issueInvoice(a.ctx, 'p1', {}, {});
    expect((a.invoices.create.mock.calls[0][1] as any).paymentBankInfo).toBe('5022-9999');
    const b = make({ proposal: { bankInfo: null } });
    await expect(b.svc.issueInvoice(b.ctx, 'p1', {}, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('releases the claim when the invoice rules reject', async () => {
    const { svc, ctx, invoices, db } = make();
    invoices.create.mockRejectedValueOnce(new BadRequestException('x'));
    await expect(svc.issueInvoice(ctx, 'p1', {}, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(db.proposal.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { invoicedAt: null } });
  });
});

describe('proposalScope', () => {
  const perms = (m: Record<string, boolean>) => ({ getEffective: vi.fn(async () => m) }) as never;
  const ctx = (userId: string | null) =>
    ({ auth: { role: 'MEMBER', sub: 'g', type: 'user' }, tenantDb: { user: { findUnique: vi.fn(async () => (userId ? { id: userId } : null)) } } }) as never;

  it('view-all → empty scope; view-own → created-by OR assigned-to; none → 403', async () => {
    expect(await proposalScope(perms({ canViewAll: true }), ctx('u1'))).toEqual({});
    expect(await proposalScope(perms({ canViewOwn: true }), ctx('u1'))).toEqual({ OR: [{ createdByUserId: 'u1' }, { assignedUserId: 'u1' }] });
    await expect(proposalScope(perms({}), ctx('u1'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
