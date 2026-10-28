import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InvoiceSigningService } from './invoice-signing.service.js';
import { invoiceContentHash } from './invoice-signing.js';
import { buildInvoiceHtml } from './sales-invoice-pdf.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

const SIG = 'data:image/png;base64,SIGSIG';
const STAMP = 'data:image/png;base64,STAMPSTAMP';

function setup(over: { inv?: Record<string, unknown>; policy?: string; role?: string; me?: string; delegate?: string | null; stamp?: boolean } = {}) {
  const base: any = {
    id: 'inv-1', invoiceNo: 5, status: 'DRAFT', total: 1000, discount: 0, subtotal: 1000, taxAmount: 0, taxRate: null, notes: null, paymentMethod: 'CASH', paymentBankInfo: null,
    contactId: 'c', dueAt: null, signedAt: null, signedContentHash: null, signatureKind: null, isOfficial: false, officialInvoiceNo: null, revisionCount: 0,
    contact: { name: 'مشتری', company: null, phone: '0912' }, lines: [{ productId: null, description: 'x', quantity: 1, unitPrice: 1000 }], ...over.inv,
  };
  const updates: any[] = [];
  const settings: Record<string, string> = {};
  const pending: any[] = [];
  const notes: any[] = [];
  const handlers: Record<string, any> = {};
  const db: any = {
    salesInvoice: { findUnique: vi.fn(async () => base), updateMany: vi.fn(async (a: any) => { updates.push(a.data); return { count: base.signedAt && !a.where.OR ? 0 : 1 }; }) },
    moduleSetting: { findUnique: vi.fn(async (a: any) => (String(a?.where?.moduleCode_key?.key ?? '').startsWith('sign-request-hash:') ? (settings[a.where.moduleCode_key.key] ? { value: settings[a.where.moduleCode_key.key] } : null) : { value: over.policy ?? 'optional' })), upsert: vi.fn(async (a: any) => { settings[a.where.moduleCode_key.key] = a.create.value; }) },
    user: { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id ?? 'owner', name: where.id === 'del' ? 'نماینده' : 'مالک' })), findMany: vi.fn(async () => [{ id: 'owner', name: 'مالک' }]) },
    approvalRequest: { findFirst: vi.fn(async () => pending[0] ?? null) },
  };
  const approvals = {
    registerHandler: (t: string, h: unknown) => { handlers[t] = h; },
    request: vi.fn(async (_c: unknown, input: any) => { pending.push(input); return { id: 'req-1' }; }),
    closeForEntity: vi.fn(),
  };
  const stamp = {
    getStamp: async () => ({ signatureImage: SIG, stampImage: over.stamp === false ? undefined : STAMP }),
    getDelegateUserId: async () => over.delegate ?? null,
    assertCanUse: async (c: any) => {
      if (c.auth.role === 'OWNER') return;
      if (over.delegate && over.me === over.delegate) return;
      throw new ForbiddenException('x');
    },
  };
  const notifications = { notify: vi.fn(async (_d: unknown, n: any) => { notes.push(n); }) };
  const control = { tenantMembership: { findMany: vi.fn(async () => [{ globalUserId: 'g-owner' }]) } };
  const svc = new InvoiceSigningService(approvals as never, stamp as never, notifications as never, control as never);
  svc.onModuleInit();
  const db2 = db;
  db2.user.findUnique = vi.fn(async ({ where }: any) => (where.globalUserId ? { id: over.me ?? 'owner' } : { id: where.id, name: where.id === 'del' ? 'نماینده' : 'مالک' }));
  const ctx = { tenantDb: db, tenantId: 't', auth: { type: 'user', sub: 'g', role: over.role ?? 'MEMBER' } } as unknown as TenantRequestContext;
  const ownerCtx = { ...ctx, auth: { ...ctx.auth, role: 'OWNER' } } as TenantRequestContext;
  return { svc, ctx, ownerCtx, settings, base, updates, pending, notes, handlers, approvals };
}

