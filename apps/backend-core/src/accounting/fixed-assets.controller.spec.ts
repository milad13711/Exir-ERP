import { describe, expect, it, vi } from 'vitest';
import { FixedAssetsController } from './fixed-assets.controller.js';

const perms = { assertEdit: vi.fn() } as any;

function makeCtx(asset: any) {
  return {
    tenantDb: {
      fixedAsset: {
        findUnique: vi.fn(async () => asset),
        update: vi.fn(async ({ data }: any) => ({ ...asset, ...data })),
      },
    },
  } as any;
}

const asset = {
  id: 'f1', name: 'لپ‌تاپ', purchaseDate: new Date('2025-01-01'), purchaseCost: 12_000_000,
  salvageValue: 0, usefulLifeMonths: 12, postedDepreciation: 0, status: 'ACTIVE',
};

describe('FixedAssetsController.update', () => {
  const c = new FixedAssetsController(perms);

  it('updates purchase details before any depreciation is posted', async () => {
    const ctx = makeCtx(asset);
    const r = await c.update('f1', { name: 'لپ‌تاپ جدید', purchaseCost: 15_000_000 }, ctx);
    expect(r.name).toBe('لپ‌تاپ جدید');
    expect(r.purchaseCost).toBe(15_000_000);
    expect(r.depreciation).toBeDefined();
  });

  it('refuses once depreciation has been posted', async () => {
    await expect(c.update('f1', { purchaseCost: 1 }, makeCtx({ ...asset, postedDepreciation: 500 }))).rejects.toThrow(/استهلاک/);
  });

  it('refuses disposed assets', async () => {
    await expect(c.update('f1', { name: 'x' }, makeCtx({ ...asset, status: 'DISPOSED' }))).rejects.toThrow(/واگذار/);
  });

  it('404s on unknown asset', async () => {
    await expect(c.update('nope', { name: 'x' }, makeCtx(null))).rejects.toThrow(/یافت نشد/);
  });
});
