import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PurchaseReturnsService } from './purchase-returns.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

function makeCtx(opts: { ret: unknown; original?: unknown }) {
  const journalCreates: Array<Record<string, any>> = [];
  const journalUpdates: Array<Record<string, any>> = [];
  const movements: Array<Record<string, any>> = [];
  const returnDeletes: Array<Record<string, any>> = [];
  const tenantDb: any = {
    account: { count: vi.fn().mockResolvedValue(11) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1' }) },
    warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 'wh-1' }) },
    purchaseReturn: {
      findUnique: vi.fn().mockResolvedValue(opts.ret),
      delete: vi.fn((a) => {
        returnDeletes.push(a);
        return Promise.resolve({});
      }),
    },
    journalEntry: {
      findUnique: vi.fn().mockResolvedValue(opts.original ?? null),
      create: vi.fn((a) => {
        journalCreates.push(a.data);
        return Promise.resolve({});
      }),
      update: vi.fn((a) => {
        journalUpdates.push(a);
        return Promise.resolve({});
      }),
    },
    stockMovement: {
      create: vi.fn((a) => {
        movements.push(a.data);
        return Promise.resolve({});
      }),
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const ctx = { tenantDb, auth: { type: 'jwt', sub: 'g-1' } } as unknown as TenantRequestContext;
  return { ctx, journalCreates, journalUpdates, movements, returnDeletes, tenantDb };
}

describe('PurchaseReturnsService.remove', () => {
  const ret = {
    id: 'r1',
    returnNo: 4,
    journalEntryId: 'je-1',
    order: { orderNo: 9 },
    lines: [
      { productId: 'p1', quantity: 3, unitCost: 1000 },
      { productId: null, quantity: 1, unitCost: 500 },
    ],
  };
  const original = {
    id: 'je-1',
    lines: [
      { accountId: 'acc-payable', debit: 3500n, credit: 0n, description: null },
      { accountId: 'acc-inventory', debit: 0n, credit: 3500n, description: null },
    ],
  };

  it('posts a reversal journal entry, voids the original, restores stock and deletes the return', async () => {
    const { ctx, journalCreates, journalUpdates, movements, returnDeletes } = makeCtx({ ret, original });
    await new PurchaseReturnsService().remove(ctx, 'r1');

    expect(journalCreates).toHaveLength(1);
    expect(journalCreates[0].reversalOfId).toBe('je-1');
    expect(journalCreates[0].status).toBe('POSTED');
    expect(journalCreates[0].lines.create).toEqual([
      { accountId: 'acc-payable', debit: 0n, credit: 3500n, description: null },
      { accountId: 'acc-inventory', debit: 3500n, credit: 0n, description: null },
    ]);
    expect(journalUpdates[0].where).toEqual({ id: 'je-1' });
    expect(journalUpdates[0].data.voidedAt).toBeInstanceOf(Date);

    // فقط ردیف دارای کالا حواله‌ی معکوس می‌گیرد، با مقدار مثبت (برگشت موجودی)
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ productId: 'p1', warehouseId: 'wh-1', type: 'RECEIPT', quantityDelta: 3, unitCost: 1000 });

    expect(returnDeletes).toEqual([{ where: { id: 'r1' } }]);
  });

  it('skips the journal reversal when the return never got a journal entry', async () => {
    const { ctx, journalCreates, journalUpdates, returnDeletes } = makeCtx({ ret: { ...ret, journalEntryId: null } });
    await new PurchaseReturnsService().remove(ctx, 'r1');
    expect(journalCreates).toHaveLength(0);
    expect(journalUpdates).toHaveLength(0);
    expect(returnDeletes).toHaveLength(1);
  });

  it('throws NotFound for an unknown return and changes nothing', async () => {
    const { ctx, tenantDb } = makeCtx({ ret: null });
    await expect(new PurchaseReturnsService().remove(ctx, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(tenantDb.$transaction).not.toHaveBeenCalled();
  });
});