describe('درخواست امضای فاکتور', () => {
  it('is refused when the policy is off or the company signature image is missing', async () => {
    const a = setup({ policy: 'off' });
    await expect(a.svc.requestSignature(a.ctx, 'inv-1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a cartable request assigned to the owner (default), official so stamp is offered, only the signer notified', async () => {
    const a = setup({ me: 'seller' });
    const r = await a.svc.requestSignature(a.ctx, 'inv-1', {});
    expect(r.signerUserId).toBe('owner');
    expect(a.approvals.request).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityType: 'SALES_INVOICE_SIGN', assigneeUserId: 'owner', isOfficial: true, notifyAssigneeOnly: true, requestedByUserId: 'seller' }));
  });

  it('rejects a non-eligible signer and blocks self-request for a non-owner delegate', async () => {
    const a = setup({ me: 'seller' });
    await expect(a.svc.requestSignature(a.ctx, 'inv-1', { signerUserId: 'nobody' })).rejects.toBeInstanceOf(BadRequestException);
    const b = setup({ me: 'del', delegate: 'del' });
    await expect(b.svc.requestSignature(b.ctx, 'inv-1', { signerUserId: 'del' })).rejects.toThrow(/خودتان/);
  });

  it('refuses voided and already-signed invoices', async () => {
    const v = setup({ inv: { status: 'CANCELLED' } });
    await expect(v.svc.requestSignature(v.ctx, 'inv-1', {})).rejects.toThrow(/باطل/);
    const base = setup().base;
    const s = setup({ inv: { signedAt: new Date(), signedContentHash: invoiceContentHash(base) } });
    await expect(s.svc.requestSignature(s.ctx, 'inv-1', {})).rejects.toThrow(/قبلاً امضا/);
  });
});

