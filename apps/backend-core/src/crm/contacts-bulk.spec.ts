import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ContactsController } from './contacts.controller.js';

function build(opts: { visible: string[]; failDelete?: Record<string, string>; scope?: Record<string, unknown> }) {
  const findMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter((id) => opts.visible.includes(id)).map((id) => ({ id })),
  );
  const del = vi.fn(async ({ where }: { where: { id: string } }) => {
    const code = opts.failDelete?.[where.id];
    if (code) throw Object.assign(new Error('fk'), { code });
    return { id: where.id };
  });
  const permissions = {
    assertDelete: vi.fn(async () => undefined),
    assertEdit: vi.fn(async () => undefined),
    viewScope: vi.fn(async () => opts.scope ?? {}),
  };
  const funnel = {
    transitionLeadStage: vi.fn(async (_c: unknown, id: string) =>
      id === 'conv' ? { ok: false as const, error: 'پس از تبدیل به مشتری دستی نیست' } : { ok: true as const },
    ),
  };
  const ctrl = new ContactsController({} as never, permissions as never, {} as never, {} as never, {} as never, {} as never, funnel as never);
  const ctx = { tenantDb: { crmContact: { findMany, delete: del } } } as never;
  return { ctrl, ctx, findMany, del, permissions, funnel };
}

describe('contacts bulk operations', () => {
  it('bulk-delete deletes each visible contact and reports per-item results', async () => {
    const { ctrl, ctx, del } = build({ visible: ['a', 'b'] });
    const r = await ctrl.bulkDelete({ ids: ['a', 'b', 'x'] }, ctx);
    expect(r.deleted).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.results.find((i) => i.id === 'x')).toEqual({ id: 'x', ok: false, error: 'مخاطب یافت نشد' });
    expect(del).toHaveBeenCalledTimes(2);
  });

  it('bulk-delete deduplicates ids and keeps going after a linked-record failure', async () => {
    const { ctrl, ctx, del } = build({ visible: ['a', 'b'], failDelete: { a: 'P2003' } });
    const r = await ctrl.bulkDelete({ ids: ['a', 'a', 'b'] }, ctx);
    expect(del).toHaveBeenCalledTimes(2);
    expect(r.deleted).toBe(1);
    expect(r.results[0].ok).toBe(false);
    expect(r.results[0].error).toContain('وصل است');
    expect(r.results[1]).toEqual({ id: 'b', ok: true });
  });

  it('bulk-delete never touches contacts outside the caller scope', async () => {
    const { ctrl, ctx, findMany, del } = build({ visible: [], scope: { ownerUserId: 'u1' } });
    const r = await ctrl.bulkDelete({ ids: ['a'] }, ctx);
    expect((findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where.ownerUserId).toBe('u1');
    expect(del).not.toHaveBeenCalled();
    expect(r.failed).toBe(1);
  });

  it('bulk-delete requires delete permission', async () => {
    const { ctrl, ctx, permissions, del } = build({ visible: ['a'] });
    permissions.assertDelete.mockRejectedValueOnce(new ForbiddenException('no'));
    await expect(ctrl.bulkDelete({ ids: ['a'] }, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(del).not.toHaveBeenCalled();
  });

  it('bulk-stage reuses the single-contact transition rules per item', async () => {
    const { ctrl, ctx, funnel } = build({ visible: ['a', 'conv'] });
    const r = await ctrl.bulkStage({ ids: ['a', 'conv', 'x'], stage: 'QUALIFIED' }, ctx);
    expect(funnel.transitionLeadStage).toHaveBeenCalledTimes(2);
    expect(r.updated).toBe(1);
    expect(r.failed).toBe(2);
  });
});
