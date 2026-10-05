import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { NotFoundException as NF } from '@nestjs/common';
import { PublicProposalsService, describeAttachment, type PublicTenantCtx } from './public-proposals.service.js';
import { PublicProposalsController } from './public-proposals.controller.js';

const TOKEN = '11111111-2222-3333-4444-555555555555';
const SIG = `data:image/png;base64,${'A'.repeat(400)}`;

function proposal(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    proposalNo: 4,
    title: 'پروپوزال',
    status: 'SENT',
    contactId: 'c1',
    amount: 1000,
    validUntil: null,
    firstViewedAt: null,
    lastViewNotifiedAt: null,
    assignedUserId: 'u-assignee',
    createdByUserId: 'u-creator',
    content: 'متن',
    contact: { id: 'c1', name: 'مشتری', company: null, phone: '09121234567' },
    ...over,
  };
}

function make(p: Record<string, unknown> = {}, extra: { lastView?: Date | null; recentComments?: number } = {}) {
  const row = proposal(p);
  const db: Record<string, any> = {
    proposal: {
      findUnique: vi.fn(async () => row),
      update: vi.fn(async () => row),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    proposalView: {
      findFirst: vi.fn(async () => (extra.lastView ? { createdAt: extra.lastView } : null)),
      create: vi.fn(async () => ({})),
    },
    proposalComment: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => extra.recentComments ?? 0),
      create: vi.fn(async ({ data }: any) => ({ id: 'cm1', ...data, createdAt: new Date() })),
    },
    proposalEvent: { create: vi.fn(async () => ({})) },
    crmActivity: { create: vi.fn(async () => ({})) },
    attachment: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    moduleSetting: { findUnique: vi.fn(async () => null) },
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const automation = { emit: vi.fn(async () => undefined) };
  const controlDb = { tenantMembership: { findMany: vi.fn(async () => []) } };
  const svc = new PublicProposalsService(controlDb as never, notifications as never, automation as never);
  const t = { tenantId: 't1', tenantSlug: 'acme', tenantName: 'اکسیر', tenantDb: db } as unknown as PublicTenantCtx;
  return { svc, t, db, notifications, automation };
}

const accept = (over: Record<string, unknown> = {}) => ({ name: 'علی رضایی', signatureDataUrl: SIG, confirmed: true, ...over }) as never;

