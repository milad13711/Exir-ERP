import { describe, expect, it } from 'vitest';
import { breaksStockHistory, breaksStockHistoryRemovingMany, deltaFor, isActiveMovement, movementAmendBlock, type MovementLike } from './movement-rules.js';
import { replayCostPrice } from './costing.service.js';

const mv = (over: Partial<MovementLike> = {}): MovementLike => ({
  type: 'RECEIPT', origin: 'MANUAL', reference: null, transferGroupId: null, voidedAt: null, reversalOfId: null, importBatchId: null, ...over,
});
const d = (day: number) => new Date(2026, 0, day);

describe('movementAmendBlock', () => {
  it('manual receipts/issues/adjustments are amendable', () => {
    for (const type of ['RECEIPT', 'ISSUE', 'ADJUSTMENT']) expect(movementAmendBlock(mv({ type }))).toBeNull();
  });
  it('legacy rows without origin are amendable only when the reference is not system generated', () => {
    expect(movementAmendBlock(mv({ origin: null, reference: 'رسید دستی' }))).toBeNull();
    expect(movementAmendBlock(mv({ origin: null, type: 'ISSUE', reference: 'فاکتور فروش #12' }))).toMatch(/فاکتور فروش/);
    expect(movementAmendBlock(mv({ origin: null, reference: 'سفارش خرید #3' }))).toMatch(/سفارش خرید/);
    expect(movementAmendBlock(mv({ origin: null, type: 'ISSUE', reference: 'سفارش فروشگاه آنلاین #4' }))).toMatch(/فروشگاه/);
  });
  it('documents owned by other modules are blocked by type', () => {
    for (const type of ['SALES_RETURN', 'PURCHASE_RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'PRODUCTION_CONSUME', 'PRODUCTION_YIELD']) {
      expect(movementAmendBlock(mv({ type }))).toMatch(/فقط از همان سند/);
    }
  });
  it('voided rows, reversal rows and opening-import rows are blocked', () => {
    expect(movementAmendBlock(mv({ voidedAt: new Date() }))).toMatch(/قبلاً باطل/);
    expect(movementAmendBlock(mv({ reversalOfId: 'x' }))).toMatch(/معکوس/);
    expect(movementAmendBlock(mv({ origin: 'OPENING_IMPORT', importBatchId: 'b' }))).toMatch(/موجودی اولیه/);
  });
});

describe('breaksStockHistory', () => {
  const hist = [
    { id: 'r1', createdAt: d(1), quantityDelta: 10 },
    { id: 'i1', createdAt: d(2), quantityDelta: -6 },
    { id: 'r2', createdAt: d(3), quantityDelta: 5 },
  ];
  it('allows increasing a receipt', () => {
    expect(breaksStockHistory(hist, { id: 'r1', newDelta: 20 }).broken).toBe(false);
  });
  it('allows shrinking a receipt while later issues are still covered', () => {
    expect(breaksStockHistory(hist, { id: 'r1', newDelta: 6 }).broken).toBe(false);
  });
  it('blocks shrinking a receipt below what a later issue already consumed', () => {
    const r = breaksStockHistory(hist, { id: 'r1', newDelta: 5 });
    expect(r.broken).toBe(true);
    expect(r.minAfter).toBe(-1);
  });
  it('blocks voiding a receipt that later issues depend on, even if the final stock stays positive', () => {
    // r2 (+5) later brings the final balance to 9; removing r1 would still leave the interim balance negative
    expect(breaksStockHistory(hist, { id: 'r1', newDelta: null }).broken).toBe(true);
  });
  it('allows voiding a receipt nobody consumed', () => {
    expect(breaksStockHistory(hist, { id: 'r2', newDelta: null }).broken).toBe(false);
  });
  it('allows raising an issue only within available stock', () => {
    expect(breaksStockHistory(hist, { id: 'i1', newDelta: -10 }).broken).toBe(false);
    expect(breaksStockHistory(hist, { id: 'i1', newDelta: -11 }).broken).toBe(true);
  });
  it('does not block when history was already negative and the change does not worsen it', () => {
    const bad = [{ id: 'i0', createdAt: d(1), quantityDelta: -3 }, { id: 'r1', createdAt: d(2), quantityDelta: 10 }];
    expect(breaksStockHistory(bad, { id: 'r1', newDelta: 12 }).broken).toBe(false);
    expect(breaksStockHistory(bad, { id: 'i0', newDelta: -5 }).broken).toBe(true);
  });
  it('removing many rows (opening batch) is checked as a group', () => {
    const rows = [
      { id: 'a', createdAt: d(1), quantityDelta: 5 },
      { id: 'b', createdAt: d(2), quantityDelta: 5 },
      { id: 'i', createdAt: d(3), quantityDelta: -4 },
    ];
    expect(breaksStockHistoryRemovingMany(rows, new Set(['a'])).broken).toBe(false);
    expect(breaksStockHistoryRemovingMany(rows, new Set(['a', 'b'])).broken).toBe(true);
  });
});

describe('helpers', () => {
  it('deltaFor signs by type', () => {
    expect(deltaFor('RECEIPT', 4)).toBe(4);
    expect(deltaFor('ISSUE', 4)).toBe(-4);
    expect(deltaFor('ADJUSTMENT', -4)).toBe(-4);
  });
  it('voided originals and reversal rows are both inactive', () => {
    expect(isActiveMovement({ voidedAt: null, reversalOfId: null })).toBe(true);
    expect(isActiveMovement({ voidedAt: new Date(), reversalOfId: null })).toBe(false);
    expect(isActiveMovement({ voidedAt: null, reversalOfId: 'x' })).toBe(false);
  });
});

describe('replayCostPrice (cost recompute after edit/void)', () => {
  const rows = [
    { quantityDelta: 10, unitCost: 100, createdAt: d(1) },
    { quantityDelta: -4, unitCost: null, createdAt: d(2) },
    { quantityDelta: 6, unitCost: 200, createdAt: d(3) },
  ];
  it('LAST_COST/FIFO use the latest priced receipt', () => {
    expect(replayCostPrice('LAST_COST', rows)).toBe(200);
    expect(replayCostPrice('FIFO', rows.slice(0, 2))).toBe(100);
  });
  it('WEIGHTED_AVERAGE replays history in order', () => {
    // after issue stock=6 @100 ; receipt 6 @200 -> (6*100+6*200)/12 = 150
    expect(replayCostPrice('WEIGHTED_AVERAGE', rows)).toBe(150);
  });
  it('returns null when no priced receipt remains (cost left untouched)', () => {
    expect(replayCostPrice('WEIGHTED_AVERAGE', [{ quantityDelta: -1, unitCost: null, createdAt: d(1) }])).toBeNull();
    expect(replayCostPrice('LAST_COST', [])).toBeNull();
  });
});
