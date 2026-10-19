import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { invoiceWeighingBlockFor } from './dispatch-gate.js';
import { csvCell, DispatchReportService } from './dispatch-report.service.js';
import { DispatchSuggestionsService } from './dispatch-suggestions.service.js';
import { DispatchService } from './dispatch.service.js';

describe('invoiceWeighingBlockFor', () => {
  const db = (loadings: unknown[], adj: unknown) =>
    ({
      shipmentLoading: { findMany: vi.fn(async () => loadings) },
      dispatchInvoiceAdjustment: { findFirst: vi.fn(async () => adj) },
    }) as any;

  it('does not block invoices without a weighing declaration', async () => {
    expect(await invoiceWeighingBlockFor(db([], null), 'inv1')).toBeNull();
  });
  it('blocks until weight is confirmed and the adjustment applied, ignores cancelled shipments', async () => {
    const l = (over = {}) => ({ shipmentId: 's1', weightConfirmedAt: null, shipment: { status: 'LOADED' }, ...over });
    expect(await invoiceWeighingBlockFor(db([l()], null), 'inv1')).toMatch(/مسدود/);
    expect(await invoiceWeighingBlockFor(db([l({ weightConfirmedAt: new Date() })], { status: 'PROPOSED' }), 'inv1')).toMatch(/انتظار/);
    expect(await invoiceWeighingBlockFor(db([l({ weightConfirmedAt: new Date() })], { status: 'APPLIED' }), 'inv1')).toBeNull();
    expect(await invoiceWeighingBlockFor(db([l({ shipment: { status: 'CANCELLED' } })], null), 'inv1')).toBeNull();
  });
});

describe('csvCell', () => {
  it('quotes separators and neutralizes spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('x"y')).toBe('"x""y"');
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
  });
});

describe('suggestions dedupe', () => {
  const make = (over: Record<string, unknown> = {}) => {
    const tenantDb = {
      shipment: { findMany: vi.fn(async () => (over.live as unknown[]) ?? []) },
      dispatchSuggestion: {
        findUnique: vi.fn(async () => over.suggestion ?? null),
        create: vi.fn(async () => ({ id: 'sg1', status: 'OPEN', notifiedAt: null })),
        updateMany: vi.fn(async () => ({ count: (over.claimCount as number) ?? 1 })),
      },
    };
    const svc = new DispatchSuggestionsService({} as any, {} as any, {} as any);
    return { svc, ctx: { tenantDb, tenantId: 't1' } as any, tenantDb };
  };

  it('an existing live shipment for the same source is reported instead of suggesting another', async () => {
    const { svc, ctx } = make({ live: [{ id: 's1', status: 'LOADED', shipmentNo: 7 }] });
    const r = await svc.sourceStatus(ctx, 'SALES_INVOICE', 'inv1');
    expect(r.existing).toMatchObject({ id: 's1', shipmentNo: 7 });
    expect(r.suggested).toBe(false);
  });
  it('dismissed suggestions are not shown again; open ones are', async () => {
    expect((await make({ suggestion: { status: 'DISMISSED' } }).svc.sourceStatus(make({ suggestion: { status: 'DISMISSED' } }).ctx, 'STOCK_MOVEMENT', 'm1')).suggested).toBe(false);
    const open = make({ suggestion: { status: 'OPEN' } });
    expect((await open.svc.sourceStatus(open.ctx, 'STOCK_MOVEMENT', 'm1')).suggested).toBe(true);
  });
  it('claim is atomic: the second concurrent claimer loses', async () => {
    expect(await make({ claimCount: 1 }).svc.claim(make().ctx, 'SALES_INVOICE', 'inv1')).toBe(true);
    const lost = make({ claimCount: 0 });
    expect(await lost.svc.claim(lost.ctx, 'SALES_INVOICE', 'inv1')).toBe(false);
  });
  it('rejects unknown source types', () => {
    expect(() => make().svc.assertType('BOGUS')).toThrow();
  });
});

