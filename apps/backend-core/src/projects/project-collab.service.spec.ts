import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

const mods = vi.hoisted(() => ({ enabled: new Set<string>(['proposals', 'sales']) }));
vi.mock('../common/module-enabled.util.js', () => ({ isModuleEnabled: async (_c: unknown, _t: string, code: string) => mods.enabled.has(code) }));

import { ProjectCollabService } from './project-collab.service.js';
import { makeDelegate } from './testing/fake-db.js';

type Row = Record<string, unknown>;

/** ماتریس دسترسی به‌ازای ماژول؛ viewScope مثل PermissionsService واقعی: ownerField = کاربر. */
function make(opts: { proposals?: Record<string, boolean>; sales?: Record<string, boolean> } = {}) {
  const matrices: Record<string, Record<string, boolean>> = { proposals: opts.proposals ?? { canViewAll: true }, sales: opts.sales ?? { canViewAll: true } };
  const permissions = {
    getEffective: vi.fn(async (_c: unknown, code: string) => matrices[code] ?? {}),
    viewScope: vi.fn(async (_c: unknown, code: string, field: string) => {
      const m = matrices[code] ?? {};
      if (m.canViewAll) return {};
      if (m.canViewOwn) return { [field]: 'me' };
      throw new ForbiddenException('no');
    }),
  };
  const proposals: Row[] = [
    { id: 'pr-mine', projectId: null, createdByUserId: 'me', assignedUserId: null, proposalNo: 1, title: 'mine', status: 'SENT', projectShowOnPublicLink: false },
    { id: 'pr-other-user', projectId: null, createdByUserId: 'someone', assignedUserId: null, proposalNo: 2, title: 'theirs', status: 'SENT', projectShowOnPublicLink: false },
    { id: 'pr-other-project', projectId: 'p2', createdByUserId: 'me', assignedUserId: null, proposalNo: 3, title: 'taken', status: 'SENT', projectShowOnPublicLink: true },
  ];
  const invoices: Row[] = [
    { id: 'inv-mine', projectId: null, createdByUserId: 'me', invoiceNo: 1, status: 'CONFIRMED', total: 1, paidAmount: 0, issuedAt: new Date(), projectShowOnPublicLink: false },
    { id: 'inv-other-user', projectId: null, createdByUserId: 'someone', invoiceNo: 2, status: 'CONFIRMED', total: 1, paidAmount: 0, issuedAt: new Date(), projectShowOnPublicLink: false },
    { id: 'inv-other-project', projectId: 'p2', createdByUserId: 'me', invoiceNo: 3, status: 'CONFIRMED', total: 1, paidAmount: 0, issuedAt: new Date(), projectShowOnPublicLink: false },
  ];
  const stages: Row[] = [{ id: 's1', projectId: 'p1' }];
  const notes: Row[] = [
    { id: 'n-cust', projectId: 'p1', stageId: null, parentId: null, source: 'CUSTOMER', body: 'hi', visibleToCustomer: true },
    { id: 'n-reply', projectId: 'p1', stageId: null, parentId: 'n-cust', source: 'STAFF', body: 'r', visibleToCustomer: false },
    { id: 'n-plain', projectId: 'p1', stageId: null, parentId: null, source: 'STAFF', body: 'internal', visibleToCustomer: false },
  ];
  const tenantDb = {
    proposal: makeDelegate(proposals),
    salesInvoice: makeDelegate(invoices),
    projectStage: makeDelegate(stages),
    projectNote: { ...makeDelegate(notes, { idPrefix: 'note' }), findFirst: async (args: { where: Row }) => {
      const r = notes.find((n) => Object.entries(args.where).every(([k, v]) => n[k] === v));
      return r ? { ...r, parent: r.parentId ? { source: notes.find((n) => n.id === r.parentId)?.source } : null } : null;
    } },
    user: { findUnique: vi.fn(async () => ({ id: 'me' })) },
  };
  const ctx = { tenantId: 't', auth: { role: 'MEMBER', sub: 'g' }, tenantDb } as never;
  const svc = new ProjectCollabService({} as never, permissions as never);
  return { svc, ctx, proposals, invoices, notes, permissions };
}

beforeEach(() => {
  mods.enabled = new Set(['proposals', 'sales']);
});

describe('linking proposals', () => {
  it('links, flag defaults to false, and is idempotent for the same project', async () => {
    const { svc, ctx, proposals } = make();
    await svc.linkProposal(ctx, 'p1', 'pr-mine');
    expect(proposals[0]).toMatchObject({ projectId: 'p1', projectShowOnPublicLink: false });
    await svc.linkProposal(ctx, 'p1', 'pr-mine', true);
    expect(proposals[0]).toMatchObject({ projectId: 'p1', projectShowOnPublicLink: true });
  });

  it('a record belongs to at most one project', async () => {
    const { svc, ctx, proposals } = make();
    await expect(svc.linkProposal(ctx, 'p1', 'pr-other-project')).rejects.toBeInstanceOf(ConflictException);
    expect(proposals[2].projectId).toBe('p2');
  });

  it('a record outside the caller\'s view scope is a 404 and stays untouched', async () => {
    const { svc, ctx, proposals } = make({ proposals: { canViewOwn: true } });
    await expect(svc.linkProposal(ctx, 'p1', 'pr-other-user')).rejects.toBeInstanceOf(NotFoundException);
    expect(proposals[1].projectId).toBeNull();
    await svc.linkProposal(ctx, 'p1', 'pr-mine');
    expect(proposals[0].projectId).toBe('p1');
  });

  it('no view permission on proposals = forbidden; module disabled = forbidden', async () => {
    const none = make({ proposals: {} });
    await expect(none.svc.linkProposal(none.ctx, 'p1', 'pr-mine')).rejects.toBeInstanceOf(ForbiddenException);
    const off = make();
    mods.enabled.delete('proposals');
    await expect(off.svc.linkProposal(off.ctx, 'p1', 'pr-mine')).rejects.toBeInstanceOf(ForbiddenException);
    expect(off.proposals[0].projectId).toBeNull();
  });

  it('unlink / show only work on records linked to THIS project', async () => {
    const { svc, ctx, proposals } = make();
    await expect(svc.unlinkProposal(ctx, 'p1', 'pr-other-project')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.setProposalShow(ctx, 'p1', 'pr-other-project', true)).rejects.toBeInstanceOf(NotFoundException);
    expect(proposals[2]).toMatchObject({ projectId: 'p2', projectShowOnPublicLink: true });
    await svc.linkProposal(ctx, 'p1', 'pr-mine', true);
    await svc.unlinkProposal(ctx, 'p1', 'pr-mine');
    expect(proposals[0]).toMatchObject({ projectId: null, projectShowOnPublicLink: false });
  });
});

