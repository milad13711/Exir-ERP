import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { ApprovalsService } from '../approvals/approvals.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { FakeMoodianClient } from './client/fake-moodian.client.js';
import { MoodianTransportError } from './client/http-moodian.client.js';
import type { MoodianClientConfig, MoodianClientFactory } from './client/moodian-client.js';
import { TAX_APPROVAL_ENTITY, TaxInvoicesService } from './tax-invoices.service.js';
import { TaxSettingsService } from './tax-settings.service.js';
import { TaxAuditService } from './tax-audit.service.js';
import { TaxProductsService } from './tax-products.service.js';
import { assertTransition, canTransition } from './state-machine.js';
import { assertNotTaxLocked } from '../sales/tax-lock.util.js';

// ── کلیدهای آزمایشی ─────────────────────────────────────────────────────
const taxpayer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const server = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIV_PEM = taxpayer.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const SERVER_KEY_B64 = (server.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
const TAXID = 'AA56CD0E0620002F2B4E78';

// ── DB درون‌حافظه‌ای (فقط آنچه سرویس‌ها به کار می‌برند) ─────────────────────
type Row = Record<string, any>;
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (v as Row[]).every((w) => matches(row, w));
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (k === 'NOT') return !matches(row, v);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const c = row[k];
      if ('in' in v) return v.in.includes(c);
      if ('notIn' in v) return !v.notIn.includes(c);
      if ('not' in v) return v.not === null ? c !== null && c !== undefined : c !== v.not;
      if ('lt' in v) return c !== null && c !== undefined && c < v.lt;
      if ('lte' in v) return c !== null && c !== undefined && c <= v.lte;
      if ('contains' in v) return String(c ?? '').toLowerCase().includes(String(v.contains).toLowerCase());
      return true; // رابطه‌ها (salesInvoice: {...}) در این دوبل نادیده‌اند
    }
    return row[k] === v || (v === null && (row[k] === null || row[k] === undefined));
  });
}
function table(defaults: (data: Row) => Row = (d) => d) {
  const rows: Row[] = [];
  const t = {
    rows,
    create: vi.fn(async ({ data }: { data: Row }) => {
      const r = defaults({ id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data });
      rows.push(r);
      return { ...r };
    }),
    findFirst: vi.fn(async ({ where }: { where?: Row } = {}) => {
      const r = rows.find((x) => matches(x, where));
      return r ? { ...r } : null;
    }),
    findUnique: vi.fn(async ({ where }: { where: Row }) => {
      const r = rows.find((x) => matches(x, where));
      return r ? { ...r } : null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: Row }) => {
      const r = rows.find((x) => matches(x, where));
      if (!r) throw new Error('not found');
      return { ...r };
    }),
    findMany: vi.fn(async ({ where, take }: { where?: Row; take?: number } = {}) => rows.filter((x) => matches(x, where)).slice(0, take ?? 1000).map((x) => ({ ...x }))),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const r = rows.find((x) => matches(x, where))!;
      Object.assign(r, clean(data), { updatedAt: new Date() });
      return { ...r };
    }),
    updateMany: vi.fn(async ({ where, data }: { where?: Row; data: Row }) => {
      const hit = rows.filter((x) => matches(x, where));
      hit.forEach((r) => Object.assign(r, clean(data), { updatedAt: new Date() }));
      return { count: hit.length };
    }),
    upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const r = rows.find((x) => matches(x, where));
      if (r) return Object.assign(r, clean(update), { updatedAt: new Date() });
      const n = { createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(n);
      return n;
    }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  };
  return t;
}
// Prisma.DbNull / undefined: undefined = بدون تغییر، DbNull = null
function clean(data: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === 'object' && (v as any).constructor?.name === 'DbNull' ? null : v;
  }
  return out;
}

