import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

function setup(handlerImpl?: () => Promise<void>) {
  const row: any = { id: 'r1', entityType: 'X', entityId: 'e1', status: 'PENDING', isOfficial: false, requestedByUserId: null, summary: null, assigneeUserId: null };
  const db: any = {
    approvalRequest: {
      findUnique: vi.fn(async () => ({ ...row })),
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      updateMany: vi.fn(async (a: any) => {
        if (a.where.status !== row.status) return { count: 0 };
        Object.assign(row, a.data);
        return { count: 1 };
      }),
    },
    user: { findUnique: vi.fn(async () => ({ id: 'u1' })) },
  };
  const svc = new ApprovalsService({} as never, { notify: vi.fn() } as never);
  const handler = { approve: vi.fn(handlerImpl ?? (async () => undefined)), reject: vi.fn(async () => undefined) };
  svc.registerHandler('X', handler as never);
  const ctx = { tenantDb: db, auth: { type: 'user', sub: 'g', role: 'OWNER' } } as unknown as TenantRequestContext;
  return { svc, ctx, row, handler, db };
}

describe('ApprovalsService.decide atomic claim', () => {
  it('claims PENDING before running the handler; concurrent second decision never reaches the handler', async () => {
    const t = setup();
    const results = await Promise.allSettled([t.svc.decide(t.ctx, 'r1', true, {}), t.svc.decide(t.ctx, 'r1', true, {})]);
    expect(t.handler.approve).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(t.row.status).toBe('APPROVED');
  });

  it('loses the claim → 400 and handler untouched', async () => {
    const t = setup();
    t.db.approvalRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(t.svc.decide(t.ctx, 'r1', true, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(t.handler.approve).not.toHaveBeenCalled();
  });

  it('handler failure releases the claim back to PENDING', async () => {
    const t = setup(async () => { throw new Error('boom'); });
    await expect(t.svc.decide(t.ctx, 'r1', true, {})).rejects.toThrow('boom');
    expect(t.row.status).toBe('PENDING');
  });
});
