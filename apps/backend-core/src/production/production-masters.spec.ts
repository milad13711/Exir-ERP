import { describe, expect, it, vi } from 'vitest';
import { BomsController } from './boms.controller.js';
import { WorkCentersController } from './work-centers.controller.js';
import { bomContentChanged, findBomCycle, normalizeName, validateBomLines } from './bom-rules.js';

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const P3 = '33333333-3333-3333-3333-333333333333';

function perms(denyDelete = false) {
  return {
    assertView: vi.fn(),
    assertCreate: vi.fn(),
    assertEdit: vi.fn(),
    assertDelete: vi.fn(async () => {
      if (denyDelete) throw new Error('forbidden');
    }),
  } as any;
}

function bomRow(over: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    outputProductId: P1,
    batchOutputQty: 100,
    version: 1,
    isActive: true,
    archivedAt: null,
    notes: null,
    lines: [{ id: 'l1', rawMaterialProductId: P2, quantityPerBatch: 5 }],
    _count: { productionOrders: 0 },
    ...over,
  };
}

function bomCtx(bom: any, extra: Record<string, unknown> = {}) {
  const tx = vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
  const db: any = {
    billOfMaterial: {
      findUnique: vi.fn(async () => bom),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => ({ id: 'b2', ...data, lines: [], _count: { productionOrders: 0 } })),
      update: vi.fn(async ({ data }: any) => ({ ...bom, ...data, _count: bom?._count })),
      delete: vi.fn(async () => ({})),
    },
    billOfMaterialLine: { deleteMany: vi.fn(async () => ({})) },
    product: { findMany: vi.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id, name: id }))), findUnique: vi.fn() },
    $transaction: tx,
    ...extra,
  };
  db.user = { findUnique: vi.fn(async () => ({ id: 'u1' })) };
  return { tenantDb: db, auth: { role: 'OWNER', sub: 'g1' } } as any;
}

describe('bom-rules (pure)', () => {
  it('validates quantities, duplicates and self reference', () => {
    expect(validateBomLines(P1, 10, [{ rawMaterialProductId: P2, quantityPerBatch: 1 }])).toBeNull();
    expect(validateBomLines(P1, 0, [{ rawMaterialProductId: P2, quantityPerBatch: 1 }])).toMatch(/بزرگ‌تر از صفر/);
    expect(validateBomLines(P1, 10, [{ rawMaterialProductId: P2, quantityPerBatch: 0 }])).toMatch(/بزرگ‌تر از صفر/);
    expect(validateBomLines(P1, 10, [])).toMatch(/حداقل یک/);
    expect(validateBomLines(P1, 10, [{ rawMaterialProductId: P1, quantityPerBatch: 1 }])).toMatch(/خودش/);
    expect(
      validateBomLines(P1, 10, [
        { rawMaterialProductId: P2, quantityPerBatch: 1 },
        { rawMaterialProductId: P2, quantityPerBatch: 2 },
      ]),
    ).toMatch(/بیش از یک بار/);
  });

  it('detects direct and transitive cycles, not diamonds', () => {
    expect(findBomCycle(P1, [P2], new Map([[P2, [P1]]]))).not.toBeNull();
    expect(findBomCycle(P1, [P2], new Map([[P2, [P3]], [P3, [P1]]]))).not.toBeNull();
    expect(findBomCycle(P1, [P2, P3], new Map([[P2, [P3]]]))).toBeNull();
  });

  it('normalizes names and detects content changes', () => {
    expect(normalizeName('  خط  پلت ')).toBe(normalizeName('خط پلت'));
    expect(normalizeName('علي')).toBe(normalizeName('علی'));
    const cur = { batchOutputQty: 10, lines: [{ rawMaterialProductId: P2, quantityPerBatch: 1 }] };
    expect(bomContentChanged(cur, { ...cur })).toBe(false);
    expect(bomContentChanged(cur, { batchOutputQty: 11, lines: cur.lines })).toBe(true);
    expect(bomContentChanged(cur, { batchOutputQty: 10, lines: [{ rawMaterialProductId: P2, quantityPerBatch: 2 }] })).toBe(true);
  });
});

