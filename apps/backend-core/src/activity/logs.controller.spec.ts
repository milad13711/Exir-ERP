import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LogsController, buildActivityWhere, parseDateRange } from './logs.controller.js';

function mk(role: 'OWNER' | 'ADMIN' | 'MEMBER', opts: { viewAll?: boolean; userId?: string | null } = {}) {
  const findMany = vi.fn().mockResolvedValue([]);
  const findFirst = vi.fn().mockResolvedValue(null);
  const count = vi.fn().mockResolvedValue(0);
  const ctx = {
    auth: { sub: 'g1', role, type: 'tenant_user' },
    tenantId: 't1',
    tenantDb: {
      activityLog: { findMany, findFirst, count },
      user: { findUnique: vi.fn().mockResolvedValue(opts.userId === null ? null : { id: opts.userId ?? 'me' }), findMany: vi.fn().mockResolvedValue([]) },
    },
  } as never;
  const permissions = { getEffective: vi.fn().mockResolvedValue({ canViewAll: !!opts.viewAll }) } as never;
  const submissions = { compute: vi.fn().mockResolvedValue({}), getCutoff: vi.fn(), setCutoff: vi.fn() } as never;
  const controller = new LogsController({} as never, permissions, submissions);
  return { controller, ctx, findMany, findFirst, count, submissions };
}

describe('logs scoping', () => {
  it('non-manager without view-all only sees their own rows, ignoring a forged userId filter', async () => {
    const { controller, ctx, findMany } = mk('MEMBER');
    await controller.activity(undefined, 'someone-else', undefined, undefined, undefined, undefined, undefined, undefined, undefined, ctx);
    const where = findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"userId":"me"');
    expect(JSON.stringify(where)).not.toContain('someone-else');
  });

  it('a non-manager whose tenant user cannot be resolved sees nothing (never everything)', async () => {
    const { controller, ctx, findMany } = mk('MEMBER', { userId: null });
    await controller.activity(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, ctx);
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain('__none__');
  });

  it('OWNER/ADMIN and users with the logs view-all permission see everyone and may filter by person', async () => {
    for (const mkd of [mk('OWNER'), mk('ADMIN'), mk('MEMBER', { viewAll: true })]) {
      await mkd.controller.activity(undefined, 'u7', undefined, undefined, undefined, undefined, undefined, undefined, undefined, mkd.ctx);
      expect(JSON.stringify(mkd.findMany.mock.calls[0][0].where)).toContain('"userId":"u7"');
    }
  });

  it('by-id lookup is scoped too (another person\'s row → 404)', async () => {
    const { controller, ctx, findFirst } = mk('MEMBER');
    await expect(controller.activityById('log1', ctx)).rejects.toBeInstanceOf(NotFoundException);
    const where = findFirst.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"userId":"me"');
    expect(JSON.stringify(where)).toContain('log1');
  });

  it('daily-report submissions are limited to the caller for non-managers', async () => {
    const { controller, ctx, submissions } = mk('MEMBER');
    await controller.dailyReports(undefined, undefined, 'other-user', ctx);
    expect((submissions as { compute: ReturnType<typeof vi.fn> }).compute.mock.calls[0][1].userIds).toEqual(['me']);
  });

  it('errors and cutoff settings are manager-only', async () => {
    const { controller, ctx } = mk('MEMBER', { viewAll: true });
    await expect(controller.errors(undefined, undefined, undefined, undefined, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.putSettings({ time: '18:00' }, ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('buildActivityWhere filters', () => {
  it('combines module, actor type, action type, search and Tehran date range', () => {
    const where = buildActivityWhere({ all: true }, { module: 'crm', actorType: 'AUTOMATIC', actionType: 'send', q: 'فاکتور', from: '2026-10-01', to: '2026-10-01' });
    const s = JSON.stringify(where);
    expect(s).toContain('"moduleCode":"crm"');
    expect(s).toContain('"actorType":"AUTOMATIC"');
    expect(s).toContain('"actionType":"send"');
    expect(s).toContain('فاکتور');
    const range = parseDateRange('2026-10-01', '2026-10-01')!;
    expect(range.gte!.toISOString()).toBe('2026-09-30T20:30:00.000Z');
    expect(range.lte!.toISOString()).toBe('2026-10-01T20:29:59.999Z');
  });
  it('ignores an invalid actor type', () => {
    expect(JSON.stringify(buildActivityWhere({ all: true }, { actorType: 'HACK' }))).toBe('{}');
  });
});
