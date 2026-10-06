import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { TaxController } from './tax.controller.js';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import { REQUIRE_MODULE_KEY } from '../common/decorators/require-module.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';

const OWN = { OR: [{ createdByUserId: 'me' }, { requestedByUserId: 'me' }] };
const ID = '11111111-2222-3333-4444-555555555555';

function make(matrix: Record<string, boolean>) {
  const permissions = {
    getEffective: vi.fn(async () => matrix),
    viewScope: vi.fn(async () => ({ createdByUserId: 'me' })),
    assertEdit: vi.fn(async () => undefined),
    assertCreate: vi.fn(async () => undefined),
    assertDelete: vi.fn(async () => undefined),
  };
  const invoices: Record<string, any> = {};
  for (const m of ['list', 'detail', 'createFromSalesInvoice', 'update', 'refresh', 'requestApproval', 'decide', 'sendNow', 'inquire', 'resend', 'discard', 'createChain']) invoices[m] = vi.fn(async () => ({}));
  const settings = { getView: vi.fn(async () => ({ environment: 'SANDBOX', sendingEnabled: false, realSendingDisabled: true, verifiedAgainstSandboxAt: null })) };
  const ctx = { auth: { role: 'MEMBER', sub: 'g' }, tenantDb: { user: { findUnique: vi.fn(async () => ({ id: 'me' })) } } } as never;
  return { c: new TaxController(invoices as never, settings as never, {} as never, permissions as never), invoices, permissions, ctx };
}

describe('TaxController — scope reaches every by-id action', () => {
  it('own-scope is passed to the service on every route', async () => {
    const { c, invoices, ctx } = make({ canViewOwn: true });
    await c.list(undefined, undefined, ctx);
    await c.detail(ID, ctx);
    await c.update(ID, {} as never, ctx);
    await c.validate(ID, ctx);
    await c.requestApproval(ID, ctx);
    await c.approve(ID, {} as never, ctx);
    await c.reject(ID, {} as never, ctx);
    await c.send(ID, ctx);
    await c.inquire(ID, ctx);
    await c.resend(ID, ctx);
    await c.discard(ID, ctx);
    await c.chain(ID, { kind: 'CANCELLATION' }, ctx);
    expect(invoices.list.mock.calls[0][1]).toEqual(OWN);
    expect(invoices.detail.mock.calls[0][2]).toEqual(OWN);
    expect(invoices.update.mock.calls[0][3]).toEqual(OWN);
    expect(invoices.refresh.mock.calls[0][2]).toEqual(OWN);
    expect(invoices.requestApproval.mock.calls[0][2]).toEqual(OWN);
    expect(invoices.decide.mock.calls.map((x: unknown[]) => x[4])).toEqual([OWN, OWN]);
    expect(invoices.sendNow.mock.calls[0][2]).toEqual(OWN);
    expect(invoices.inquire.mock.calls[0][2]).toEqual(OWN);
    expect(invoices.resend.mock.calls[0][2]).toEqual(OWN);
    expect(invoices.discard.mock.calls[0][2]).toEqual(OWN);
    expect(invoices.createChain.mock.calls[0][3]).toEqual(OWN);
  });

  it('no view access → 403 before the service is touched', async () => {
    const { c, invoices, ctx } = make({});
    await expect(c.detail(ID, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.send(ID, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(invoices.detail).not.toHaveBeenCalled();
    expect(invoices.sendNow).not.toHaveBeenCalled();
  });

  it('mutations require the matching action permission', async () => {
    const { c, permissions, ctx } = make({ canViewAll: true });
    await c.send(ID, ctx);
    expect(permissions.assertEdit).toHaveBeenCalledWith(ctx, 'tax');
    await c.create({ salesInvoiceId: ID }, ctx);
    expect(permissions.assertCreate).toHaveBeenCalledWith(ctx, 'tax');
    expect(permissions.viewScope).toHaveBeenCalledWith(ctx, 'sales', 'createdByUserId');
  });
});

describe('TaxController — metadata', () => {
  const proto = TaxController.prototype as any;
  const rolesOf = (name: string) => Reflect.getMetadata(ROLES_KEY, proto[name]);
  const guardsOf = (name: string): unknown[] => Reflect.getMetadata('__guards__', proto[name]) ?? [];

  it('is gated by the tax module', () => {
    expect(Reflect.getMetadata(REQUIRE_MODULE_KEY, TaxController)).toBe('tax');
  });

  it('settings, key management, server key and approve/reject are OWNER/ADMIN only (RolesGuard present)', () => {
    for (const m of ['getSettings', 'updateSettings', 'uploadKey', 'removeKey', 'refreshServerKey', 'approve', 'reject']) {
      expect(rolesOf(m), m).toEqual(['OWNER', 'ADMIN']);
      expect(guardsOf(m), m).toContain(RolesGuard);
    }
  });

  it('the status endpoint never exposes identity or key fields', async () => {
    const { c, ctx } = make({ canViewOwn: true });
    expect(Object.keys(await c.status(ctx)).sort()).toEqual(['environment', 'realSendingDisabled', 'sendingEnabled', 'verifiedAgainstSandboxAt']);
  });
});
