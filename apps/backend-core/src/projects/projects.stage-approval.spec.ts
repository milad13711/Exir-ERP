import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectsService, presentProject } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { makeDelegate } from './testing/fake-db.js';

type Row = Record<string, unknown>;

function makeService(stage: Partial<Row> = {}) {
  const stages: Row[] = [{ id: 's1', projectId: 'p1', title: 'مرحله', order: 0, status: 'PENDING', requiresManagerApproval: true, links: [], ...stage }];
  const projects: Row[] = [{ id: 'p1', name: 'پروژه', managerUserId: 'mgr' }];
  const tenantDb = {
    projectStage: makeDelegate(stages),
    project: makeDelegate(projects),
    attachment: makeDelegate([]),
    user: { findUnique: vi.fn(async () => ({ id: 'actor' })) },
  };
  const approvals = { registerHandler: vi.fn(), request: vi.fn(async () => undefined), closeForEntity: vi.fn(async () => undefined) };
  const notifications = { notify: vi.fn(async () => undefined) };
  const svc = new ProjectsService({} as never, approvals as never, notifications as never);
  const ctx = { auth: { role: 'MEMBER', sub: 'g' }, tenantDb } as never;
  return { svc, stages, approvals, notifications, ctx };
}

describe('stage approval toggle — server-side enforcement', () => {
  it('ON (default): request-start goes through the approval flow, status AWAITING_APPROVAL', async () => {
    const { svc, approvals, ctx, stages } = makeService();
    await svc.requestStageStart(ctx, 'p1', 's1');
    expect(approvals.request).toHaveBeenCalledTimes(1);
    expect(stages[0].status).toBe('AWAITING_APPROVAL');
  });

  it('ON: completing without approval is refused from PENDING, AWAITING_APPROVAL and REJECTED', async () => {
    for (const status of ['PENDING', 'AWAITING_APPROVAL', 'REJECTED']) {
      const { svc, ctx, stages } = makeService({ status });
      await expect(svc.completeStage(ctx, 'p1', 's1', undefined)).rejects.toBeInstanceOf(ConflictException);
      expect(stages[0].status).toBe(status);
    }
  });

  it('ON: an approved (IN_PROGRESS) stage completes normally', async () => {
    const { svc, ctx, stages } = makeService({ status: 'IN_PROGRESS' });
    await svc.completeStage(ctx, 'p1', 's1', 'گزارش');
    expect(stages[0]).toMatchObject({ status: 'DONE', completionReport: 'گزارش' });
  });

  it('OFF: request-start moves straight to IN_PROGRESS with no approval request, and notifies the manager', async () => {
    const { svc, approvals, notifications, ctx, stages } = makeService({ requiresManagerApproval: false });
    await svc.requestStageStart(ctx, 'p1', 's1');
    expect(approvals.request).not.toHaveBeenCalled();
    expect(stages[0].status).toBe('IN_PROGRESS');
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('OFF: the stage can be completed directly (from PENDING too) and the manager is told', async () => {
    const { svc, ctx, stages, notifications } = makeService({ requiresManagerApproval: false });
    await svc.completeStage(ctx, 'p1', 's1', undefined);
    expect(stages[0].status).toBe('DONE');
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('OFF does not let a stage skip out of DONE / AWAITING_APPROVAL', async () => {
    const done = makeService({ requiresManagerApproval: false, status: 'DONE' });
    await expect(done.svc.completeStage(done.ctx, 'p1', 's1', undefined)).rejects.toBeInstanceOf(ConflictException);
    const awaiting = makeService({ requiresManagerApproval: false, status: 'AWAITING_APPROVAL' });
    await expect(awaiting.svc.completeStage(awaiting.ctx, 'p1', 's1', undefined)).rejects.toBeInstanceOf(ConflictException);
  });

  it('toggling OFF is refused while an approval request is pending; allowed otherwise; toggling ON always allowed', async () => {
    const pending = makeService({ status: 'AWAITING_APPROVAL' });
    await expect(pending.svc.updateStage(pending.ctx, 'p1', 's1', { requiresManagerApproval: false })).rejects.toBeInstanceOf(ConflictException);
    expect(pending.stages[0].requiresManagerApproval).toBe(true);

    const idle = makeService({ status: 'PENDING' });
    await idle.svc.updateStage(idle.ctx, 'p1', 's1', { requiresManagerApproval: false });
    expect(idle.stages[0].requiresManagerApproval).toBe(false);
    await idle.svc.updateStage(idle.ctx, 'p1', 's1', { requiresManagerApproval: true });
    expect(idle.stages[0].requiresManagerApproval).toBe(true);
  });

  it('a stage of another project is a 404 (no cross-project toggling)', async () => {
    const { svc, ctx } = makeService();
    await expect(svc.updateStage(ctx, 'other-project', 's1', { requiresManagerApproval: false })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.completeStage(ctx, 'other-project', 's1', undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stage description is trimmed and "" clears it', async () => {
    const { svc, ctx, stages } = makeService();
    await svc.updateStage(ctx, 'p1', 's1', { description: '  متن  ', descriptionVisibleToCustomer: true });
    expect(stages[0]).toMatchObject({ description: 'متن', descriptionVisibleToCustomer: true });
    await svc.updateStage(ctx, 'p1', 's1', { description: '   ' });
    expect(stages[0].description).toBeNull();
  });
});

describe('presentProject', () => {
  it('drops the public token and adds the stage-based percent', () => {
    const out = presentProject({ publicToken: 'SECRET', name: 'x', stages: [{ status: 'DONE' }, { status: 'PENDING' }] });
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(out).toMatchObject({ progressPercent: 50, stageProgress: { done: 1, total: 2 } });
  });
});

describe('ProjectsController — permissions and scope on the new routes', () => {
  function make(matrix: Record<string, boolean>, inScope = true) {
    const permissions = {
      getEffective: vi.fn(async () => matrix),
      assertEdit: vi.fn(async () => undefined),
      assertCreate: vi.fn(async () => undefined),
      assertDelete: vi.fn(async () => undefined),
    };
    const projects: Record<string, any> = {};
    for (const m of ['updateStage', 'addStage', 'completeStage', 'requestStageStart']) projects[m] = vi.fn(async () => ({}));
    const collab: Record<string, any> = {};
    for (const m of ['getPublicLink', 'setPublicLink', 'regeneratePublicLink', 'listNotes', 'addNote', 'setNoteVisibility', 'removeNote', 'addStageLink', 'setStageLinkVisibility', 'removeStageLink', 'setStageAttachmentVisibility', 'listDocuments', 'linkProposal', 'setProposalShow', 'unlinkProposal', 'linkInvoice', 'setInvoiceShow', 'unlinkInvoice']) collab[m] = vi.fn(async () => ({}));
    const ctx = {
      auth: { role: 'MEMBER', sub: 'g' },
      tenantDb: { user: { findUnique: vi.fn(async () => ({ id: 'me' })) }, project: { findFirst: vi.fn(async () => (inScope ? { id: 'p1' } : null)) } },
    } as never;
    return { c: new ProjectsController(projects as never, {} as never, permissions as never, collab as never), projects, collab, permissions, ctx };
  }

  it('every new by-id route 404s (service untouched) when the project is outside the caller scope', async () => {
    const { c, collab, projects, ctx } = make({ canViewOwn: true }, false);
    const calls: Array<() => Promise<unknown>> = [
      () => c.getPublicLink('p1', ctx),
      () => c.setPublicLink('p1', { enabled: true }, ctx),
      () => c.regeneratePublicLink('p1', ctx),
      () => c.listNotes('p1', ctx),
      () => c.addNote('p1', { body: 'x' }, ctx),
      () => c.setNoteVisibility('p1', 'n', { visibleToCustomer: true }, ctx),
      () => c.removeNote('p1', 'n', ctx),
      () => c.addStageLink('p1', 's', { title: 't', url: 'https://x.y' }, ctx),
      () => c.setStageLinkVisibility('p1', 's', 'l', { visibleToCustomer: true }, ctx),
      () => c.removeStageLink('p1', 's', 'l', ctx),
      () => c.setStageAttachmentVisibility('p1', 's', 'a', { visibleToCustomer: true }, ctx),
      () => c.listDocuments('p1', ctx),
      () => c.linkProposal('p1', 'x', {}, ctx),
      () => c.setProposalShow('p1', 'x', { showOnPublicLink: true }, ctx),
      () => c.unlinkProposal('p1', 'x', ctx),
      () => c.linkInvoice('p1', 'x', {}, ctx),
      () => c.setInvoiceShow('p1', 'x', { showOnPublicLink: true }, ctx),
      () => c.unlinkInvoice('p1', 'x', ctx),
      () => c.updateStage('p1', 's', { requiresManagerApproval: false }, ctx),
      () => c.completeStage('p1', 's', {}, ctx),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    for (const fn of [...Object.values(collab), ...Object.values(projects)]) expect(fn).not.toHaveBeenCalled();
  });

  it('mutations require project edit permission; reads need only view; a user with no view is forbidden', async () => {
    const { c, permissions, collab, ctx } = make({ canViewAll: true });
    await c.updateStage('p1', 's', { requiresManagerApproval: false }, ctx);
    await c.linkProposal('p1', 'x', {}, ctx);
    await c.addNote('p1', { body: 'x' }, ctx);
    await c.setPublicLink('p1', { enabled: true }, ctx);
    expect(permissions.assertEdit).toHaveBeenCalledTimes(4);
    expect(permissions.assertEdit).toHaveBeenCalledWith(ctx, 'projects');
    permissions.assertEdit.mockClear();
    await c.listNotes('p1', ctx);
    await c.listDocuments('p1', ctx);
    expect(permissions.assertEdit).not.toHaveBeenCalled();

    const denied = make({});
    await expect(denied.c.listNotes('p1', denied.ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(denied.collab.listNotes).not.toHaveBeenCalled();
    expect(collab.linkProposal).toHaveBeenCalledWith(ctx, 'p1', 'x', false);
  });

  it('an edit-permission failure stops the toggle before the service is called', async () => {
    const { c, permissions, projects, ctx } = make({ canViewAll: true });
    permissions.assertEdit.mockRejectedValueOnce(new ForbiddenException('no'));
    await expect(c.updateStage('p1', 's', { requiresManagerApproval: false }, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(projects.updateStage).not.toHaveBeenCalled();
  });
});
