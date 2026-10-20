import { describe, expect, it, vi } from 'vitest';
import { AttachmentAccessService } from '../attachments/attachment-access.service.js';

const MATRIX = { canViewAll: true, canViewOwn: true, canCreate: true, canEdit: true, canDelete: true };

function make(role: 'OWNER' | 'ADMIN' | 'MEMBER', letter: Record<string, unknown> | null, matrix = MATRIX) {
  const findFirst = vi.fn(async () => letter);
  const ctx = { auth: { role, sub: 'g1' }, tenantDb: { corrLetter: { findFirst }, user: { findUnique: async () => ({ id: 'u1' }) } } } as never;
  const permissions = { getEffective: async () => (role === 'MEMBER' ? matrix : MATRIX) };
  const svc = new AttachmentAccessService(permissions as never, {} as never);
  return { svc, ctx, findFirst };
}
const letter = (over: Record<string, unknown> = {}) => ({ id: 'L1', type: 'OUTGOING', status: 'DRAFT', archivedAt: null, createdByUserId: 'u1', ownerUserId: 'u1', ...over });

describe('Letter attachment access', () => {
  it('applies the confidentiality scope even for ADMIN (manager shortcut is bypassed)', async () => {
    const { svc, ctx, findFirst } = make('ADMIN', letter());
    await svc.assertAccess(ctx, 'Letter', 'L1', 'read');
    const where = JSON.stringify((findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0].where);
    expect(where).toContain('"confidentiality":{"not":"SECRET"}');
  });
  it('OWNER sees everything (empty scope)', async () => {
    const { svc, ctx, findFirst } = make('OWNER', letter());
    await svc.assertAccess(ctx, 'Letter', 'L1', 'read');
    expect(JSON.stringify((findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0].where)).toBe('{"id":"L1"}');
  });
  it('out-of-scope letter → 404 (not 403) so existence does not leak', async () => {
    const { svc, ctx } = make('ADMIN', null);
    await expect(svc.assertAccess(ctx, 'Letter', 'L1', 'read')).rejects.toMatchObject({ status: 404 });
    await expect(svc.assertAccess(ctx, 'LetterSnapshot', 'L1', 'read')).rejects.toMatchObject({ status: 404 });
  });
  it('the signed PDF snapshot is read-only for everybody, owner included', async () => {
    const { svc, ctx } = make('OWNER', letter({ status: 'ISSUED' }));
    await svc.assertAccess(ctx, 'LetterSnapshot', 'L1', 'read');
    await expect(svc.assertAccess(ctx, 'LetterSnapshot', 'L1', 'write')).rejects.toThrow(/تغییرناپذیر/);
    await expect(svc.assertAccess(ctx, 'LetterSnapshot', 'L1', 'delete')).rejects.toThrow(/تغییرناپذیر/);
  });
  it('after signing only receipts can be added (never plain attachments, rename or delete)', async () => {
    const { svc, ctx } = make('OWNER', letter({ status: 'ISSUED' }));
    await svc.assertAccess(ctx, 'LetterReceipt', 'L1', 'write');
    await expect(svc.assertAccess(ctx, 'LetterReceipt', 'L1', 'delete')).rejects.toThrow(/مجاز نیست/); // حذف و تغییر نام
    await expect(svc.assertAccess(ctx, 'Letter', 'L1', 'write')).rejects.toThrow(/مجاز نیست/);
    await expect(svc.assertAccess(ctx, 'Letter', 'L1', 'delete')).rejects.toThrow(/مجاز نیست/);
  });
  it('incoming original scans can be added but never deleted/renamed; receipts do not apply to incoming', async () => {
    const { svc, ctx } = make('OWNER', letter({ type: 'INCOMING', status: 'REGISTERED' }));
    await svc.assertAccess(ctx, 'LetterScan', 'L1', 'write');
    await expect(svc.assertAccess(ctx, 'LetterScan', 'L1', 'delete')).rejects.toThrow(/مجاز نیست/);
    await expect(svc.assertAccess(ctx, 'LetterReceipt', 'L1', 'write')).rejects.toThrow(/مجاز نیست/);
    await svc.assertAccess(ctx, 'Letter', 'L1', 'delete'); // پیوست معمولی وارده آزاد است
  });
  it('scans are not allowed on outgoing letters', async () => {
    const { svc, ctx } = make('OWNER', letter());
    await expect(svc.assertAccess(ctx, 'LetterScan', 'L1', 'write')).rejects.toThrow(/مجاز نیست/);
  });
  it('non-manager needs edit, or create on their own letter', async () => {
    const own = make('MEMBER', letter(), { ...MATRIX, canEdit: false, canViewAll: false });
    await own.svc.assertAccess(own.ctx, 'Letter', 'L1', 'write');
    const foreign = make('MEMBER', letter({ createdByUserId: 'x', ownerUserId: 'x' }), { ...MATRIX, canEdit: false, canViewAll: false });
    await expect(foreign.svc.assertAccess(foreign.ctx, 'Letter', 'L1', 'write')).rejects.toThrow(/اجازه/);
    const none = make('MEMBER', letter(), { canViewAll: false, canViewOwn: false, canCreate: false, canEdit: false, canDelete: false });
    await expect(none.svc.assertAccess(none.ctx, 'Letter', 'L1', 'read')).rejects.toMatchObject({ status: 403 });
  });
});