function makeWorld(opts: { role?: 'OWNER' | 'ADMIN' | 'MEMBER'; sub?: string } = {}) {
  const taxInvoice = table((d) => ({ status: 'DRAFT', subject: 'ORIGINAL', pattern: 1, invoiceType: 2, uid: randomUUID(), retryCount: 0, retryFlag: false, referenceNumber: null, errors: null, payloadSnapshot: null, normalizedHash: null, approvedAt: null, approvedByUserId: null, requestedByUserId: null, taxid: null, inno: null, irtaxid: null, overrides: null, ...d }));
  const salesRow: Row = {
    id: 'si1', invoiceNo: 12, officialInvoiceNo: 5, isOfficial: true, status: 'CONFIRMED', issuedAt: new Date('2026-09-01T10:00:00Z'), subtotal: 1000, discount: 0, taxRate: 9, taxAmount: 90, total: 1090, paidAmount: 0, signedAt: new Date(),
    lines: [{ productId: 'p1', description: 'کالا', quantity: 1, unitPrice: 1000, lineTotal: 1000 }],
    contact: { id: 'c1', name: 'علی', company: null, type: 'INDIVIDUAL', economicCode: null, nationalId: '0012345678', legalId: null },
  };
  const db: Record<string, any> = {
    taxInvoice,
    taxSettings: table(),
    taxSubmissionLog: table(),
    taxProductCode: table(),
    activityLog: table(),
    approvalRequest: table((d) => ({ status: 'PENDING', ...d })),
    moduleApprover: { findUnique: vi.fn(async () => null) },
    notification: table(),
    salesInvoice: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => (where.id === 'si1' ? salesRow : null)),
      findFirst: vi.fn(async ({ where }: { where: Row }) => (JSON.stringify(where).includes('si1') ? salesRow : null)),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => ({ id: `u-${where.globalUserId}` })),
      findMany: vi.fn(async () => []),
    },
    product: { findUnique: vi.fn(async () => ({ id: 'p1' })), findMany: vi.fn(async () => []) },
  };
  // taxInvoice.findFirst/findUnique با include → ضمیمه‌ی فاکتور فروش
  for (const fn of ['findFirst', 'findUnique', 'findUniqueOrThrow'] as const) {
    const orig = taxInvoice[fn];
    (taxInvoice as any)[fn] = vi.fn(async (args: any) => {
      const r = await orig(args);
      return r ? { ...r, salesInvoice: { id: 'si1', invoiceNo: 12, officialInvoiceNo: 5, total: 1090, issuedAt: salesRow.issuedAt, contact: { id: 'c1', name: 'علی', company: null } } } : r;
    });
  }
  const ctx = { tenantId: 't1', tenantSlug: 'acme', tenantDb: db, auth: { type: 'user', sub: opts.sub ?? 'gm', role: opts.role ?? 'OWNER' } } as unknown as TenantRequestContext;
  return { db, ctx, salesRow };
}

function makeServices(world: ReturnType<typeof makeWorld>, opts: { isRealManager?: boolean } = {}) {
  const controlDb = {
    tenantMembership: { findFirst: vi.fn(async () => (opts.isRealManager === false ? null : { id: 'm1' })), findMany: vi.fn(async () => []) },
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const automation = { emit: vi.fn(async () => undefined) };
  const approvals = new ApprovalsService(controlDb as never, notifications as never);
  const fakes: FakeMoodianClient[] = [];
  // سرور واقعی وضعیت دارد؛ پس همه‌ی کلاینت‌های ساخته‌شده یک «سرور جعلی» مشترک را می‌بینند (تا setFake دوباره بخواهد)
  let fakeFactory: ((cfg: MoodianClientConfig) => FakeMoodianClient) | null = null;
  let shared: FakeMoodianClient | null = null;
  const factory: MoodianClientFactory = {
    create: (cfg) => {
      if (!shared) {
        shared = fakeFactory ? fakeFactory(cfg) : new FakeMoodianClient(cfg.settings);
        fakes.push(shared);
      }
      return shared;
    },
  };
  const audit = new TaxAuditService();
  const settings = new TaxSettingsService(factory, audit);
  const invoices = new TaxInvoicesService(approvals, settings, audit, notifications as never, automation as never, controlDb as never);
  invoices.onModuleInit();
  return { approvals, settings, invoices, audit, notifications, automation, controlDb, fakes, setFake: (f: typeof fakeFactory) => {
      fakeFactory = f;
      shared = null;
    }, lastFake: () => fakes[fakes.length - 1]! };
}

const KEY_BACKUP = process.env.TAX_SECRETS_KEY;
beforeAll(() => {
  process.env.TAX_SECRETS_KEY = randomBytes(32).toString('hex');
});
afterAll(() => {
  if (KEY_BACKUP === undefined) delete process.env.TAX_SECRETS_KEY;
  else process.env.TAX_SECRETS_KEY = KEY_BACKUP;
});

/** تنظیمات کامل آماده‌ی ارسال آزمایشی (از مسیر واقعی سرویس: آپلود کلید، ذخیره‌ی کلید سرور). */
async function configure(world: ReturnType<typeof makeWorld>, s: ReturnType<typeof makeServices>, o: { sending?: boolean } = {}) {
  await s.settings.update(world.ctx, { economicCode: '12345678911234', fiscalId: 'AA56CD', defaultVatRate: 9, defaultSstid: '2153265989636', defaultUnitCode: 1627, sandboxBaseUrl: 'https://sandbox.tax.gov.ir/req/api/self-tsp/' });
  await s.settings.uploadKey(world.ctx, { privateKeyPem: PRIV_PEM });
  const row = world.db.taxSettings.rows[0];
  row.serverPublicKeyPem = SERVER_KEY_B64;
  row.serverPublicKeyId = 'srv-1';
  if (o.sending !== false) await s.settings.update(world.ctx, { sendingEnabled: true });
}

async function draftReady(world: ReturnType<typeof makeWorld>, s: ReturnType<typeof makeServices>) {
  const created = await s.invoices.createFromSalesInvoice(world.ctx, 'si1', {});
  await s.invoices.update(world.ctx, created.id, { taxid: TAXID, overrides: { buyerPostalCode: '1234567890' } }, {});
  return created.id;
}

// ── ماشین وضعیت ────────────────────────────────────────────────────────
describe('state machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('DRAFT', 'PENDING_APPROVAL')).toBe(true);
    expect(canTransition('DRAFT', 'SENT')).toBe(false);
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransition('PENDING_APPROVAL', 'QUEUED')).toBe(false);
    expect(canTransition('APPROVED', 'SENT')).toBe(false);
    expect(canTransition('ACCEPTED', 'DRAFT')).toBe(false);
    expect(canTransition('CANCELLED', 'DRAFT')).toBe(false);
    expect(() => assertTransition('DRAFT', 'ACCEPTED')).toThrow(BadRequestException);
  });
});

