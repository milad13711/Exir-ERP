import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ChecksController } from './checks.controller.js';

const m = (o: Partial<Record<'canViewAll' | 'canViewOwn', boolean>>) => ({ canViewAll: false, canViewOwn: false, canCreate: false, canEdit: false, canDelete: false, ...o });

function setup(sales: ReturnType<typeof m>, purchasing: ReturnType<typeof m>) {
  const perms = { getEffective: vi.fn(async (_c: unknown, mod: string) => (mod === 'sales' ? sales : purchasing)), assertEdit: vi.fn() } as any;
  const checks = { list: vi.fn(async () => []), detail: vi.fn(async () => ({})), markCleared: vi.fn(async () => 'ok') } as any;
  const ctx = { auth: { type: 'user', sub: 'g1', role: 'MEMBER' }, tenantDb: { user: { findUnique: vi.fn(async () => ({ id: 'me' })) }, check: { findFirst: vi.fn(async () => null) } } } as any;
  return { c: new (ChecksController as any)(checks, perms) as ChecksController, checks, ctx };
}

describe('ChecksController scoping', () => {
  it('view-all on both modules → unscoped', async () => {
    const { c, checks, ctx } = setup(m({ canViewAll: true }), m({ canViewAll: true }));
    await c.list(undefined, undefined, undefined, undefined, ctx);
    expect(checks.list.mock.calls[0][2]).toEqual({});
  });

  it('view-own on sales only → only own RECEIVED checks, no ISSUED', async () => {
    const { c, checks, ctx } = setup(m({ canViewOwn: true }), m({}));
    await c.list(undefined, undefined, undefined, undefined, ctx);
    expect(checks.list.mock.calls[0][2]).toEqual({ OR: [{ direction: 'RECEIVED', createdByUserId: 'me' }] });
  });

  it('no access to either module → 403', async () => {
    const { c, ctx } = setup(m({}), m({}));
    await expect(c.list(undefined, undefined, undefined, undefined, ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('mutating another user check is a 404 and never reaches the service', async () => {
    const { c, checks, ctx } = setup(m({ canViewOwn: true }), m({}));
    await expect(c.markCleared('k1', ctx)).rejects.toThrow(/چک یافت نشد/);
    expect(checks.markCleared).not.toHaveBeenCalled();
  });
});
