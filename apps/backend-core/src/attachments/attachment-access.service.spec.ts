import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AttachmentAccessService } from './attachment-access.service.js';

function make(opts: { role?: string; matrix?: Record<string, any>; scope?: Record<string, unknown>; found?: boolean } = {}) {
  const perms = {
    getEffective: vi.fn(async (_c: unknown, m: string) => opts.matrix?.[m] ?? { canViewAll: false, canViewOwn: false, canCreate: false, canEdit: false, canDelete: false }),
    viewScope: vi.fn(async () => opts.scope ?? {}),
    assertViewAll: vi.fn(async (_c: unknown, m: string) => {
      if (!opts.matrix?.[m]?.canViewAll) throw new ForbiddenException('x');
    }),
  } as any;
  const ctx = {
    auth: { role: opts.role ?? 'MEMBER', sub: 'g1', type: 'user' },
    tenantDb: {
      crmContact: { findFirst: vi.fn(async () => (opts.found === false ? null : { id: 'c1' })) },
      user: { findUnique: vi.fn(async () => ({ id: 'me' })) },
      dailyChecklistDayClose: { findFirst: vi.fn(async () => ((opts as any).dayCloseOwner ? { userId: (opts as any).dayCloseOwner } : null)) },
      employee: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
      proposal: {
        findFirst: vi.fn(async () => (opts.found === false ? null : { id: 'p1' })),
        findUnique: vi.fn(async () => ({ status: (opts as any).proposalStatus ?? 'SENT' })),
      },
    },
  } as any;
  return { svc: new AttachmentAccessService(perms, {} as any), ctx };
}

describe('AttachmentAccessService', () => {
  it('managers always pass', async () => {
    const { svc, ctx } = make({ role: 'OWNER' });
    await expect(svc.assertAccess(ctx, 'Anything', 'x', 'write')).resolves.toBeUndefined();
  });

  it('denies unknown entity types to non-managers', async () => {
    const { svc, ctx } = make();
    await expect(svc.assertAccess(ctx, 'Mystery', 'x', 'read')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('view-own user cannot read attachments of a contact they do not own (404)', async () => {
    const { svc, ctx } = make({ scope: { ownerUserId: 'me' }, found: false, matrix: { crm: { canViewOwn: true } } });
    await expect(svc.assertAccess(ctx, 'CrmContact', 'c1', 'read')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('view-own user can read their own contact attachments', async () => {
    const { svc, ctx } = make({ scope: { ownerUserId: 'me' }, matrix: { crm: { canViewOwn: true } } });
    await expect(svc.assertAccess(ctx, 'CrmContact', 'c1', 'read')).resolves.toBeUndefined();
  });

  it('adding/removing requires edit or create on the module', async () => {
    const { svc, ctx } = make({ scope: {}, matrix: { crm: { canViewAll: true } } });
    await expect(svc.assertAccess(ctx, 'CrmContact', 'c1', 'write')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assertAccess(ctx, 'CrmContact', 'c1', 'delete')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('view-all-only entities require view-all on their module', async () => {
    const { svc, ctx } = make({ matrix: { fleet: { canViewOwn: true } } });
    await expect(svc.assertAccess(ctx, 'Shipment', 's1', 'read')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('proposal attachments follow the proposal scope (created-by OR assigned-to) and 404 outside it', async () => {
    const own = make({ matrix: { proposals: { canViewOwn: true, canEdit: true } }, found: false });
    await expect(own.svc.assertAccess(own.ctx, 'Proposal', 'p1', 'read')).rejects.toBeInstanceOf(NotFoundException);
    const ok = make({ matrix: { proposals: { canViewOwn: true, canEdit: true } } } as any);
    await expect(ok.svc.assertAccess(ok.ctx, 'Proposal', 'p1', 'write')).resolves.toBeUndefined();
  });

  it('accepted proposals are locked for attachment changes, even for managers; reading stays allowed', async () => {
    const locked = make({ role: 'OWNER', proposalStatus: 'ACCEPTED' } as any);
    await expect(locked.svc.assertAccess(locked.ctx, 'Proposal', 'p1', 'write')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(locked.svc.assertAccess(locked.ctx, 'Proposal', 'p1', 'delete')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(locked.svc.assertAccess(locked.ctx, 'Proposal', 'p1', 'read')).resolves.toBeUndefined();
  });

  it('daily-report attachments: the checklist owner reads them without reports view-all; other reports stay view-all only', async () => {
    const own = make({ matrix: { reports: { canViewOwn: true } }, dayCloseOwner: 'me' } as any);
    await expect(own.svc.assertAccess(own.ctx, 'Report', 'rep-1', 'read')).resolves.toBeUndefined();

    const stranger = make({ matrix: { reports: { canViewOwn: true } }, dayCloseOwner: 'someone-else' } as any);
    await expect(stranger.svc.assertAccess(stranger.ctx, 'Report', 'rep-1', 'read')).rejects.toBeInstanceOf(ForbiddenException);

    const plainReport = make({ matrix: { reports: { canViewOwn: true } } });
    await expect(plainReport.svc.assertAccess(plainReport.ctx, 'Report', 'rep-2', 'read')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('daily-report attachments cannot be added/removed by the plain owner (write needs the reports matrix)', async () => {
    const own = make({ matrix: { reports: { canViewOwn: true } }, dayCloseOwner: 'me' } as any);
    await expect(own.svc.assertAccess(own.ctx, 'Report', 'rep-1', 'write')).rejects.toBeInstanceOf(ForbiddenException);
    const admin = make({ matrix: { reports: { canViewAll: true, canEdit: true } } });
    await expect(admin.svc.assertAccess(admin.ctx, 'Report', 'rep-1', 'write')).resolves.toBeUndefined();
  });
});