describe('PublicProposalsService.accept', () => {
  it('requires the explicit confirmation checkbox', async () => {
    const { svc, t, db } = make();
    await expect(svc.accept(t, TOKEN, accept({ confirmed: false }), {})).rejects.toBeInstanceOf(BadRequestException);
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it('requires a real signature image and a name', async () => {
    const { svc, t, db } = make();
    await expect(svc.accept(t, TOKEN, accept({ signatureDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }), {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.accept(t, TOKEN, accept({ signatureDataUrl: 'data:image/png;base64,AAAA' }), {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.accept(t, TOKEN, accept({ name: ' ' }), {})).rejects.toBeInstanceOf(BadRequestException);
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it('stores signature, name, ip and timestamp; notifies owner; logs to CRM history', async () => {
    const { svc, t, db, notifications, automation } = make();
    await svc.accept(t, TOKEN, accept(), { ip: '5.6.7.8', userAgent: 'UA' });
    const data = (db.proposal.updateMany.mock.calls[0] as any)[0].data;
    expect(data).toMatchObject({ status: 'ACCEPTED', acceptedByName: 'علی رضایی', acceptedSignatureDataUrl: SIG, acceptedIp: '5.6.7.8', acceptedConfirmed: true });
    expect(data.acceptedAt).toBeInstanceOf(Date);
    expect(notifications.notify).toHaveBeenCalled();
    expect(db.crmActivity.create).toHaveBeenCalled();
    expect(automation.emit).toHaveBeenCalledWith(expect.anything(), 'proposals.proposal.accepted', expect.objectContaining({ proposalNo: 4 }));
  });

  it('an expired proposal (by status or date) can not be accepted', async () => {
    const a = make({ status: 'EXPIRED' });
    await expect(a.svc.accept(a.t, TOKEN, accept(), {})).rejects.toBeInstanceOf(ForbiddenException);
    const b = make({ status: 'SENT', validUntil: new Date('2020-01-01T00:00:00.000Z') });
    await expect(b.svc.accept(b.t, TOKEN, accept(), {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(b.db.proposal.updateMany).not.toHaveBeenCalled();
    // and it is flipped to EXPIRED as a side effect
    expect(b.db.proposal.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'EXPIRED' } });
  });

  it('already accepted / rejected can not be accepted again; lost race → conflict', async () => {
    const a = make({ status: 'ACCEPTED' });
    await expect(a.svc.accept(a.t, TOKEN, accept(), {})).rejects.toBeInstanceOf(ConflictException);
    const b = make({ status: 'REJECTED' });
    await expect(b.svc.accept(b.t, TOKEN, accept(), {})).rejects.toBeInstanceOf(ConflictException);
    const c = make();
    c.db.proposal.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(c.svc.accept(c.t, TOKEN, accept(), {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('a draft or an unknown / malformed token is a 404 (nothing leaks)', async () => {
    const a = make({ status: 'DRAFT' });
    await expect(a.svc.accept(a.t, TOKEN, accept(), {})).rejects.toBeInstanceOf(NotFoundException);
    const b = make();
    b.db.proposal.findUnique.mockResolvedValueOnce(null as never);
    await expect(b.svc.view(b.t, TOKEN, {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(b.svc.view(b.t, "x'; DROP TABLE", {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PublicProposalsService.reject / comment', () => {
  it('reject records the reason and notifies', async () => {
    const { svc, t, db, notifications } = make();
    await svc.reject(t, TOKEN, { reason: 'گران است' }, {});
    expect((db.proposal.updateMany.mock.calls[0] as any)[0].data).toMatchObject({ status: 'REJECTED', rejectedReason: 'گران است' });
    expect(notifications.notify).toHaveBeenCalled();
  });

  it('reject on an expired proposal is refused', async () => {
    const { svc, t } = make({ status: 'EXPIRED' });
    await expect(svc.reject(t, TOKEN, {}, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a revision request moves the proposal to REVISION_REQUESTED and stores the comment', async () => {
    const { svc, t, db } = make({ status: 'VIEWED' });
    await svc.comment(t, TOKEN, { body: 'قیمت را اصلاح کنید', requestRevision: true }, {});
    expect((db.proposal.updateMany.mock.calls[0] as any)[0].data.status).toBe('REVISION_REQUESTED');
    expect((db.proposalComment.create.mock.calls[0] as any)[0].data).toMatchObject({ authorType: 'CUSTOMER', kind: 'REVISION_REQUEST' });
  });

  it('a plain comment does not change the status', async () => {
    const { svc, t, db } = make();
    await svc.comment(t, TOKEN, { body: 'سؤال دارم' }, {});
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it('comment flooding is rate limited', async () => {
    const { svc, t } = make({}, { recentComments: 5 });
    await expect(svc.comment(t, TOKEN, { body: 'spam' }, {})).rejects.toBeInstanceOf(HttpException);
  });
});

describe('PublicProposalsService.view — logging, dedupe, notifications', () => {
  it('first view: logs a view, marks VIEWED, notifies assignee and creator, history event', async () => {
    const { svc, t, db, notifications } = make();
    const out = await svc.view(t, TOKEN, { ip: '1.1.1.1', userAgent: 'UA' });
    expect(db.proposalView.create).toHaveBeenCalledWith({ data: { proposalId: 'p1', ip: '1.1.1.1', userAgent: 'UA' } });
    const data = (db.proposal.update.mock.calls[0] as any)[0].data;
    expect(data.status).toBe('VIEWED');
    expect(data.firstViewedAt).toBeInstanceOf(Date);
    expect(notifications.notify.mock.calls.map((c: any) => c[1].userId).sort()).toEqual(['u-assignee', 'u-creator']);
    expect(db.proposalEvent.create).toHaveBeenCalled();
    expect(out.status).toBe('VIEWED');
  });

  it('rapid repeat from the same ip+agent is not logged again and does not notify', async () => {
    const { svc, t, db, notifications } = make({ firstViewedAt: new Date() }, { lastView: new Date(Date.now() - 60_000) });
    await svc.view(t, TOKEN, { ip: '1.1.1.1', userAgent: 'UA' });
    expect(db.proposalView.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('a later view is logged, but notifications are throttled within the hour', async () => {
    const throttled = make({ firstViewedAt: new Date(), status: 'VIEWED', lastViewNotifiedAt: new Date(Date.now() - 5 * 60_000) });
    await throttled.svc.view(throttled.t, TOKEN, { ip: '2.2.2.2' });
    expect(throttled.db.proposalView.create).toHaveBeenCalled();
    expect(throttled.notifications.notify).not.toHaveBeenCalled();

    const due = make({ firstViewedAt: new Date(), status: 'VIEWED', lastViewNotifiedAt: new Date(Date.now() - 2 * 3600_000) });
    await due.svc.view(due.t, TOKEN, { ip: '2.2.2.2' });
    expect(due.notifications.notify).toHaveBeenCalled();
  });

  it('never exposes internal fields', async () => {
    const { svc, t } = make({ internalNote: 'secret', statusNote: 'secret2', acceptedSignatureDataUrl: 'sig', acceptedIp: '9.9.9.9', createdByUserId: 'u' });
    const out = JSON.stringify(await svc.view(t, TOKEN, {}));
    for (const leak of ['secret', 'secret2', '9.9.9.9', 'u-creator', 'u-assignee', '09121234567']) expect(out).not.toContain(leak);
  });

  it('falls back to the managers when nobody is assigned', async () => {
    const m = make({ assignedUserId: null, createdByUserId: null });
    await m.svc.view(m.t, TOKEN, {});
    expect(m.notifications.notify).not.toHaveBeenCalled(); // no managers in the mock → graceful no-op
  });
});

describe('attachments', () => {
  it('classifies data URIs and external links; only safe image types are inline', () => {
    expect(describeAttachment('data:image/png;base64,AAAA')).toMatchObject({ mimeType: 'image/png', isImage: true });
    expect(describeAttachment('data:image/svg+xml;base64,AAAA').isImage).toBe(false);
    expect(describeAttachment('data:application/pdf;base64,AAAA').isImage).toBe(false);
    expect(describeAttachment('https://x.example/a.pdf')).toMatchObject({ externalUrl: 'https://x.example/a.pdf' });
    expect(describeAttachment('javascript:alert(1)').externalUrl).toBeNull();
  });

  it('serves only attachments of this proposal; active content is forced to a download', async () => {
    const { svc, t, db } = make();
    await expect(svc.getFile(t, TOKEN, 'a1')).rejects.toBeInstanceOf(NotFoundException);
    expect((db.attachment.findFirst.mock.calls[0] as any)[0].where).toEqual({ id: 'a1', entityType: 'Proposal', entityId: 'p1' });
    db.attachment.findFirst.mockResolvedValueOnce({ title: 'x.html', fileUrl: 'data:text/html;base64,PGI+aGk8L2I+' } as never);
    const f = await svc.getFile(t, TOKEN, 'a1');
    expect(f.mimeType).toBe('application/octet-stream');
    expect(f.inline).toBe(false);
  });
});

describe('PublicProposalsController', () => {
  function ctrl(tenant: Record<string, unknown> | null) {
    const view = vi.fn(async () => ({ ok: true }));
    const controlDb = { tenant: { findUnique: vi.fn(async () => tenant) } };
    const tenantPrisma = { forTenant: vi.fn(() => ({})) };
    return { c: new PublicProposalsController(controlDb as never, tenantPrisma as never, { view } as never), view };
  }

  it('passes the real client ip and user agent to the service', async () => {
    const { c, view } = ctrl({ id: 't', slug: 's', name: 'n', status: 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'd' });
    const res = { setHeader: vi.fn() };
    await c.view('s', TOKEN, { headers: { 'x-forwarded-for': '8.8.8.8, 10.0.0.1', 'user-agent': 'Mozilla' }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    expect(view).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: 's' }), TOKEN, { ip: '8.8.8.8', userAgent: 'Mozilla' });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('suspended / unknown tenants are a 404', async () => {
    await expect(ctrl(null).c.view('s', TOKEN, { headers: {}, socket: {} } as never, { setHeader: vi.fn() } as never)).rejects.toBeInstanceOf(NF);
    await expect(ctrl({ id: 't', slug: 's', status: 'SUSPENDED' }).c.view('s', TOKEN, { headers: {}, socket: {} } as never, { setHeader: vi.fn() } as never)).rejects.toBeInstanceOf(NF);
  });
});