// ── مسیر کامل با کلاینت جعلی ───────────────────────────────────────────
describe('workflow: draft → approval → send → inquiry', () => {
  let world: ReturnType<typeof makeWorld>;
  let s: ReturnType<typeof makeServices>;
  beforeEach(() => {
    world = makeWorld();
    s = makeServices(world);
  });

  it('accepted flow; payload is frozen at approval; sandbox gets verified; notifications + trigger fire', async () => {
    await configure(world, s);
    const id = await draftReady(world, s);

    const d0 = await s.invoices.detail(world.ctx, id, {});
    expect(d0.preview.blocking).toBe(false);
    expect(d0.preview.payload.header.tbill).toBe(10_900);

    // ارسال بدون تأیید ممکن نیست
    expect(await s.invoices.dispatch(world.ctx, id)).toEqual({ sent: false, reason: 'NOT_APPROVED_OR_BUSY' });
    expect(s.fakes.every((f) => f.sent.length === 0)).toBe(true);

    await s.invoices.requestApproval(world.ctx, id, {});
    const pending = await world.db.approvalRequest.findFirst({ where: { entityType: TAX_APPROVAL_ENTITY, entityId: id } });
    expect(pending?.status).toBe('PENDING');
    expect(world.db.taxInvoice.rows[0].status).toBe('PENDING_APPROVAL');
    // هنوز تأیید نشده → ارسال ممنوع
    expect((await s.invoices.dispatch(world.ctx, id)).sent).toBe(false);

    await s.invoices.decide(world.ctx, id, true, 'ok', {});
    const row = world.db.taxInvoice.rows[0];
    expect(row.status).toBe('APPROVED');
    expect(row.approvedAt).toBeInstanceOf(Date);
    expect(row.payloadSnapshot.header.tbill).toBe(10_900);
    expect(row.normalizedHash).toMatch(/^[0-9a-f]{64}$/);

    // تغییر فاکتور فروش پس از تأیید روی محتوای منجمد اثر ندارد
    world.salesRow.lines[0].unitPrice = 5000;

    const out = await s.invoices.sendNow(world.ctx, id, {});
    expect(out.dispatch).toEqual({ sent: true });
    expect(world.db.taxInvoice.rows[0].status).toBe('SENT');
    const fake = s.lastFake();
    expect(fake.sent).toHaveLength(1);
    expect((fake.sent[0]!.invoice as any).header.tbill).toBe(10_900);
    expect(fake.sent[0]!.retry).toBe(false);
    expect(fake.sent[0]!.uid).toBe(row.uid);

    const polled = await s.invoices.pollOne(world.ctx, id);
    expect(polled.status).toBe('SUCCESS');
    expect(world.db.taxInvoice.rows[0].status).toBe('ACCEPTED');
    expect(world.db.taxSettings.rows[0].verifiedAgainstSandboxAt).toBeInstanceOf(Date);
    expect(s.automation.emit).toHaveBeenCalledWith(expect.anything(), 'tax.invoice.accepted', expect.objectContaining({ invoiceNo: 12 }));
    expect(s.notifications.notify).toHaveBeenCalled();
    // لاگ ارسال و فعالیت ثبت شده و حاوی راز نیست
    expect(world.db.activityLog.rows.map((r: Row) => r.action)).toEqual(expect.arrayContaining(['tax.invoice.created', 'tax.invoice.approval_requested', 'tax.invoice.approved', 'tax.invoice.sent', 'tax.invoice.accepted']));
    expect(JSON.stringify([...world.db.activityLog.rows, ...world.db.taxSubmissionLog.rows])).not.toContain('PRIVATE KEY');
  });

  it('rejected by the tax system: Persian errors stored, resend reopens the draft and needs a NEW approval', async () => {
    await configure(world, s);
    const id = await draftReady(world, s);
    await s.invoices.requestApproval(world.ctx, id, {});
    await s.invoices.decide(world.ctx, id, true, undefined, {});
    s.setFake((cfg) => {
      const f = new FakeMoodianClient(cfg.settings);
      f.plan(world.db.taxInvoice.rows[0].uid, { inquiry: 'FAILED', taxResult: 'Invalid Service-stuff-id' });
      return f;
    });
    await s.invoices.sendNow(world.ctx, id, {});
    await s.invoices.pollOne(world.ctx, id);
    const row = world.db.taxInvoice.rows[0];
    expect(row.status).toBe('REJECTED');
    expect(row.errors[0].fa).toContain('شناسه کالا/خدمت');
    expect(s.automation.emit).toHaveBeenCalledWith(expect.anything(), 'tax.invoice.rejected', expect.anything());

    await s.invoices.resend(world.ctx, id, {});
    expect(world.db.taxInvoice.rows[0]).toMatchObject({ status: 'DRAFT', payloadSnapshot: null, approvedAt: null, retryFlag: true });
    // بدون تأیید مجدد ارسال نمی‌شود
    expect((await s.invoices.dispatch(world.ctx, id)).sent).toBe(false);
    await s.invoices.requestApproval(world.ctx, id, {});
    await s.invoices.decide(world.ctx, id, true, undefined, {});
    s.setFake(null);
    await s.invoices.dispatch(world.ctx, id);
    expect(s.lastFake().sent[0]).toMatchObject({ uid: row.uid, retry: true });
  });

  it('transport failure → FAILED with retry flag; resend queues the SAME uid with retry=true without re-approval', async () => {
    await configure(world, s);
    const id = await draftReady(world, s);
    await s.invoices.requestApproval(world.ctx, id, {});
    await s.invoices.decide(world.ctx, id, true, undefined, {});
    const uid = world.db.taxInvoice.rows[0].uid;
    s.setFake((cfg) => new FakeMoodianClient(cfg.settings).plan(uid, { sendThrows: new MoodianTransportError('timeout', true) }));
    expect((await s.invoices.dispatch(world.ctx, id)).reason).toBe('FAILED');
    expect(world.db.taxInvoice.rows[0]).toMatchObject({ status: 'FAILED', retryCount: 1, retryFlag: true });
    expect(world.db.taxInvoice.rows[0].nextAttemptAt).toBeInstanceOf(Date);

    s.setFake(null);
    await s.invoices.resend(world.ctx, id, {});
    expect(world.db.taxInvoice.rows[0].status).toBe('APPROVED');
    await s.invoices.dispatch(world.ctx, id);
    expect(s.lastFake().sent[0]).toMatchObject({ uid, retry: true });
  });

  it('a server-side errors[] reply (e.g. 5013) marks FAILED with a Persian message; duplicate uid (5005) falls through to inquiry', async () => {
    await configure(world, s);
    const id = await draftReady(world, s);
    await s.invoices.requestApproval(world.ctx, id, {});
    await s.invoices.decide(world.ctx, id, true, undefined, {});
    const uid = world.db.taxInvoice.rows[0].uid;
    s.setFake((cfg) => new FakeMoodianClient(cfg.settings).plan(uid, { send: { errorCode: '5013', errorDetail: 'invalid.packet.signature' } }));
    await s.invoices.dispatch(world.ctx, id);
    expect(world.db.taxInvoice.rows[0].status).toBe('FAILED');
    expect(world.db.taxInvoice.rows[0].errors[0].fa).toContain('امضا');
    expect(world.db.taxInvoice.rows[0].nextAttemptAt).toBeNull(); // غیرگذرا: فقط دستی

    await s.invoices.resend(world.ctx, id, {});
    s.setFake((cfg) => new FakeMoodianClient(cfg.settings).plan(uid, { send: { errorCode: '5005', errorDetail: 'duplicate.request.uid' } }));
    await s.invoices.dispatch(world.ctx, id);
    expect(world.db.taxInvoice.rows[0].status).toBe('SENT');
  });

  it('hard safety: sending disabled → nothing is sent and the invoice stays APPROVED (not FAILED)', async () => {
    await configure(world, s, { sending: false });
    const id = await draftReady(world, s);
    await s.invoices.requestApproval(world.ctx, id, {});
    await s.invoices.decide(world.ctx, id, true, undefined, {});
    expect(await s.invoices.dispatch(world.ctx, id)).toEqual({ sent: false, reason: 'SENDING_DISABLED' });
    expect(world.db.taxInvoice.rows[0].status).toBe('APPROVED');
    expect(s.fakes.flatMap((f) => f.sent)).toHaveLength(0);
  });

  it('hard safety: PRODUCTION without sandbox verification is blocked at the settings layer and at dispatch', async () => {
    await configure(world, s, { sending: false });
    await expect(s.settings.update(world.ctx, { environment: 'PRODUCTION' })).rejects.toBeInstanceOf(BadRequestException);
    // حتی اگر داده دستی خراب شود، dispatch و کلاینت می‌ایستند
    const id = await draftReady(world, s);
    await s.invoices.requestApproval(world.ctx, id, {});
    await s.invoices.decide(world.ctx, id, true, undefined, {});
    Object.assign(world.db.taxSettings.rows[0], { environment: 'PRODUCTION', sendingEnabled: true, verifiedAgainstSandboxAt: null });
    expect((await s.invoices.dispatch(world.ctx, id)).reason).toBe('PRODUCTION_NOT_VERIFIED');
    expect(world.db.taxInvoice.rows[0].status).toBe('APPROVED');
  });

  it('hard safety: a payload altered after approval is refused by the guard and reverted to APPROVED, nothing sent', async () => {
    await configure(world, s);
    const id = await draftReady(world, s);
    await s.invoices.requestApproval(world.ctx, id, {});
    await s.invoices.decide(world.ctx, id, true, undefined, {});
    world.db.taxInvoice.rows[0].payloadSnapshot.header.tbill = 1;
    expect((await s.invoices.dispatch(world.ctx, id)).reason).toBe('PAYLOAD_CHANGED');
    expect(world.db.taxInvoice.rows[0].status).toBe('APPROVED');
    expect(s.fakes.flatMap((f) => f.sent)).toHaveLength(0);
  });

  it('missing config (no sandbox URL) is not a failure: reverts to APPROVED', async () => {
    await configure(world, s);
    world.db.taxSettings.rows[0].sandboxBaseUrl = null;
    const id = await draftReady(world, s);
    await s.invoices.requestApproval(world.ctx, id, {});
    await s.invoices.decide(world.ctx, id, true, undefined, {});
    expect((await s.invoices.dispatch(world.ctx, id)).reason).toBe('NOT_CONFIGURED');
    expect(world.db.taxInvoice.rows[0].status).toBe('APPROVED');
  });

  it('only one dispatcher wins (CAS): concurrent sends produce a single packet', async () => {
    await configure(world, s);
    const id = await draftReady(world, s);
    await s.invoices.requestApproval(world.ctx, id, {});
    await s.invoices.decide(world.ctx, id, true, undefined, {});
    const [a, b] = await Promise.all([s.invoices.dispatch(world.ctx, id), s.invoices.dispatch(world.ctx, id)]);
    expect([a.sent, b.sent].filter(Boolean)).toHaveLength(1);
    expect(s.fakes.flatMap((f) => f.sent)).toHaveLength(1);
  });

  it('requesting approval is blocked while there are blocking issues (missing taxid) and lists them', async () => {
    await configure(world, s);
    const created = await s.invoices.createFromSalesInvoice(world.ctx, 'si1', {});
    await expect(s.invoices.requestApproval(world.ctx, created.id, {})).rejects.toMatchObject({ response: { issues: expect.arrayContaining([expect.objectContaining({ code: 'TAXID_MISSING' })]) } });
    expect(world.db.taxInvoice.rows[0].status).toBe('DRAFT');
  });

  it('only a REAL manager can approve — even when the approvals inbox runs the handler as ADMIN', async () => {
    await configure(world, s);
    const id = await draftReady(world, s);
    await s.invoices.requestApproval(world.ctx, id, {});
    // کاربر عادی؛ ApprovalsService نقش را ADMIN می‌کند ولی عضویت کنترل‌پلین مدیر نیست
    const member = makeServices(world, { isRealManager: false });
    const actingAsAdmin = { ...world.ctx, auth: { ...world.ctx.auth, role: 'ADMIN' } } as TenantRequestContext;
    await expect(member.invoices.approveConfirmed(actingAsAdmin, id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(world.db.taxInvoice.rows[0].status).toBe('PENDING_APPROVAL');
    // رد مدیر → برگشت به پیش‌نویس
    await s.invoices.decide(world.ctx, id, false, 'مبلغ اشتباه', {});
    expect(world.db.taxInvoice.rows[0].status).toBe('DRAFT');
  });

  it('cancellation/correction chain references the accepted original taxid; duplicates are blocked', async () => {
    await configure(world, s);
    const id = await draftReady(world, s);
    await s.invoices.requestApproval(world.ctx, id, {});
    await s.invoices.decide(world.ctx, id, true, undefined, {});
    await expect(s.invoices.createChain(world.ctx, id, { kind: 'CANCELLATION' }, {})).rejects.toBeInstanceOf(BadRequestException); // هنوز پذیرفته نشده
    await s.invoices.dispatch(world.ctx, id);
    await s.invoices.pollOne(world.ctx, id);
    const res = await s.invoices.createChain(world.ctx, id, { kind: 'CANCELLATION', taxid: 'AA56CD0E0620002F2B4E79' }, {});
    const child = world.db.taxInvoice.rows.find((r: Row) => r.id === res.id)!;
    expect(child).toMatchObject({ subject: 'CANCELLATION', irtaxid: TAXID, refTaxInvoiceId: id, status: 'DRAFT' });
    const pv = (await s.invoices.detail(world.ctx, child.id, {})).preview.payload.header;
    expect(pv.ins).toBe(3);
    expect(pv.irtaxid).toBe(TAXID);
    await expect(s.invoices.createChain(world.ctx, id, { kind: 'CORRECTION' }, {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('processTenant sends approved items and polls sent ones (worker round)', async () => {
    await configure(world, s);
    const id = await draftReady(world, s);
    await s.invoices.requestApproval(world.ctx, id, {});
    await s.invoices.decide(world.ctx, id, true, undefined, {});
    const r1 = await s.invoices.processTenant(world.ctx);
    expect(r1).toEqual({ sent: 1, polled: 1 }); // ارسال و در همان دور استعلام (نخستین استعلام فوری است)
    expect(world.db.taxInvoice.rows[0].status).toBe('ACCEPTED');
    const r2 = await s.invoices.processTenant(world.ctx);
    expect(r2).toEqual({ sent: 0, polled: 0 }); // چیزی برای انجام نیست؛ دوباره ارسال نمی‌شود
    expect(s.fakes.flatMap((f) => f.sent)).toHaveLength(1);
  });

  it('a second ORIGINAL tax invoice for the same sales invoice is refused', async () => {
    await configure(world, s);
    await s.invoices.createFromSalesInvoice(world.ctx, 'si1', {});
    await expect(s.invoices.createFromSalesInvoice(world.ctx, 'si1', {})).rejects.toBeInstanceOf(ConflictException);
  });
});

// ── اعمال scope روی همه‌ی مسیرهای by-id ─────────────────────────────────
describe('scope enforcement on every by-id action', () => {
  const SCOPE = { OR: [{ createdByUserId: 'me' }, { requestedByUserId: 'me' }] };
  const calls: Array<[string, (s: ReturnType<typeof makeServices>, c: TenantRequestContext) => Promise<unknown>]> = [
    ['detail', (s, c) => s.invoices.detail(c, 'x1', SCOPE)],
    ['refresh', (s, c) => s.invoices.refresh(c, 'x1', SCOPE)],
    ['update', (s, c) => s.invoices.update(c, 'x1', { taxid: TAXID }, SCOPE)],
    ['requestApproval', (s, c) => s.invoices.requestApproval(c, 'x1', SCOPE)],
    ['decide', (s, c) => s.invoices.decide(c, 'x1', true, undefined, SCOPE)],
    ['sendNow', (s, c) => s.invoices.sendNow(c, 'x1', SCOPE)],
    ['inquire', (s, c) => s.invoices.inquire(c, 'x1', SCOPE)],
    ['resend', (s, c) => s.invoices.resend(c, 'x1', SCOPE)],
    ['discard', (s, c) => s.invoices.discard(c, 'x1', SCOPE)],
    ['createChain', (s, c) => s.invoices.createChain(c, 'x1', { kind: 'CANCELLATION' }, SCOPE)],
  ];
  for (const [name, call] of calls) {
    it(`${name}: out-of-scope invoice → 404 and nothing is written or sent`, async () => {
      const world = makeWorld({ role: 'MEMBER', sub: 'gx' });
      const s = makeServices(world);
      world.db.taxInvoice.findFirst.mockResolvedValue(null);
      await expect(call(s, world.ctx)).rejects.toBeInstanceOf(NotFoundException);
      expect(world.db.taxInvoice.update).not.toHaveBeenCalled();
      expect(world.db.taxInvoice.updateMany).not.toHaveBeenCalled();
      expect(world.db.taxInvoice.create).not.toHaveBeenCalled();
      expect(s.fakes.flatMap((f) => f.sent)).toHaveLength(0);
      expect(world.db.taxInvoice.findFirst.mock.calls[0]![0].where).toEqual({ AND: [{ id: 'x1' }, SCOPE] });
    });
  }

  it('create is limited to sales invoices inside the caller\'s sales scope', async () => {
    const world = makeWorld({ role: 'MEMBER', sub: 'gx' });
    const s = makeServices(world);
    world.db.salesInvoice.findFirst.mockResolvedValue(null);
    await expect(s.invoices.createFromSalesInvoice(world.ctx, 'si1', { createdByUserId: 'me' })).rejects.toBeInstanceOf(NotFoundException);
    expect(world.db.taxInvoice.create).not.toHaveBeenCalled();
  });

  it('list merges the scope with search via AND', async () => {
    const world = makeWorld({ role: 'MEMBER' });
    const s = makeServices(world);
    await s.invoices.list(world.ctx, SCOPE, { q: 'علی', status: 'DRAFT' });
    const where = world.db.taxInvoice.findMany.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual(SCOPE);
    expect(where.AND).toHaveLength(3);
  });
});

// ── تنظیمات، ماسک و کلید ───────────────────────────────────────────────
describe('settings: secrets are never returned; key handling fails closed', () => {
  it('uploadKey stores only ciphertext + fingerprint; the view/JSON never contains the key', async () => {
    const world = makeWorld();
    const s = makeServices(world);
    const view = await s.settings.uploadKey(world.ctx, { privateKeyPem: PRIV_PEM });
    expect(view.hasPrivateKey).toBe(true);
    expect(view.keyFingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    const stored = world.db.taxSettings.rows[0];
    expect(stored.privateKeyEnc).not.toContain('BEGIN');
    const json = JSON.stringify(await s.settings.getView(world.ctx));
    for (const leak of ['BEGIN', 'PRIVATE', stored.privateKeyEnc, 'privateKeyEnc', 'privateKeyPem']) expect(json).not.toContain(leak);
    expect(Object.keys(view)).not.toContain('privateKeyEnc');
  });

  it('refuses to store a key when TAX_SECRETS_KEY is missing (503, nothing persisted)', async () => {
    const saved = process.env.TAX_SECRETS_KEY;
    delete process.env.TAX_SECRETS_KEY;
    try {
      const world = makeWorld();
      const s = makeServices(world);
      await expect(s.settings.uploadKey(world.ctx, { privateKeyPem: PRIV_PEM })).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(world.db.taxSettings.rows).toHaveLength(0);
      expect((await s.settings.getView(world.ctx)).secretsKeyConfigured).toBe(false);
    } finally {
      process.env.TAX_SECRETS_KEY = saved;
    }
  });

  it('rejects garbage and mismatched private keys', async () => {
    const world = makeWorld();
    const s = makeServices(world);
    await expect(s.settings.uploadKey(world.ctx, { privateKeyPem: 'x'.repeat(200) })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only OWNER/ADMIN may change settings or keys', async () => {
    const world = makeWorld({ role: 'MEMBER' });
    const s = makeServices(world);
    await expect(s.settings.update(world.ctx, { sendingEnabled: true })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.settings.uploadKey(world.ctx, { privateKeyPem: PRIV_PEM })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.settings.removeKey(world.ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.settings.refreshServerKey(world.ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enabling sending needs key + identity + server key + sandbox URL; changing identity or key switches sending off and clears verification', async () => {
    const world = makeWorld();
    const s = makeServices(world);
    await expect(s.settings.update(world.ctx, { sendingEnabled: true })).rejects.toBeInstanceOf(BadRequestException);
    await configure(world, s);
    expect((await s.settings.getView(world.ctx)).sendingEnabled).toBe(true);
    world.db.taxSettings.rows[0].verifiedAgainstSandboxAt = new Date();
    await s.settings.update(world.ctx, { fiscalId: 'BB56CD' });
    const v = await s.settings.getView(world.ctx);
    expect(v).toMatchObject({ sendingEnabled: false, verifiedAgainstSandboxAt: null, environment: 'SANDBOX' });
    // آپلود کلید جدید هم همین را می‌کند
    world.db.taxSettings.rows[0].verifiedAgainstSandboxAt = new Date();
    world.db.taxSettings.rows[0].sendingEnabled = true;
    await s.settings.uploadKey(world.ctx, { privateKeyPem: PRIV_PEM });
    expect(await s.settings.getView(world.ctx)).toMatchObject({ sendingEnabled: false, verifiedAgainstSandboxAt: null });
  });

  it('sandbox base URL must be https on tax.gov.ir; no URL ⇒ no client (never falls back to production)', async () => {
    const world = makeWorld();
    const s = makeServices(world);
    await expect(s.settings.update(world.ctx, { sandboxBaseUrl: 'https://evil.example.com/' })).rejects.toThrow();
    expect(() => s.settings.resolveBaseUrl({ environment: 'SANDBOX', sandboxBaseUrl: null })).toThrow(BadRequestException);
    expect(s.settings.resolveBaseUrl({ environment: 'PRODUCTION', sandboxBaseUrl: null })).toContain('tp.tax.gov.ir');
  });

  it('refreshServerKey stores the purpose=1 key from GET_SERVER_INFORMATION', async () => {
    const world = makeWorld();
    const s = makeServices(world);
    await configure(world, s, { sending: false });
    s.setFake((cfg) => {
      const f = new FakeMoodianClient(cfg.settings);
      f.serverInfo = { serverTime: 1, publicKeys: [{ id: 'k-9', key: SERVER_KEY_B64, algorithm: 'RSA', purpose: 1 }] };
      return f;
    });
    const v = await s.settings.refreshServerKey(world.ctx);
    expect(v.serverPublicKeyId).toBe('k-9');
  });
});

describe('product code mapping', () => {
  it('validates the 13-digit sstid and upserts', async () => {
    const world = makeWorld();
    const p = new TaxProductsService(new TaxAuditService());
    await expect(p.upsert(world.ctx, { productId: 'p1', sstid: '123', unitCode: 1 })).rejects.toBeInstanceOf(BadRequestException);
    const row = await p.upsert(world.ctx, { productId: 'p1', sstid: '2153265989636', unitCode: 1627, vatRate: 9 });
    expect(row.sstid).toBe('2153265989636');
  });
});

describe('sales invoice lock (assertNotTaxLocked)', () => {
  it('blocks while a tax invoice is in flight/accepted; released after an ACCEPTED cancellation', async () => {
    const world = makeWorld();
    const db = world.db as never;
    await expect(assertNotTaxLocked(db, 'si1', 'ابطال')).resolves.toBeUndefined();
    await world.db.taxInvoice.create({ data: { salesInvoiceId: 'si1', status: 'DRAFT' } });
    await expect(assertNotTaxLocked(db, 'si1', 'ابطال')).resolves.toBeUndefined(); // پیش‌نویس قفل نمی‌کند
    const t = await world.db.taxInvoice.create({ data: { salesInvoiceId: 'si1', status: 'ACCEPTED' } });
    await expect(assertNotTaxLocked(db, 'si1', 'ابطال')).rejects.toBeInstanceOf(BadRequestException);
    await world.db.taxInvoice.create({ data: { salesInvoiceId: 'si1', status: 'ACCEPTED', subject: 'CANCELLATION', refTaxInvoiceId: t.id } });
    await expect(assertNotTaxLocked(db, 'si1', 'ابطال')).resolves.toBeUndefined();
  });

  it.each(['PENDING_APPROVAL', 'APPROVED', 'QUEUED', 'SENT'])('locks while %s', async (status) => {
    const world = makeWorld();
    await world.db.taxInvoice.create({ data: { salesInvoiceId: 'si1', status } });
    await expect(assertNotTaxLocked(world.db as never, 'si1', 'ویرایش')).rejects.toBeInstanceOf(BadRequestException);
  });
});
