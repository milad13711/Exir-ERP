import { describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcryptjs';
import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { PublicInvoiceDeliveryService, DELIVERY_OTP } from './public-invoice-delivery.service.js';
import { SignatureEvidenceService } from '../common/signature-evidence/signature-evidence.service.js';
import { InvoicesService } from './invoices.service.js';
import { CostingService } from '../warehouse/costing.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

type Row = Record<string, any>;
function match(r: Row, w: Row = {}): boolean {
  return Object.entries(w).every(([k, c]) => {
    const v = r[k];
    if (c && typeof c === 'object' && !(c instanceof Date)) {
      if ('gt' in c) return v != null && v > c.gt;
      if ('gte' in c) return v >= c.gte;
      if ('lt' in c) return v < c.lt;
      return false;
    }
    return c === null ? v == null : v === c;
  });
}

function setup(o: { moduleOn?: boolean; invoice?: Row; smsOk?: boolean } = {}) {
  const invoice: Row = { id: 'inv-1', invoiceNo: 9, status: 'CONFIRMED', publicToken: 'tok', deliveryConfirmedAt: null, deliveryMethod: null, createdByUserId: 'seller', officialInvoiceNo: null, contactId: 'c', dueAt: null, discount: 0, subtotal: 100, taxRate: null, taxAmount: 0, total: 100, notes: null, paymentMethod: 'CASH', paymentBankInfo: null, contact: { name: 'مشتری', phone: '09123456789' }, lines: [{ productId: null, description: 'x', quantity: 1, unitPrice: 100 }], ...o.invoice };
  const otps: Row[] = [];
  const evidence: Row[] = [];
  const sms = { sendSms: vi.fn(async () => ({ success: o.smsOk ?? true })) };
  const db: any = {
    salesInvoice: {
      findFirst: vi.fn(async (a: Row) => (a.where.publicToken === 'tok' ? invoice : null)),
      updateMany: vi.fn(async (a: Row) => { if (invoice.deliveryConfirmedAt || a.where.deliveryConfirmedAt !== null) return { count: 0 }; Object.assign(invoice, a.data); return { count: 1 }; }),
    },
    invoiceDeliveryOtp: {
      findMany: vi.fn(async (a: Row) => otps.filter((r) => match(r, a.where)).sort((x, y) => y.createdAt - x.createdAt)),
      findFirst: vi.fn(async (a: Row) => otps.filter((r) => match(r, a.where)).sort((x, y) => y.createdAt - x.createdAt).map((r) => ({ ...r }))[0] ?? null),
      count: vi.fn(async (a: Row) => otps.filter((r) => match(r, a.where)).length),
      create: vi.fn(async (a: Row) => { const r = { id: `o${otps.length + 1}`, attempts: 0, consumedAt: null, lockedUntil: null, createdAt: new Date(), ...a.data }; otps.push(r); return r; }),
      update: vi.fn(async (a: Row) => Object.assign(otps.find((r) => r.id === a.where.id)!, a.data)),
      updateMany: vi.fn(async (a: Row) => {
        const hit = otps.filter((r) => match(r, a.where));
        hit.forEach((r) => { for (const [k, v] of Object.entries(a.data) as Array<[string, any]>) r[k] = v && typeof v === 'object' && 'increment' in v ? r[k] + v.increment : v; });
        return { count: hit.length };
      }),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (tx: any) => unknown) => fn(db)),
    moduleSetting: { findUnique: vi.fn(async () => null) },
    activityLog: { create: vi.fn(async () => ({})) },
    signatureEvidence: { create: vi.fn(async (a: Row) => { evidence.push(a.data); return a.data; }) },
    user: { findMany: vi.fn(async () => []) },
  };
  const control = {
    moduleDefinition: { findMany: async () => [{ id: 'd', code: 'delivery-signature', dependsOn: [], isCore: false }] },
    tenantModule: { findMany: async () => (o.moduleOn === false ? [] : [{ moduleId: 'd', status: 'INSTALLED' }]) },
    tenantMembership: { findMany: async () => [] },
  };
  const notifications = { notify: vi.fn() };
  const invoicesSvc = { getDeliverySmsTemplate: async () => 'کد {code} فاکتور {invoiceNo}' };
  const svc = new PublicInvoiceDeliveryService(control as never, sms as never, notifications as never, new SignatureEvidenceService(), invoicesSvc as never);
  const ctx = { tenantDb: db, tenantId: 't', tenantSlug: 'acme', auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  const req: any = { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604 Version/17.0 Mobile', 'x-real-ip': '5.6.7.8' }, socket: { remoteAddress: '127.0.0.1' } };
  const sentCode = () => (sms.sendSms.mock.calls.at(-1) as any)[2].match(/\d{6}/)[0] as string;
  return { svc, ctx, req, db, invoice, otps, evidence, sms, notifications, sentCode };
}

describe('تأیید تحویل عمومی', () => {
  it('module not installed → 404 everywhere and no section', async () => {
    const t = setup({ moduleOn: false });
    await expect(t.svc.sendCode(t.ctx, 'tok', t.req)).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.svc.confirm(t.ctx, 'tok', { method: 'CODE', code: '123456', confirmerName: 'علی' } as never, t.req)).rejects.toBeInstanceOf(NotFoundException);
    expect(await t.svc.viewSection(t.ctx, t.invoice as never)).toBeNull();
  });

  it('send code: hashed at rest, SMS carries the code, response never leaks code or full phone', async () => {
    const t = setup();
    const res = await t.svc.sendCode(t.ctx, 'tok', t.req);
    const code = t.sentCode();
    expect(JSON.stringify(res)).not.toContain(code);
    expect(JSON.stringify(res)).not.toContain('09123456789');
    expect(res.phoneMasked).toContain('***');
    expect(t.otps[0].codeHash).not.toBe(code);
    expect(await bcrypt.compare(code, t.otps[0].codeHash)).toBe(true);
    expect(t.otps[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(DELIVERY_OTP.ttlMs);
  });

  it('rate limits: cooldown, per-IP cap; SMS failure does not leave a live code', async () => {
    const t = setup();
    await t.svc.sendCode(t.ctx, 'tok', t.req);
    await expect(t.svc.sendCode(t.ctx, 'tok', t.req)).rejects.toBeInstanceOf(HttpException);
    t.otps[0].createdAt = new Date(Date.now() - 120_000);
    for (let i = 0; i < DELIVERY_OTP.perIpHour; i++) t.otps.push({ id: `x${i}`, ipHash: t.otps[0].ipHash, createdAt: new Date(Date.now() - 200_000), invoiceId: 'other', consumedAt: new Date(), attempts: 0 });
    await expect(t.svc.sendCode(t.ctx, 'tok', t.req)).rejects.toThrow(/دستگاه/);
    const f = setup({ smsOk: false });
    await expect(f.svc.sendCode(f.ctx, 'tok', f.req)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.otps[0].consumedAt).toBeTruthy();
  });

  it('sendCode does its limit checks + insert inside one transaction under an advisory lock; tenant cap enforced', async () => {
    const t = setup();
    const order: string[] = [];
    t.db.$queryRaw.mockImplementation(async () => { order.push('lock'); return []; });
    const origCreate = t.db.invoiceDeliveryOtp.create.getMockImplementation()!;
    t.db.invoiceDeliveryOtp.create.mockImplementation(async (a: any) => { order.push('create'); return origCreate(a); });
    await t.svc.sendCode(t.ctx, 'tok', t.req);
    expect(t.db.$transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['lock', 'create']);
    process.env.INVOICE_DELIVERY_OTP_TENANT_DAILY_CAP = '1';
    try {
      t.otps[0].createdAt = new Date(Date.now() - 120_000);
      await expect(t.svc.sendCode(t.ctx, 'tok', t.req)).rejects.toThrow(/سقف روزانه/);
    } finally {
      delete process.env.INVOICE_DELIVERY_OTP_TENANT_DAILY_CAP;
    }
  });

  it('correct code confirms, records evidence with IP/device, notifies seller, then second confirmation is rejected', async () => {
    const t = setup();
    await t.svc.sendCode(t.ctx, 'tok', t.req);
    const out = await t.svc.confirm(t.ctx, 'tok', { method: 'CODE', code: t.sentCode(), confirmerName: 'علی رضایی', evidence: { geo: { status: 'denied' } } } as never, t.req);
    expect(out.confirmed).toBe(true);
    expect(t.invoice).toMatchObject({ deliveryMethod: 'CODE', deliveryChannel: 'PUBLIC_LINK', deliveryConfirmedName: 'علی رضایی' });
    expect(t.evidence).toHaveLength(1);
    expect(t.evidence[0]).toMatchObject({ entityType: 'invoice_delivery', action: 'delivery_confirm_code', ip: '5.6.7.8', geoStatus: 'denied', signerName: 'علی رضایی' });
    expect(t.evidence[0].device.deviceType).toBe('mobile');
    expect(t.evidence[0].contentHash).toBeTruthy();
    expect(t.notifications.notify).toHaveBeenCalled();
    await expect(t.svc.confirm(t.ctx, 'tok', { method: 'SIGNATURE', signatureDataUrl: 'data:image/png;base64,AA', consent: true, confirmerName: 'علی' } as never, t.req)).rejects.toBeInstanceOf(ConflictException);
  });

  it('wrong codes: attempts counted, locked after the max, even the right code is then refused', async () => {
    const t = setup();
    await t.svc.sendCode(t.ctx, 'tok', t.req);
    const good = t.sentCode();
    const bad = good === '111111' ? '222222' : '111111';
    for (let i = 0; i < DELIVERY_OTP.maxAttempts - 1; i++) await expect(t.svc.confirm(t.ctx, 'tok', { method: 'CODE', code: bad, confirmerName: 'علی' } as never, t.req)).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.svc.confirm(t.ctx, 'tok', { method: 'CODE', code: bad, confirmerName: 'علی' } as never, t.req)).rejects.toBeInstanceOf(HttpException);
    await expect(t.svc.confirm(t.ctx, 'tok', { method: 'CODE', code: good, confirmerName: 'علی' } as never, t.req)).rejects.toBeInstanceOf(HttpException);
    expect(t.invoice.deliveryConfirmedAt).toBeNull();
    expect(t.evidence).toHaveLength(0);
  });

  it('expired code is refused', async () => {
    const t = setup();
    await t.svc.sendCode(t.ctx, 'tok', t.req);
    t.otps[0].expiresAt = new Date(Date.now() - 1000);
    await expect(t.svc.confirm(t.ctx, 'tok', { method: 'CODE', code: t.sentCode(), confirmerName: 'علی' } as never, t.req)).rejects.toThrow(/منقضی/);
  });

  it('signature method needs consent + image, records evidence with signature hash', async () => {
    const t = setup();
    const dto = { method: 'SIGNATURE', signatureDataUrl: 'data:image/png;base64,AAAA', confirmerName: 'علی' };
    await expect(t.svc.confirm(t.ctx, 'tok', dto as never, t.req)).rejects.toThrow(/اعلان/);
    await t.svc.confirm(t.ctx, 'tok', { ...dto, consent: true } as never, t.req);
    expect(t.evidence[0]).toMatchObject({ action: 'delivery_confirm_signature' });
    expect(t.evidence[0].signatureHash).toBeTruthy();
    expect(t.evidence[0].device.verification).toBe('link_only');
    expect(t.invoice.deliverySignatureDataUrl).toBe(dto.signatureDataUrl);
  });

  it('voided / unissued invoices cannot be confirmed or sent a code', async () => {
    for (const status of ['CANCELLED', 'DRAFT']) {
      const t = setup({ invoice: { status } });
      await expect(t.svc.sendCode(t.ctx, 'tok', t.req)).rejects.toBeInstanceOf(BadRequestException);
      await expect(t.svc.confirm(t.ctx, 'tok', { method: 'SIGNATURE', signatureDataUrl: 'data:image/png;base64,A', consent: true, confirmerName: 'علی' } as never, t.req)).rejects.toBeInstanceOf(BadRequestException);
    }
    const t = setup();
    await expect(t.svc.sendCode(t.ctx, 'bad-token', t.req)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ویرایش پیش‌نویس امضاشده', () => {
  it('requires explicit acknowledgement, then clears the signature, logs a revision and closes pending requests', async () => {
    const approvals = { registerHandler: () => {}, closeForEntity: vi.fn(), request: vi.fn() };
    const db: any = {
      salesInvoice: {
        findUnique: vi.fn(async () => ({ id: 'i', status: 'DRAFT', signedAt: new Date(), signedByName: 'مالک', signatureKind: 'SIGNATURE', revisionCount: 0, isOfficial: false, taxRate: null, paymentMethod: 'CASH', paymentBankInfo: null })),
        update: vi.fn(async (a: Row) => a.data), },
      shipment: { count: vi.fn(async () => 0) }, taxInvoice: { findFirst: vi.fn(async () => null) },
      dispatchInvoiceAdjustment: { count: vi.fn(async () => 0) },
      crmContact: { findUniqueOrThrow: vi.fn(async () => ({})) },
      salesInvoiceLine: { deleteMany: vi.fn() },
      user: { findUnique: vi.fn(async () => ({ id: 'u', name: 'ک' })) },
      documentRevision: { create: vi.fn(async (a: Row) => a.data) },
      $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const svc = new InvoicesService({} as never, {} as never, new CostingService(), {} as never, {} as never, { isConfigured: async () => false } as never, {} as never, {} as never, {} as never, approvals as never, {} as never);
    const ctx = { tenantDb: db, tenantId: 't', auth: { type: 'user', sub: 'g', role: 'OWNER' } } as unknown as TenantRequestContext;
    const dto: any = { contactId: 'c', lines: [{ description: 'x', quantity: 1, unitPrice: 5 }] };
    await expect(svc.updateDraft(ctx, 'i', dto)).rejects.toBeInstanceOf(ConflictException);
    await svc.updateDraft(ctx, 'i', { ...dto, acknowledgeSignatureInvalidation: true });
    expect(db.documentRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'SIGNATURE_INVALIDATED' }) });
    expect(approvals.closeForEntity).toHaveBeenCalledWith(ctx, 'SALES_INVOICE_SIGN', 'i', 'REJECTED');
  });
});
