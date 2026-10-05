import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ProposalsController } from './proposals.controller.js';

const OWN = { OR: [{ createdByUserId: 'me' }, { assignedUserId: 'me' }] };

function make(matrix: Record<string, boolean>) {
  const permissions = {
    getEffective: vi.fn(async () => matrix),
    viewScope: vi.fn(async () => ({ ownerUserId: 'me' })),
    assertEdit: vi.fn(async () => undefined),
    assertCreate: vi.fn(async () => undefined),
    assertDelete: vi.fn(async () => undefined),
  };
  const svc: Record<string, any> = {};
  for (const m of ['list', 'detail', 'update', 'remove', 'setStatus', 'updateStatusNote', 'assign', 'addStaffComment', 'shareLink', 'smsPreview', 'sendSms', 'issueInvoice', 'create']) svc[m] = vi.fn(async () => ({}));
  const templates = { create: vi.fn(async () => ({})), list: vi.fn(async () => []) };
  const ctx = { auth: { role: 'MEMBER', sub: 'g' }, tenantDb: { user: { findUnique: vi.fn(async () => ({ id: 'me' })) } } } as never;
  return { c: new ProposalsController(svc as never, templates as never, permissions as never), svc, permissions, ctx, templates };
}
const ID = '11111111-2222-3333-4444-555555555555';

describe('ProposalsController — «view own» scope reaches every by-id action', () => {
  it('passes the created-by-or-assigned scope to the service for each route', async () => {
    const { c, svc, ctx } = make({ canViewOwn: true });
    await c.list(undefined, undefined, undefined, undefined, ctx);
    await c.detail(ID, ctx);
    await c.update(ID, {} as never, ctx);
    await c.remove(ID, ctx);
    await c.setStatus(ID, { status: 'SENT' } as never, ctx);
    await c.statusNote(ID, { statusNote: 'x' } as never, ctx);
    await c.assign(ID, {} as never, ctx);
    await c.comment(ID, { body: 'x' } as never, ctx);
    await c.link(ID, ctx);
    await c.smsPreview(ID, ctx);
    await c.sendSms(ID, ctx);
    await c.issueInvoice(ID, {} as never, ctx);
    expect(svc.list.mock.calls[0][1]).toEqual(OWN);
    expect(svc.detail.mock.calls[0][2]).toEqual(OWN);
    expect(svc.update.mock.calls[0][3]).toEqual(OWN);
    expect(svc.remove.mock.calls[0][2]).toEqual(OWN);
    expect(svc.setStatus.mock.calls[0][4]).toEqual(OWN);
    expect(svc.updateStatusNote.mock.calls[0][3]).toEqual(OWN);
    expect(svc.assign.mock.calls[0][3]).toEqual(OWN);
    expect(svc.addStaffComment.mock.calls[0][3]).toEqual(OWN);
    expect(svc.shareLink.mock.calls[0][2]).toEqual(OWN);
    expect(svc.smsPreview.mock.calls[0][2]).toEqual(OWN);
    expect(svc.sendSms.mock.calls[0][2]).toEqual(OWN);
    expect(svc.issueInvoice.mock.calls[0][3]).toEqual(OWN);
  });

  it('view-all users get an empty scope', async () => {
    const { c, svc, ctx } = make({ canViewAll: true });
    await c.detail(ID, ctx);
    expect(svc.detail.mock.calls[0][2]).toEqual({});
  });

  it('a user without any view access is rejected before the service is touched', async () => {
    const { c, svc, ctx } = make({});
    await expect(c.detail(ID, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.remove(ID, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.detail).not.toHaveBeenCalled();
    expect(svc.remove).not.toHaveBeenCalled();
  });

  it('mutations require the matching action permission; invoicing also needs sales create', async () => {
    const { c, permissions, ctx } = make({ canViewAll: true });
    await c.issueInvoice(ID, {} as never, ctx);
    expect(permissions.assertEdit).toHaveBeenCalledWith(ctx, 'proposals');
    expect(permissions.assertCreate).toHaveBeenCalledWith(ctx, 'sales');
    await c.remove(ID, ctx);
    expect(permissions.assertDelete).toHaveBeenCalledWith(ctx, 'proposals');
  });

  it('new proposals are linked only to contacts inside the caller\'s CRM scope', async () => {
    const { c, svc, ctx } = make({ canViewOwn: true });
    await c.create({ title: 'ab', contactId: ID } as never, ctx);
    expect(svc.create.mock.calls[0][2]).toEqual({ ownerUserId: 'me' });
  });
});
