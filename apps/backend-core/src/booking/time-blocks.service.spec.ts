import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { TimeBlocksService, MAX_BLOCKS_PER_USER } from './time-blocks.service.js';

function setup(opts: { role?: 'OWNER' | 'ADMIN' | 'MEMBER'; matrix?: { canViewAll: boolean; canEdit: boolean }; block?: Record<string, unknown> | null; count?: number }) {
  const tenantDb = {
    user: { findUnique: vi.fn().mockImplementation(({ where }: { where: { id?: string; globalUserId?: string } }) => Promise.resolve(where.globalUserId ? { id: 'me' } : where.id === 'other' ? { id: 'other' } : null)) },
    staffTimeBlock: {
      findUnique: vi.fn().mockResolvedValue(opts.block ?? null),
      count: vi.fn().mockResolvedValue(opts.count ?? 0),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'n', ...data })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'b', ...data })),
      delete: vi.fn().mockResolvedValue({}),
    },
    staffBookingPreference: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
  };
  const permissions = { getEffective: vi.fn().mockResolvedValue({ canViewAll: opts.matrix?.canViewAll ?? false, canEdit: opts.matrix?.canEdit ?? false }) };
  const blocks = { loadBusyRanges: vi.fn().mockResolvedValue([]) };
  const service = new TimeBlocksService(permissions as never, blocks as never);
  const ctx = { tenantDb, auth: { role: opts.role ?? 'MEMBER', sub: 'g', type: 'user' } } as never;
  return { service, ctx, tenantDb, blocks };
}
const input = { startDate: '2027-01-10', endDate: '2027-01-10', startMinute: 600, endMinute: 660 };

describe('TimeBlocksService permissions', () => {
  it('a provider creates a block for themself (no userId)', async () => {
    const { service, ctx, tenantDb } = setup({});
    await service.create(ctx, input as never);
    expect(tenantDb.staffTimeBlock.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'me' }) });
  });
  it('a plain provider cannot create for another user', async () => {
    const { service, ctx } = setup({});
    await expect(service.create(ctx, { ...input, userId: 'other' } as never)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('view-all alone (without edit) is not enough to manage another provider', async () => {
    const { service, ctx } = setup({ matrix: { canViewAll: true, canEdit: false } });
    await expect(service.create(ctx, { ...input, userId: 'other' } as never)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('a manager (view-all + edit) can create for another user; unknown user is 404', async () => {
    const { service, ctx, tenantDb } = setup({ matrix: { canViewAll: true, canEdit: true } });
    await service.create(ctx, { ...input, userId: 'other' } as never);
    expect(tenantDb.staffTimeBlock.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'other', createdByUserId: 'me' }) });
    await expect(service.create(ctx, { ...input, userId: 'ghost' } as never)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('OWNER/ADMIN (full matrix) can manage others', async () => {
    const { service, ctx } = setup({ role: 'OWNER', matrix: { canViewAll: true, canEdit: true } });
    await expect(service.create(ctx, { ...input, userId: 'other' } as never)).resolves.toBeTruthy();
  });
  it('delete/update of someone else’s block is forbidden for a provider, allowed for the owner of the block', async () => {
    const mine = setup({ block: { id: 'b', userId: 'me', startDate: '2027-01-10', endDate: '2027-01-10', startMinute: 600, endMinute: 660, weekdays: [], reason: null } });
    await expect(mine.service.remove(mine.ctx, 'b')).resolves.toEqual({ ok: true });
    await expect(mine.service.update(mine.ctx, 'b', { reason: 'x' } as never)).resolves.toBeTruthy();
    const theirs = setup({ block: { id: 'b', userId: 'other', startDate: '2027-01-10', endDate: '2027-01-10', startMinute: null, endMinute: null, weekdays: [], reason: null } });
    await expect(theirs.service.remove(theirs.ctx, 'b')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(theirs.service.update(theirs.ctx, 'b', { reason: 'x' } as never)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('missing block is 404', async () => {
    const { service, ctx } = setup({});
    await expect(service.remove(ctx, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('preferences and auto-preview for another user also need manager access', async () => {
    const { service, ctx } = setup({});
    await expect(service.updatePreferences(ctx, { userId: 'other', blockFromTasks: false })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.autoPreview(ctx, 'other')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('validation and per-user cap', async () => {
    const { service, ctx } = setup({});
    await expect(service.create(ctx, { ...input, endMinute: 500 } as never)).rejects.toBeInstanceOf(BadRequestException);
    const full = setup({ count: MAX_BLOCKS_PER_USER });
    await expect(full.service.create(full.ctx, input as never)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('preferences default to all-on, and upsert writes only provided flags', async () => {
    const { service, ctx, tenantDb } = setup({});
    expect(await service.getPreferences(ctx, 'me')).toEqual({ blockFromTasks: true, blockFromCalendar: true, blockFromLeave: true });
    await service.updatePreferences(ctx, { blockFromTasks: false });
    expect(tenantDb.staffBookingPreference.upsert).toHaveBeenCalledWith({ where: { userId: 'me' }, create: { userId: 'me', blockFromTasks: false }, update: { blockFromTasks: false } });
  });
  it('auto-preview excludes manual ranges and exposes the reason', async () => {
    const { service, ctx, blocks } = setup({});
    blocks.loadBusyRanges.mockResolvedValue([
      { userId: 'me', start: new Date('2027-01-10T06:00Z'), end: new Date('2027-01-10T07:00Z'), source: 'task', reason: 'به‌دلیل وظیفه TASK-000123' },
      { userId: 'me', start: new Date('2027-01-09T06:00Z'), end: new Date('2027-01-09T07:00Z'), source: 'manual', reason: 'm' },
    ]);
    const r = await service.autoPreview(ctx);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe('به‌دلیل وظیفه TASK-000123');
  });
});
