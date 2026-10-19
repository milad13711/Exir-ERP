import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoicesController } from './invoices.controller.js';

function setup(opts: { role: string; canEdit?: boolean; canDelete?: boolean; scope?: Record<string, unknown>; found?: boolean }) {
  const perms = {
    assertEdit: vi.fn(async () => { if (opts.canEdit === false) throw new ForbiddenException('edit'); }),
    assertDelete: vi.fn(async () => { if (opts.canDelete === false) throw new ForbiddenException('delete'); }),
    viewScope: vi.fn(async () => opts.scope ?? {}),
  } as any;
  const invoices = { editConfirmed: vi.fn(async () => 'edited'), revisions: vi.fn(async () => []) } as any;
  const ctx = { auth: { role: opts.role }, tenantDb: { salesInvoice: { findFirst: vi.fn(async () => (opts.found === false ? null : { id: 'i1' })) } } } as any;
  const c = new (InvoicesController as any)(invoices, perms, {}, {}, {}) as InvoicesController;
  return { c, invoices, perms, ctx };
}
const body = { contactId: 'c', lines: [], reason: ' اصلاح قیمت ' } as any;

describe('InvoicesController.revise — permission rules', () => {
  it('managers (OWNER/ADMIN) with edit access may revise; reason is trimmed and stripped from the invoice payload', async () => {
    const { c, invoices, perms, ctx } = setup({ role: 'ADMIN' });
    await expect(c.revise('i1', body, ctx)).resolves.toBe('edited');
    expect(perms.assertEdit).toHaveBeenCalled();
    expect(perms.assertDelete).not.toHaveBeenCalled();
    expect(invoices.editConfirmed).toHaveBeenCalledWith(ctx, 'i1', { contactId: 'c', lines: [] }, 'اصلاح قیمت');
  });
  it('non-managers need both canEdit and canDelete', async () => {
    const ok = setup({ role: 'MEMBER' });
    await expect(ok.c.revise('i1', body, ok.ctx)).resolves.toBe('edited');
    expect(ok.perms.assertDelete).toHaveBeenCalled();

    const noDelete = setup({ role: 'MEMBER', canDelete: false });
    await expect(noDelete.c.revise('i1', body, noDelete.ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(noDelete.invoices.editConfirmed).not.toHaveBeenCalled();

    const noEdit = setup({ role: 'MEMBER', canEdit: false });
    await expect(noEdit.c.revise('i1', body, noEdit.ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(noEdit.invoices.editConfirmed).not.toHaveBeenCalled();
  });
  it('respects view-own scope (another user invoice → 404, nothing edited)', async () => {
    const { c, invoices, ctx } = setup({ role: 'MEMBER', scope: { createdByUserId: 'me' }, found: false });
    await expect(c.revise('i1', body, ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(invoices.editConfirmed).not.toHaveBeenCalled();
  });
  it('revisions history is scoped by the caller view scope', async () => {
    const { c, invoices, ctx } = setup({ role: 'MEMBER', scope: { createdByUserId: 'me' } });
    await c.revisions('i1', ctx);
    expect(invoices.revisions).toHaveBeenCalledWith(ctx, 'i1', { createdByUserId: 'me' });
  });
});