describe('DispatchService scope (out-of-scope => 404, no access => 403)', () => {
  const make = (matrix: Record<string, boolean>, found: boolean, handler = false) => {
    const permissions = { getEffective: vi.fn(async () => ({ canViewAll: false, canViewOwn: false, canCreate: false, canEdit: false, canDelete: false, ...matrix })) } as any;
    const tenantDb = {
      shipment: { findFirst: vi.fn(async () => (found ? { id: 's1' } : null)), findUnique: vi.fn(async () => ({ id: 's1' })) },
      task: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => (handler ? { id: 't1' } : null)) },
    };
    const svc = new DispatchService(permissions, {} as any, { registerHandler: vi.fn() } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, ctx: { auth: { role: 'MEMBER', sub: 'g', type: 'user' }, tenantDb } as any, actor: { userId: 'u1', name: 'x', roleIds: [], manager: false } };
  };

  it('view-own user cannot open a shipment outside their scope', async () => {
    const { svc, ctx, actor } = make({ canViewOwn: true }, false);
    await expect(svc.load(ctx, actor, 's1')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('view-own user opens their own shipment', async () => {
    const { svc, ctx, actor } = make({ canViewOwn: true }, true);
    expect((await svc.load(ctx, actor, 's1')).handlerOnly).toBe(false);
  });
  it('the docs-task handler gets handler-only access without any dispatch matrix', async () => {
    const { svc, ctx, actor } = make({}, false, true);
    expect((await svc.load(ctx, actor, 's1')).handlerOnly).toBe(true);
  });
  it('no access at all: list scope is forbidden, id access is 404', async () => {
    const { svc, ctx, actor } = make({}, false);
    await expect(svc.scopeWhere(ctx, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.load(ctx, actor, 's1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DispatchReportService.activeCounts (dashboard widget)', () => {
  const make = (scope: Record<string, unknown> | Error) => {
    const groupBy = vi.fn(async (_args: unknown) => [
      { status: 'AWAITING_DRIVER', _count: { _all: 2 } },
      { status: 'OFFERED', _count: { _all: 1 } },
      { status: 'IN_TRANSIT', _count: { _all: 4 } },
      { status: 'SUSPENDED', _count: { _all: 1 } },
    ]);
    const tenantDb = { shipment: { groupBy, findMany: vi.fn() }, user: { findUnique: vi.fn(async () => ({ id: 'u1', name: 'x' })) }, userRole: { findMany: vi.fn(async () => []) } };
    const dispatch = { scopeWhere: vi.fn(async () => { if (scope instanceof Error) throw scope; return scope; }) };
    const ctx = { tenantDb, auth: { type: 'jwt', sub: 'g1', role: 'MEMBER' } } as any;
    return { svc: new DispatchReportService(dispatch as any), ctx, groupBy, dispatch, tenantDb };
  };

  it('aggregates active statuses with one groupBy, scoped, excluding terminal statuses', async () => {
    const scope = { OR: [{ createdByUserId: 'u1' }] };
    const { svc, ctx, groupBy, tenantDb } = make(scope);
    const r = await svc.activeCounts(ctx);
    expect(r).toMatchObject({ active: 8, awaitingDriver: 3, inTransit: 4, suspended: 1, readyToDepart: 0, awaitingDocs: 0 });
    const arg = groupBy.mock.calls[0][0] as any;
    expect(arg.by).toEqual(['status']);
    expect(JSON.stringify(arg.where)).toContain(JSON.stringify(scope));
    expect(arg.where.AND).toContainEqual({ status: { notIn: expect.arrayContaining(['DELIVERED', 'CANCELLED']) } });
    expect(tenantDb.shipment.findMany).not.toHaveBeenCalled();
  });

  it('propagates the permission failure (no access -> no counts)', async () => {
    const { svc, ctx, groupBy } = make(new ForbiddenException('x'));
    await expect(svc.activeCounts(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