describe('linking sales invoices', () => {
  it('links within scope, enforces one-project, module and permission', async () => {
    const { svc, ctx, invoices } = make({ sales: { canViewOwn: true } });
    await svc.linkInvoice(ctx, 'p1', 'inv-mine', true);
    expect(invoices[0]).toMatchObject({ projectId: 'p1', projectShowOnPublicLink: true });
    await expect(svc.linkInvoice(ctx, 'p1', 'inv-other-user')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.linkInvoice(ctx, 'p1', 'inv-other-project')).rejects.toBeInstanceOf(ConflictException);
    await svc.unlinkInvoice(ctx, 'p1', 'inv-mine');
    expect(invoices[0]).toMatchObject({ projectId: null, projectShowOnPublicLink: false });

    mods.enabled.delete('sales');
    await expect(svc.linkInvoice(ctx, 'p1', 'inv-mine')).rejects.toBeInstanceOf(ForbiddenException);
    const none = make({ sales: {} });
    await expect(none.svc.linkInvoice(none.ctx, 'p1', 'inv-mine')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('listing documents', () => {
  it('only shows linked records inside the viewer scope and reports module availability', async () => {
    const { svc, ctx } = make({ proposals: { canViewOwn: true } });
    await svc.linkProposal(ctx, 'p1', 'pr-mine');
    await svc.linkInvoice(ctx, 'p1', 'inv-mine');
    const r = await svc.listDocuments(ctx, 'p1');
    expect((r.proposals.items as Row[]).map((p) => p.id)).toEqual(['pr-mine']);
    expect((r.invoices.items as Row[]).map((p) => p.id)).toEqual(['inv-mine']);

    mods.enabled.delete('proposals');
    const off = await svc.listDocuments(ctx, 'p1');
    expect(off.proposals).toEqual({ enabled: false, canView: false, items: [] });
  });

  it('a user with no sales view sees no invoices (but no error)', async () => {
    const { svc, ctx } = make({ sales: {} });
    const r = await svc.listDocuments(ctx, 'p1');
    expect(r.invoices).toEqual({ enabled: true, canView: false, items: [] });
  });
});

describe('staff notes and replies — visibility rules', () => {
  it('project-level private note cannot be made visible; reply to a customer comment can', async () => {
    const { svc, ctx, notes } = make();
    await expect(svc.addNote(ctx, 'p1', { body: 'x', visibleToCustomer: true })).rejects.toBeInstanceOf(BadRequestException);
    const reply = await svc.addNote(ctx, 'p1', { body: 'پاسخ', parentId: 'n-cust', visibleToCustomer: true });
    expect(reply).toMatchObject({ source: 'STAFF', parentId: 'n-cust', visibleToCustomer: true });
    expect(notes.at(-1)).toMatchObject({ source: 'STAFF', authorUserId: 'me' });
  });

  it('replies are private unless explicitly flagged', async () => {
    const { svc, ctx } = make();
    const reply = await svc.addNote(ctx, 'p1', { body: 'پاسخ', parentId: 'n-cust' });
    expect(reply.visibleToCustomer).toBe(false);
  });

  it('a reply to a non-customer note, or a reply to a reply, cannot be visible / is refused', async () => {
    const { svc, ctx } = make();
    await expect(svc.addNote(ctx, 'p1', { body: 'x', parentId: 'n-plain', visibleToCustomer: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addNote(ctx, 'p1', { body: 'x', parentId: 'n-reply' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stage notes can be flagged; the stage must belong to the project; foreign notes are 404', async () => {
    const { svc, ctx } = make();
    const n = await svc.addNote(ctx, 'p1', { body: 'stage note', stageId: 's1', visibleToCustomer: true });
    expect(n.visibleToCustomer).toBe(true);
    await expect(svc.addNote(ctx, 'other', { body: 'x', stageId: 's1' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.setNoteVisibility(ctx, 'other', 'n-reply', true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.removeNote(ctx, 'other', 'n-plain')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('toggling visibility follows the same rules; customer comments cannot be toggled', async () => {
    const { svc, ctx, notes } = make();
    await svc.setNoteVisibility(ctx, 'p1', 'n-reply', true);
    expect(notes[1].visibleToCustomer).toBe(true);
    await expect(svc.setNoteVisibility(ctx, 'p1', 'n-plain', true)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setNoteVisibility(ctx, 'p1', 'n-cust', false)).rejects.toBeInstanceOf(BadRequestException);
    await svc.setNoteVisibility(ctx, 'p1', 'n-reply', false);
    expect(notes[1].visibleToCustomer).toBe(false);
  });
});