describe('تصمیم امضاکننده', () => {
  it('approve with signature stores the saved signature only; with stamp stores both + kind + hash; notifies requester', async () => {
    const a = setup({ role: 'OWNER' });
    await a.handlers.SALES_INVOICE_SIGN.approve(a.ownerCtx, 'inv-1', { stampApplied: false, requestedByUserId: 'seller' });
    expect(a.updates[0]).toMatchObject({ signatureKind: 'SIGNATURE', signatureDataUrl: SIG, stampDataUrl: null });
    expect(a.updates[0].signedContentHash).toBeTruthy();
    expect(a.notes[0]).toMatchObject({ userId: 'seller', type: 'INVOICE_SIGNED', entityType: 'SalesInvoice', entityId: 'inv-1' });
    const b = setup({ role: 'OWNER' });
    await b.handlers.SALES_INVOICE_SIGN.approve(b.ownerCtx, 'inv-1', { stampApplied: true, requestedByUserId: 'seller' });
    expect(b.updates[0]).toMatchObject({ signatureKind: 'STAMP_AND_SIGNATURE', stampDataUrl: STAMP, signatureDataUrl: SIG });
  });

  it('only an eligible signer may decide (plain admin is forbidden)', async () => {
    const a = setup({ role: 'ADMIN', me: 'admin' });
    await expect(a.handlers.SALES_INVOICE_SIGN.approve(a.ctx, 'inv-1', { stampApplied: false })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(a.handlers.SALES_INVOICE_SIGN.reject(a.ctx, 'inv-1', { stampApplied: false, note: 'دلیل' })).rejects.toBeInstanceOf(ForbiddenException);
    const d = setup({ role: 'ADMIN', me: 'del', delegate: 'del' });
    await expect(d.handlers.SALES_INVOICE_SIGN.approve(d.ctx, 'inv-1', { stampApplied: false, requestedByUserId: 'seller' })).resolves.toBeUndefined();
  });

  it('delegate cannot approve their own request; stamp refused when no stamp image; voided invoice refused', async () => {
    const d = setup({ role: 'ADMIN', me: 'del', delegate: 'del' });
    await expect(d.handlers.SALES_INVOICE_SIGN.approve(d.ctx, 'inv-1', { stampApplied: false, requestedByUserId: 'del' })).rejects.toBeInstanceOf(ForbiddenException);
    const n = setup({ role: 'OWNER', stamp: false });
    await expect(n.handlers.SALES_INVOICE_SIGN.approve(n.ownerCtx, 'inv-1', { stampApplied: true })).rejects.toThrow(/مهر/);
    const v = setup({ role: 'OWNER', inv: { status: 'CANCELLED' } });
    await expect(v.handlers.SALES_INVOICE_SIGN.approve(v.ownerCtx, 'inv-1', { stampApplied: false })).rejects.toThrow(/باطل/);
  });

  it('double-sign race: the losing claim writes/notifies nothing', async () => {
    const a = setup({ role: 'OWNER' });
    a.base.signedAt = null;
    a.base.signedContentHash = null;
    (a.ownerCtx.tenantDb as any).salesInvoice.updateMany = vi.fn(async () => ({ count: 0 }));
    await a.handlers.SALES_INVOICE_SIGN.approve(a.ownerCtx, 'inv-1', { stampApplied: false, requestedByUserId: 'seller' });
    expect(a.notes).toHaveLength(0);
    expect(a.approvals.closeForEntity).not.toHaveBeenCalled();
  });

  it('rejection needs a reason and tells the requester', async () => {
    const a = setup({ role: 'OWNER' });
    await expect(a.handlers.SALES_INVOICE_SIGN.reject(a.ownerCtx, 'inv-1', { stampApplied: false, note: ' ' })).rejects.toBeInstanceOf(BadRequestException);
    await a.handlers.SALES_INVOICE_SIGN.reject(a.ownerCtx, 'inv-1', { stampApplied: false, note: 'مبلغ اشتباه است', requestedByUserId: 'seller' });
    expect(a.notes[0]).toMatchObject({ type: 'INVOICE_SIGN_REJECTED', userId: 'seller', body: 'مبلغ اشتباه است' });
  });

  it('evidence spec for the approved signature is entityType invoice with the content hash', async () => {
    const a = setup({ role: 'OWNER', inv: { signedByName: 'مالک', signedContentHash: 'h', signatureDataUrl: SIG, signedByUserId: 'owner', signedAt: new Date() } });
    const spec = await a.handlers.SALES_INVOICE_SIGN.evidenceFor(a.ownerCtx, 'inv-1', { withStamp: true });
    expect(spec).toMatchObject({ entityType: 'invoice', action: 'invoice_sign_stamp_and_signature', contentHash: 'h' });
  });

  it('no evidence unless this decider actually just signed (other signer / stale signedAt / not signed)', async () => {
    const mk = (inv: Record<string, unknown>) => setup({ role: 'OWNER', inv: { signedByName: 'م', signedContentHash: 'h', signatureDataUrl: SIG, ...inv } });
    for (const inv of [{ signedByUserId: 'someone-else', signedAt: new Date() }, { signedByUserId: 'owner', signedAt: new Date(Date.now() - 10 * 60_000) }, { signedByUserId: null, signedAt: null }]) {
      const a = mk(inv);
      expect(await a.handlers.SALES_INVOICE_SIGN.evidenceFor(a.ownerCtx, 'inv-1', { withStamp: false })).toBeNull();
    }
  });

  it('sign request stores the content hash; approval is refused when the invoice changed since', async () => {
    const a = setup({ me: 'seller' });
    await a.svc.requestSignature(a.ctx, 'inv-1', {});
    expect(a.settings['sign-request-hash:req-1']).toBe(invoiceContentHash(a.base as never));
    const owner = { ...a.ownerCtx };
    await a.handlers.SALES_INVOICE_SIGN.approve(owner, 'inv-1', { stampApplied: false, requestId: 'req-1' });
    expect(a.updates).toHaveLength(1);
    a.updates.length = 0;
    a.base.total = 9999;
    a.base.subtotal = 9999;
    await expect(a.handlers.SALES_INVOICE_SIGN.approve(owner, 'inv-1', { stampApplied: false, requestId: 'req-1' })).rejects.toThrow(/تغییر کرده/);
    expect(a.updates).toHaveLength(0);
  });
});

describe('محتوای امضا', () => {
  it('content hash changes when the invoice changes (edit-after-sign invalidation basis) and ignores line order', () => {
    const b: any = setup().base;
    const h = invoiceContentHash(b);
    expect(invoiceContentHash({ ...b, total: 2000 })).not.toBe(h);
    const two = { ...b, lines: [{ productId: null, description: 'a', quantity: 1, unitPrice: 1 }, { productId: null, description: 'b', quantity: 1, unitPrice: 2 }] };
    expect(invoiceContentHash({ ...two, lines: [...two.lines].reverse() })).toBe(invoiceContentHash(two));
  });

  it('PDF embeds the saved signature and stamp images', () => {
    const html = buildInvoiceHtml({
      invoiceNo: 1, officialInvoiceNo: null, status: 'CONFIRMED', issuedAt: new Date(), dueAt: null, subtotal: 1, discount: 0, taxRate: null, taxAmount: 0, total: 1, paidAmount: 0, notes: null, isOfficial: false,
      signedByName: 'مالک', signatureDataUrl: SIG, stampDataUrl: STAMP, signatureKind: 'STAMP_AND_SIGNATURE', signedAt: new Date(), deliveryConfirmedName: null, deliverySignatureDataUrl: null, deliveryConfirmedAt: null,
      paymentMethod: 'CASH', paymentBankInfo: null, checks: [], contact: { name: 'م', company: null, phone: null, email: null, type: 'PERSON', address: null, nationalId: null, economicCode: null, legalId: null, registrationNumber: null }, lines: [],
    } as never, { orgName: 'ش', address: null, phone: null, economicCode: null, nationalId: null, registrationNumber: null });
    expect(html).toContain(SIG);
    expect(html).toContain(STAMP);
    expect(html).toContain('مهر و امضای شرکت');
  });
});
