import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { assertInScope } from './scope.util.js';

describe('assertInScope', () => {
  it('skips the query for an empty (view-all) scope', async () => {
    const delegate = { findFirst: vi.fn() };
    await assertInScope(delegate, {}, { id: 'a' });
    expect(delegate.findFirst).not.toHaveBeenCalled();
  });

  it('merges scope and id and passes when the record is in scope', async () => {
    const delegate = { findFirst: vi.fn(async () => ({ id: 'a' })) };
    await assertInScope(delegate, { createdByUserId: 'u1' }, { id: 'a' });
    expect(delegate.findFirst).toHaveBeenCalledWith({ where: { id: 'a', createdByUserId: 'u1' }, select: { id: true } });
  });

  it('throws 404 when the record is out of scope', async () => {
    const delegate = { findFirst: vi.fn(async () => null) };
    await expect(assertInScope(delegate, { createdByUserId: 'u1' }, { id: 'a' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('nests the scope under the parent relation for child resources', async () => {
    const delegate = { findFirst: vi.fn(async () => ({ id: 'w' })) };
    await assertInScope(delegate, { createdByUserId: 'u1' }, { id: 'w' }, { wrap: (s) => ({ contract: s }) });
    expect(delegate.findFirst).toHaveBeenCalledWith({ where: { id: 'w', contract: { createdByUserId: 'u1' } }, select: { id: true } });
  });
});