describe('BomsController edit / versioning', () => {
  const make = (p = perms()) => new (BomsController as any)(p) as BomsController;

  it('edits in place when no order uses the BOM', async () => {
    const ctx = bomCtx(bomRow());
    const out: any = await make().update('b1', { batchOutputQty: 200 }, ctx);
    expect(ctx.tenantDb.billOfMaterial.create).not.toHaveBeenCalled();
    expect(ctx.tenantDb.billOfMaterialLine.deleteMany).toHaveBeenCalled();
    expect(out.versioned).toBe(false);
  });

  it('creates a new version and leaves the used BOM lines untouched', async () => {
    const used = bomRow({ _count: { productionOrders: 12 }, version: 3 });
    const ctx = bomCtx(used, {});
    ctx.tenantDb.billOfMaterial.findFirst = vi.fn(async () => ({ version: 3 }));
    const out: any = await make().update('b1', { lines: [{ rawMaterialProductId: P2, quantityPerBatch: 9 }] }, ctx);
    expect(out.versioned).toBe(true);
    const createArg = ctx.tenantDb.billOfMaterial.create.mock.calls[0][0].data;
    expect(createArg.version).toBe(4);
    expect(createArg.lines.create[0].quantityPerBatch).toBe(9);
    // old row: only deactivated, lines never deleted
    expect(ctx.tenantDb.billOfMaterial.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { isActive: false } });
    expect(ctx.tenantDb.billOfMaterialLine.deleteMany).not.toHaveBeenCalled();
  });

  it('notes-only edit on a used BOM does not version', async () => {
    const ctx = bomCtx(bomRow({ _count: { productionOrders: 4 } }));
    await make().update('b1', { notes: 'یادداشت' }, ctx);
    expect(ctx.tenantDb.billOfMaterial.create).not.toHaveBeenCalled();
    expect(ctx.tenantDb.billOfMaterial.update).toHaveBeenCalledWith(expect.objectContaining({ data: { notes: 'یادداشت' } }));
  });

  it('rejects invalid quantities, cycles and editing inactive versions', async () => {
    await expect(make().update('b1', { lines: [{ rawMaterialProductId: P2, quantityPerBatch: 0 }] }, bomCtx(bomRow()))).rejects.toThrow(/بزرگ‌تر از صفر/);
    const cyc = bomCtx(bomRow());
    cyc.tenantDb.billOfMaterial.findMany = vi.fn(async () => [{ outputProductId: P3, lines: [{ rawMaterialProductId: P1 }] }]);
    await expect(make().update('b1', { lines: [{ rawMaterialProductId: P3, quantityPerBatch: 1 }] }, cyc)).rejects.toThrow(/چرخه‌ای/);
    await expect(make().update('b1', { batchOutputQty: 5 }, bomCtx(bomRow({ isActive: false, archivedAt: new Date() })))).rejects.toThrow(/بایگانی/);
    await expect(make().update('b1', { batchOutputQty: 5 }, bomCtx(bomRow({ isActive: false })))).rejects.toThrow(/جایگزین/);
  });

  it('blocks delete when referenced (with usage count) and deletes when unreferenced', async () => {
    const used = bomCtx(bomRow({ _count: { productionOrders: 12 } }));
    await expect(make().remove('b1', used)).rejects.toThrow(/12 دستور تولید|۱۲|12/);
    expect(used.tenantDb.billOfMaterial.delete).not.toHaveBeenCalled();
    const free = bomCtx(bomRow());
    await expect(make().remove('b1', free)).resolves.toEqual({ success: true });
    expect(free.tenantDb.billOfMaterial.delete).toHaveBeenCalled();
  });

  it('archive then restore; restore blocked when another active version exists', async () => {
    const ctx = bomCtx(bomRow());
    await make().archive('b1', ctx);
    expect(ctx.tenantDb.billOfMaterial.update.mock.calls[0][0].data.isActive).toBe(false);
    expect(ctx.tenantDb.billOfMaterial.update.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);

    const archived = bomRow({ isActive: false, archivedAt: new Date() });
    const ok = bomCtx(archived);
    await make().restore('b1', ok);
    expect(ok.tenantDb.billOfMaterial.update.mock.calls[0][0].data).toEqual({ isActive: true, archivedAt: null });

    const conflict = bomCtx(archived);
    conflict.tenantDb.billOfMaterial.findFirst = vi.fn(async () => ({ id: 'other' }));
    await expect(make().restore('b1', conflict)).rejects.toThrow(/فرمول فعال دیگری/);
  });

  it('enforces the production permission matrix (edit / delete)', async () => {
    const p = perms(true);
    const c = make(p);
    await expect(c.remove('b1', bomCtx(bomRow()))).rejects.toThrow('forbidden');
    expect(p.assertDelete).toHaveBeenCalledWith(expect.anything(), 'production');
    await c.update('b1', { notes: 'x' }, bomCtx(bomRow()));
    expect(p.assertEdit).toHaveBeenCalledWith(expect.anything(), 'production');
  });
});

describe('WorkCentersController edit / archive / delete', () => {
  const make = (p = perms()) => new (WorkCentersController as any)(p) as WorkCentersController;
  function wcCtx(row: any, all: any[] = []) {
    return {
      tenantDb: {
        workCenter: {
          findUnique: vi.fn(async () => row),
          findMany: vi.fn(async () => all),
          create: vi.fn(async ({ data }: any) => ({ id: 'n', ...data })),
          update: vi.fn(async ({ data }: any) => ({ ...row, ...data })),
          delete: vi.fn(async () => ({})),
        },
      },
    } as any;
  }
  const row = (over: Record<string, unknown> = {}) => ({ id: 'w1', name: 'خط پلت', sequenceOrder: 1, isActive: true, _count: { stages: 0 }, ...over });

  it('renames and reorders; duplicate names rejected (normalized, incl. archived)', async () => {
    const ctx = wcCtx(row(), [{ id: 'w1', name: 'خط پلت', isActive: true }, { id: 'w2', name: 'بسته‌بندی', isActive: false }]);
    await expect(make().update('w1', { name: 'خط جدید', sequenceOrder: 5 }, ctx)).resolves.toMatchObject({ name: 'خط جدید', sequenceOrder: 5 });
    await expect(make().update('w1', { name: ' بسته‌بندی ' }, ctx)).rejects.toThrow(/بایگانی/);
    await expect(make().create({ name: 'خط  پلت' }, ctx)).rejects.toThrow(/وجود دارد/);
    // renaming to its own name is fine
    await expect(make().update('w1', { name: 'خط پلت' }, ctx)).resolves.toBeDefined();
  });

  it('blocks delete when used by stages, deletes when free, archive/restore toggles', async () => {
    const used = wcCtx(row({ _count: { stages: 7 } }));
    await expect(make().remove('w1', used)).rejects.toThrow(/7 مرحله|۷|7/);
    expect(used.tenantDb.workCenter.delete).not.toHaveBeenCalled();
    const free = wcCtx(row());
    await expect(make().remove('w1', free)).resolves.toEqual({ success: true });

    const a = wcCtx(row());
    await make().archive('w1', a);
    expect(a.tenantDb.workCenter.update.mock.calls[0][0].data.isActive).toBe(false);
    const r = wcCtx(row({ isActive: false }));
    await make().restore('w1', r);
    expect(r.tenantDb.workCenter.update.mock.calls[0][0].data).toEqual({ isActive: true, archivedAt: null });
  });

  it('delete requires the delete permission', async () => {
    const p = perms(true);
    await expect(make(p).remove('w1', wcCtx(row()))).rejects.toThrow('forbidden');
  });
});
