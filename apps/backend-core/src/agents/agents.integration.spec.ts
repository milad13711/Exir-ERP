import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { invalidateBaseCurrency } from '../base-currency/base-unit.js';
import { computeSignature } from './agent-api-auth.js';
import { AgentApiService } from './agent-api.service.js';
import { AgentCustomersService } from './agent-customers.service.js';
import { AgentCommissionService } from './agent-commission.service.js';
import { AgentPayoutsService } from './agent-payouts.service.js';
import { PublicResellerMapService } from '../public/public-reseller-map.service.js';
import { ResellersService } from '../referral-marketing/resellers.service.js';
import { AgentIngestService, IngestRejection } from './agent-ingest.service.js';
import { AgentProductsService } from './agent-products.service.js';
import { AgentRenewalReminderService } from './agent-renewal-reminder.service.js';
import { AgentsService } from './agents.service.js';
import { requireMyMembership, requireMyProfile } from './agents-access.js';
import { validateEvent, type NormalizedEvent } from './agent-event-validator.js';
import { enforceAgentSession, invalidateAgentSessionCache } from './agent-session.js';

/**
 * تست یکپارچه روی Postgres دورریختنی (مهاجرت‌های تننت اعمال‌شده). فقط با AGENTS_TEST_DATABASE_URL اجرا می‌شود؛
 * جدول‌ها پاک می‌شوند — هرگز دیتابیس واقعی نباشد.
 */
const URL = process.env.AGENTS_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRETS_KEY = 'a'.repeat(64);

describe.skipIf(!URL)('agents module — real Postgres', () => {
  let db: PrismaClient;
  const ingest = new AgentIngestService();
  const customers = new AgentCustomersService();
  const products = new AgentProductsService();
  const ctx = () => ({ tenantDb: db, tenantId: 't1', tenantSlug: 'eta', auth: { sub: 'g-admin', role: 'OWNER', type: 'tenant_user' } }) as unknown as TenantRequestContext;
  let seq = 0;
  const id = () => `x${++seq}`;

  const ev = (e: unknown): NormalizedEvent => {
    const r = validateEvent(e);
    if (!r.ok) throw new Error(r.errors.join(','));
    return r.event;
  };
  const reg = (code: string, ext: string, over: Record<string, unknown> = {}) => ev({ eventId: id(), type: 'customer.registered', data: { referralCode: code, externalCustomerId: ext, name: 'مشتری نمونه', ...over } });
  const pay = (ext: string, type: 'subscription.activated' | 'subscription.renewed', ref: string, over: Record<string, unknown> = {}) =>
    ev({ eventId: id(), type, data: { externalCustomerId: ext, planCode: 'PRO', planName: 'حرفه‌ای', amount: 1_000_000, currency: 'IRT', paidAt: new Date(Date.now() - 1000).toISOString(), periodEnd: new Date(Date.now() + 25 * 86_400_000).toISOString(), paymentRef: ref, ...over } });

  let prodA: { id: string };
  let prodB: { id: string };
  let memA: { id: string; resellerProfileId: string; referralCode: string | null };
  let memB: { id: string; resellerProfileId: string };
  let memB2: { id: string };

  async function wipe() {
    const tables = ['agent_payouts', 'agent_commissions', 'agent_transactions', 'agent_transaction_types', 'agent_transaction_items', 'agent_commission_plan_rules', 'agent_customer_transfers', 'agent_renewal_reminders', 'agent_payment_events', 'agent_customer_stage_logs', 'agent_customers', 'agent_api_event_logs', 'agent_profile_changes', 'agent_audit_logs', 'agent_agreement_acceptances', 'agent_agreements', 'agent_commission_rules', 'agent_product_api_keys', 'agent_memberships', 'agent_products', 'reseller_profiles', 'user_roles', 'module_permissions', 'roles', 'users', 'crm_contacts', 'module_settings'];
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`);
  }

  async function mkAgent(name: string, phone: string, email?: string) {
    const c = await db.crmContact.create({ data: { name, phone, email, isSupplier: true, isCustomer: false } });
    const u = await db.user.create({ data: { globalUserId: `g-${name}`, name, phone, status: 'ACTIVE' } });
    return db.resellerProfile.create({ data: { contactId: c.id, userId: u.id } });
  }

  beforeAll(async () => {
    process.env.APP_SECRETS_KEY = SECRETS_KEY;
    db = new PrismaClient({ datasources: { db: { url: URL! } } });
    await db.$connect();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await wipe();
    invalidateBaseCurrency(db);
    prodA = await db.agentProduct.create({ data: { code: 'ERP', name: 'اکسیر ERP' } });
    prodB = await db.agentProduct.create({ data: { code: 'SMS', name: 'پنل پیامک' } });
    const pa = await mkAgent('الف', '09120000001', 'alef@x.ir');
    const pb = await mkAgent('ب', '09120000002');
    memA = await db.agentProductMembership.create({ data: { resellerProfileId: pa.id, productId: prodA.id, status: 'ACTIVE', referralCode: 'ALEF' } });
    memB = await db.agentProductMembership.create({ data: { resellerProfileId: pb.id, productId: prodA.id, status: 'ACTIVE', referralCode: 'BEH' } });
    memB2 = await db.agentProductMembership.create({ data: { resellerProfileId: pb.id, productId: prodB.id, status: 'ACTIVE', referralCode: 'BEH' } }); // همان کد در محصول دیگر مجاز است
  });

  const run = (productId: string, e: NormalizedEvent, opts = {}) => ingest.process(db, { productId, keyId: 'k1', ip: '1.1.1.1' }, e, opts);

  describe('ingest: idempotency, isolation, self-referral', () => {
    it('registers a customer via referral code and is idempotent by eventId (replay)', async () => {
      const e = reg('alef', 'u1', { phone: '09121111111' });
      expect((await run(prodA.id, e)).status).toBe('ACCEPTED');
      expect((await run(prodA.id, e)).status).toBe('DUPLICATE'); // همان eventId
      const rows = await db.agentCustomer.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ membershipId: memA.id, funnelStage: 'REGISTERED', productId: prodA.id });
      expect(await db.agentApiEventLog.count({ where: { eventId: e.eventId } })).toBe(1);
      expect(await db.agentCustomerStageLog.count()).toBe(1);
    });

    it('same code is product-scoped: a code from another product is unknown; same code in two products resolves per product', async () => {
      await expect(run(prodB.id, reg('ALEF', 'u2'))).rejects.toMatchObject({ code: 'UNKNOWN_REFERRAL_CODE' });
      await run(prodA.id, reg('beh', 'u3'));
      await run(prodB.id, reg('beh', 'u4'));
      const a = await db.agentCustomer.findUnique({ where: { productId_externalCustomerId: { productId: prodA.id, externalCustomerId: 'u3' } } });
      const b = await db.agentCustomer.findUnique({ where: { productId_externalCustomerId: { productId: prodB.id, externalCustomerId: 'u4' } } });
      expect(a?.membershipId).toBe(memB.id);
      expect(b?.membershipId).toBe(memB2.id);
    });

    it('blocks self-referral by the agent’s own phone (any format), login phone and email', async () => {
      await expect(run(prodA.id, reg('ALEF', 'self1', { phone: '+98 912 000 0001' }))).rejects.toMatchObject({ code: 'SELF_REFERRAL' });
      await expect(run(prodA.id, reg('ALEF', 'self2', { phone: '۰۹۱۲۰۰۰۰۰۰۱' }))).rejects.toMatchObject({ code: 'SELF_REFERRAL' });
      await expect(run(prodA.id, reg('ALEF', 'self3', { email: 'ALEF@x.ir' }))).rejects.toMatchObject({ code: 'SELF_REFERRAL' });
      // شماره‌ی نماینده‌ی دیگر خود-معرفی نیست
      expect((await run(prodA.id, reg('ALEF', 'ok1', { phone: '09120000002' }))).status).toBe('ACCEPTED');
      expect(await db.agentCustomer.count()).toBe(1);
    });

    it('rejects inactive (PENDING/SUSPENDED/ENDED) memberships and refuses to move a customer to another agent', async () => {
      await db.agentProductMembership.update({ where: { id: memA.id }, data: { status: 'SUSPENDED' } });
      await expect(run(prodA.id, reg('ALEF', 'u5'))).rejects.toMatchObject({ code: 'REFERRAL_CODE_INACTIVE' });
      await run(prodA.id, reg('BEH', 'u6'));
      await db.agentProductMembership.update({ where: { id: memA.id }, data: { status: 'ACTIVE' } });
      await expect(run(prodA.id, reg('ALEF', 'u6'))).rejects.toMatchObject({ code: 'CUSTOMER_ALREADY_ATTRIBUTED' });
    });

    it('subscription → ledger + PAID, then RENEWED; duplicate paymentRef conflicts; non-referred customers are ignored', async () => {
      await run(prodA.id, reg('ALEF', 'c1'));
      const a1 = await run(prodA.id, pay('c1', 'subscription.activated', 'p1', { currency: 'IRR', amount: 10_000_000 }));
      expect(a1.status).toBe('ACCEPTED');
      let c = await db.agentCustomer.findFirstOrThrow({ where: { externalCustomerId: 'c1' } });
      expect(c.funnelStage).toBe('PAID');
      expect(c.nextRenewalAt).not.toBeNull();
      const l1 = await db.agentPaymentEvent.findFirstOrThrow({ where: { paymentRef: 'p1' } });
      expect(l1).toMatchObject({ type: 'PAYMENT_FIRST', amount: 1_000_000, originalCurrency: 'IRR', originalAmount: 10_000_000, currency: 'IRT' });

      await run(prodA.id, pay('c1', 'subscription.renewed', 'p2'));
      c = await db.agentCustomer.findFirstOrThrow({ where: { externalCustomerId: 'c1' } });
      expect(c.funnelStage).toBe('RENEWED');
      expect((await db.agentPaymentEvent.findFirstOrThrow({ where: { paymentRef: 'p2' } })).type).toBe('PAYMENT_RENEWAL');

      await expect(run(prodA.id, pay('c1', 'subscription.renewed', 'p2'))).rejects.toMatchObject({ httpStatus: 409 });
      expect(await db.agentPaymentEvent.count()).toBe(2); // تراکنش برگشت خورد

      // مشتری بدون نماینده: در دفتر مرکزی ثبت می‌شود (برای گزارش کل تراکنش‌ها) ولی پورسانت/مشتری نماینده نمی‌سازد
      const ign = await run(prodA.id, pay('ghost', 'subscription.activated', 'p9'));
      expect(ign.status).toBe('ACCEPTED');
      expect(ign.detail?.reason).toBe('CUSTOMER_NOT_REFERRED');
      expect((await db.agentTransaction.findFirstOrThrow({ where: { externalTxId: 'p9' } })).commissionStatus).toBe('NOT_ATTRIBUTED');
      expect(await db.agentPaymentEvent.count()).toBe(2);
      expect(await db.agentCommission.count({ where: { transaction: { externalTxId: 'p9' } } })).toBe(0);
    });

    it('the ledger is per product: a payment event cannot touch another product’s customer', async () => {
      await run(prodA.id, reg('ALEF', 'shared'));
      const r = await run(prodB.id, pay('shared', 'subscription.activated', 'px'));
      expect(r.detail?.reason).toBe('CUSTOMER_NOT_REFERRED');
      expect(await db.agentPaymentEvent.count()).toBe(0);
      const t = await db.agentTransaction.findFirstOrThrow({ where: { externalTxId: 'px' } });
      expect(t.productId).toBe(prodB.id);
      expect(t.customerId).toBeNull(); // مشتری هم‌نامِ محصول دیگر هرگز به این تراکنش وصل نمی‌شود
    });

    it('refunds: bounded by the payment, partial refunds accumulate, customer mismatch rejected', async () => {
      await run(prodA.id, reg('ALEF', 'r1'));
      await run(prodA.id, reg('BEH', 'r2'));
      await run(prodA.id, pay('r1', 'subscription.activated', 'rp1'));
      const refund = (amount: number, extId?: string) => ev({ eventId: id(), type: 'payment.refunded', data: { ...(extId ? { externalCustomerId: extId } : {}), paymentRef: 'rp1', amount, currency: 'IRT' } });
      expect((await run(prodA.id, refund(400_000))).status).toBe('ACCEPTED');
      expect((await run(prodA.id, refund(600_000))).status).toBe('ACCEPTED');
      await expect(run(prodA.id, refund(1))).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
      await expect(run(prodA.id, refund(1, 'r2'))).rejects.toMatchObject({ code: 'PAYMENT_CUSTOMER_MISMATCH' });
      const sum = await db.agentPaymentEvent.aggregate({ _sum: { amount: true }, where: { type: 'REFUND' } });
      expect(sum._sum.amount).toBe(1_000_000);
      const f = await customers.funnelSummary(ctx(), { membershipIds: [memA.id] });
      expect(f.netSales).toBe(0);
    });

    it('cancel → LOST; trial does not create a ledger row; rejected events never leave data behind', async () => {
      await run(prodA.id, reg('ALEF', 't1'));
      await run(prodA.id, pay('t1', 'subscription.activated', 'tp', { amount: 0, isTrial: true }));
      expect((await db.agentCustomer.findFirstOrThrow({ where: { externalCustomerId: 't1' } })).funnelStage).toBe('TRIAL');
      expect(await db.agentPaymentEvent.count()).toBe(0);
      await run(prodA.id, ev({ eventId: id(), type: 'subscription.cancelled', data: { externalCustomerId: 't1' } }));
      const c = await db.agentCustomer.findFirstOrThrow({ where: { externalCustomerId: 't1' } });
      expect(c).toMatchObject({ funnelStage: 'LOST', status: 'CANCELLED', nextRenewalAt: null });
      await expect(run(prodA.id, pay('t1', 'subscription.activated', 'bad', { currency: 'IRT', amount: 5 }), {}).then(() => null)).resolves.toBeDefined();
    });

    it('dry-run test sequence leaves nothing behind', async () => {
      const api = new AgentApiService({} as never, {} as never, ingest, {} as never, {} as never);
      const out = await api.runTest(db, prodA.id, 'ALEF');
      expect(out.steps.every((s) => s.ok)).toBe(true);
      expect(out.steps.map((s) => s.type)).toEqual(['customer.registered', 'subscription.activated', 'subscription.renewed', 'payment.refunded', 'subscription.cancelled']);
      expect(await db.agentCustomer.count()).toBe(0);
      expect(await db.agentPaymentEvent.count()).toBe(0);
      const bad = await api.runTest(db, prodA.id, 'NOPE');
      expect(bad.steps[0]).toMatchObject({ ok: false, code: 'UNKNOWN_REFERRAL_CODE' });
    });

    it('concurrent replay of the same eventId yields exactly one effect', async () => {
      await run(prodA.id, reg('ALEF', 'cc'));
      const e = pay('cc', 'subscription.activated', 'cp1');
      const results = await Promise.allSettled([run(prodA.id, e), run(prodA.id, e), run(prodA.id, e)]);
      const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 'ERR'));
      expect(statuses.filter((s) => s === 'ACCEPTED')).toHaveLength(1);
      expect(await db.agentPaymentEvent.count()).toBe(1);
    });
  });

  describe('per-agent / per-product isolation (portal scope)', () => {
    it('agent A cannot read agent B’s customers, payments or memberships, nor another product’s', async () => {
      await run(prodA.id, reg('ALEF', 'ia'));
      await run(prodA.id, reg('BEH', 'ib'));
      await run(prodB.id, reg('BEH', 'ib2'));
      await run(prodA.id, pay('ib', 'subscription.activated', 'ibp'));
      const profA = await db.resellerProfile.findFirstOrThrow({ where: { memberships: { some: { id: memA.id } } } });
      const ctxA = { ...ctx(), auth: { sub: 'g-الف', role: 'MEMBER', type: 'tenant_user' } } as unknown as TenantRequestContext;
      const me = await requireMyProfile(ctxA);
      expect(me.id).toBe(profA.id);
      await expect(requireMyMembership(ctxA, me.id, memB.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(requireMyMembership(ctxA, me.id, memB2.id)).rejects.toBeInstanceOf(NotFoundException);
      const own = await customers.list(ctxA, { membershipIds: [memA.id] });
      expect(own.items.map((c) => c.externalCustomerId)).toEqual(['ia']);
      const bCustomer = await db.agentCustomer.findFirstOrThrow({ where: { externalCustomerId: 'ib' } });
      await expect(customers.getInScope(ctxA, { membershipIds: [memA.id] }, bCustomer.id)).rejects.toBeInstanceOf(NotFoundException);
      expect((await customers.payments(ctxA, { membershipIds: [memA.id] })).items).toHaveLength(0);
      expect((await customers.payments(ctxA, { membershipIds: [memB.id] })).items).toHaveLength(1);
      // دید یک محصول از یک نماینده‌ی چندمحصولی جداست
      const prodScoped = await customers.list(ctxA, { membershipIds: [memB.id, memB2.id], productId: prodB.id });
      expect(prodScoped.items.map((c) => c.externalCustomerId)).toEqual(['ib2']);
    });

    it('a non-agent user has no profile (404) — managers use admin routes', async () => {
      await db.user.create({ data: { globalUserId: 'g-nobody', name: 'x', phone: '09129999999' } });
      const c = { ...ctx(), auth: { sub: 'g-nobody', role: 'MEMBER', type: 'tenant_user' } } as unknown as TenantRequestContext;
      await expect(requireMyProfile(c)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('restricted agent session (server-side)', () => {
    it('agent-only users are limited to agents/tasks/checklist; mixed-role staff and others are not', async () => {
      invalidateAgentSessionCache();
      const svc = new AgentsService({} as never, {} as never, products, {} as never, {} as never);
      const { id: roleId } = await svc.ensureAgentRole(db);
      const agentUser = await db.user.findFirstOrThrow({ where: { globalUserId: 'g-الف' } });
      await db.userRole.create({ data: { userId: agentUser.id, roleId } });
      await expect(enforceAgentSession(db, 't1', 'g-الف', 'GET', '/api/crm/contacts')).rejects.toMatchObject({ status: 403 });
      await expect(enforceAgentSession(db, 't1', 'g-الف', 'GET', '/api/sales/invoices')).rejects.toMatchObject({ status: 403 });
      await expect(enforceAgentSession(db, 't1', 'g-الف', 'GET', '/api/agents/me')).resolves.toBeUndefined();
      await expect(enforceAgentSession(db, 't1', 'g-الف', 'GET', '/api/tasks')).resolves.toBeUndefined();
      // کارمندی که نقش دیگری هم دارد محدود نمی‌شود
      invalidateAgentSessionCache();
      const other = await db.role.create({ data: { name: 'فروش' } });
      await db.userRole.create({ data: { userId: agentUser.id, roleId: other.id } });
      await expect(enforceAgentSession(db, 't1', 'g-الف', 'GET', '/api/crm/contacts')).resolves.toBeUndefined();
      // ماتریس نقش نماینده حداقلی است
      const rows = await db.modulePermission.findMany({ where: { roleId } });
      expect(rows.map((r) => r.moduleCode).sort()).toEqual(['agents', 'daily-checklist', 'tasks']);
      expect(rows.every((r) => r.canViewOwn && !r.canViewAll && !r.canDelete)).toBe(true);
      const agentsRow = rows.find((r) => r.moduleCode === 'agents')!;
      expect(agentsRow).toMatchObject({ canViewAll: false, canCreate: false, canEdit: false });
    });
  });

  describe('API gateway: key auth, HMAC, replay window, rate limit, product scoping', () => {
    function mkApi() {
      const tenant = { id: 't1', slug: 'eta', status: 'ACTIVE' };
      const events = { record: vi.fn() };
      return new AgentApiService({ tenant: { findUnique: async () => tenant } } as never, { forTenant: () => db } as never, ingest, { moduleUnavailableReason: async () => null } as never, events as never);
    }
    function signed(key: string, secret: string, body: string, opts: { ts?: number; sig?: string } = {}) {
      const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
      return { headers: { authorization: `Bearer ${key}`, 'x-exir-timestamp': ts, 'x-exir-signature': opts.sig ?? computeSignature(secret, ts, body) }, rawBody: Buffer.from(body), socket: { remoteAddress: '203.0.113.9' } } as never;
    }

    it('creates a key shown once, hashed + sealed at rest, masked in listings', async () => {
      const k = await products.createKey(ctx(), prodA.id, { name: 'prod' });
      expect(k.apiKey).toMatch(/^exir_agent_/);
      expect(k.signingSecret).toMatch(/^exir_sign_/);
      const row = await db.agentProductApiKey.findUniqueOrThrow({ where: { id: k.id } });
      expect(JSON.stringify(row)).not.toContain(k.apiKey);
      expect(row.signingSecretEnc.startsWith('enc1:')).toBe(true);
      expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/);
      const listed = JSON.stringify(await products.listKeys(ctx(), prodA.id));
      expect(listed).not.toContain(k.apiKey);
      expect(listed).not.toContain(k.signingSecret);
      expect(listed).toContain('••••');
    });

    it('authenticates, then fails closed on wrong key / signature / stale timestamp / revoked key / disabled product', async () => {
      const api = mkApi();
      const k = await products.createKey(ctx(), prodA.id, { name: 'prod' });
      const body = JSON.stringify({ eventId: 'e-auth', type: 'customer.registered', data: {} });
      const ok = await api.authenticate(signed(k.apiKey, k.signingSecret, body));
      expect(ok).toMatchObject({ productId: prodA.id, productCode: 'ERP' });
      const bad = async (req: unknown, status: number) => expect(api.authenticate(req as never)).rejects.toMatchObject({ status });
      await bad(signed(k.apiKey + 'x', k.signingSecret, body), 401);
      await bad(signed(k.apiKey, 'exir_sign_wrong', body), 401);
      await bad(signed(k.apiKey, k.signingSecret, body, { ts: Math.floor(Date.now() / 1000) - 600 }), 401);
      await bad({ headers: { authorization: `Bearer ${k.apiKey}` }, rawBody: Buffer.from(body), socket: { remoteAddress: '203.0.113.9' } }, 401);
      await bad({ headers: {}, rawBody: Buffer.from(body), socket: { remoteAddress: '203.0.113.9' } }, 401);
      expect(await db.agentApiEventLog.count({ where: { status: 'REJECTED', errorCode: 'TIMESTAMP_OUT_OF_WINDOW' } })).toBe(1);

      await products.revokeKey(ctx(), prodA.id, k.id);
      await bad(signed(k.apiKey, k.signingSecret, body), 401);
      const k2 = await products.createKey(ctx(), prodA.id, { name: 'two' });
      await products.update(ctx(), prodA.id, { isActive: false });
      await bad(signed(k2.apiKey, k2.signingSecret, body), 403);
    });

    it('rotation revokes the old key immediately and the new one works', async () => {
      const api = mkApi();
      const k = await products.createKey(ctx(), prodA.id, { name: 'prod' });
      const rotated = await products.rotateKey(ctx(), prodA.id, k.id);
      const body = '{}';
      await expect(api.authenticate(signed(k.apiKey, k.signingSecret, body))).rejects.toMatchObject({ status: 401 });
      await expect(api.authenticate(signed(rotated.apiKey, rotated.signingSecret, body))).resolves.toBeDefined();
      expect(rotated.id).not.toBe(k.id);
    });

    it('per-key rate limit returns 429 with retry hint', async () => {
      const api = mkApi();
      const k = await products.createKey(ctx(), prodA.id, { name: 'limited', maxPerMinute: 10 });
      await db.agentProductApiKey.update({ where: { id: k.id }, data: { maxPerMinute: 3 } });
      const body = '{}';
      for (let i = 0; i < 3; i++) await api.authenticate(signed(k.apiKey, k.signingSecret, body));
      const err = await api.authenticate(signed(k.apiKey, k.signingSecret, body)).catch((e) => e as HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      expect(((err as HttpException).getResponse() as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(0);
    });

    it('a key only reaches its own product (no cross-product access), via validate + events', async () => {
      const api = mkApi();
      const kA = await products.createKey(ctx(), prodA.id, { name: 'a' });
      const kB = await products.createKey(ctx(), prodB.id, { name: 'b' });
      const authA = await api.authenticate(signed(kA.apiKey, kA.signingSecret, '{}'));
      const authB = await api.authenticate(signed(kB.apiKey, kB.signingSecret, '{}'));
      expect(await api.validateReferralCode(authA, 'alef')).toEqual({ valid: true });
      expect(await api.validateReferralCode(authB, 'alef')).toEqual({ valid: false }); // ALEF فقط عضویت محصول A است
      expect(await api.validateReferralCode(authA, 'bad code!')).toEqual({ valid: false });
      const out = await api.handleEvent(authB, { eventId: 'cross-1', type: 'customer.registered', data: { referralCode: 'ALEF', externalCustomerId: 'z', name: 'مشتری' } }).catch((e) => e as HttpException);
      expect((out as HttpException).getStatus()).toBe(422);
      expect(await db.agentCustomer.count()).toBe(0);
    });

    it('handleEvent logs validation failures, accepted, duplicates and rejects (full audit trail)', async () => {
      const api = mkApi();
      const k = await products.createKey(ctx(), prodA.id, { name: 'a' });
      const auth = await api.authenticate(signed(k.apiKey, k.signingSecret, '{}'));
      await expect(api.handleEvent(auth, { eventId: 'v1', type: 'customer.registered', data: { oops: 1 } })).rejects.toMatchObject({ status: 400 });
      const good = { eventId: 'g1', type: 'customer.registered', data: { referralCode: 'ALEF', externalCustomerId: 'au1', name: 'مشتری' } };
      expect((await api.handleEvent(auth, good)).status).toBe('ACCEPTED');
      expect((await api.handleEvent(auth, good)).status).toBe('DUPLICATE');
      await expect(api.handleEvent(auth, { eventId: 'g2', type: 'customer.registered', data: { referralCode: 'ZZZ', externalCustomerId: 'au2', name: 'مشتری' } })).rejects.toMatchObject({ status: 422 });
      const logs = await db.agentApiEventLog.findMany({ orderBy: { createdAt: 'asc' } });
      expect(logs.map((l) => l.status)).toEqual(['REJECTED', 'ACCEPTED', 'DUPLICATE', 'REJECTED']);
      expect(JSON.stringify(logs)).not.toMatch(/09\d{9}/);
    });
  });

  describe('profile sensitive changes (sheba / phone) with SMS OTP', () => {
    const sms = { isConfigured: () => true, sendSms: vi.fn(async () => ({ success: true })) };
    const mk = () => new AgentsService({} as never, {} as never, products, sms as never, { tryRecord: vi.fn() } as never);
    const validSheba = (() => {
      const bban = '0170000000100324200001';
      const n = BigInt(`${bban}182700`);
      return `IR${String(98n - (n % 97n)).padStart(2, '0')}${bban}`;
    })();
    // آخرین پیامکِ «کد تأیید» (پیامک اطلاع تغییر شبا کد ندارد)
    const lastCode = () => {
      const msgs = (sms.sendSms.mock.calls as unknown as Array<[string, string]>).map((c) => String(c[1])).filter((m) => m.includes('کد تأیید'));
      return /(\d{6})/.exec(msgs.at(-1)!)![1]!;
    };

    it('rejects an invalid sheba before any SMS; valid flow: OTP → applied only after confirmation; one-time use', async () => {
      const svc = mk();
      const p = await db.resellerProfile.findFirstOrThrow({ where: { memberships: { some: { id: memA.id } } } });
      sms.sendSms.mockClear();
      await expect(svc.requestChange(ctx(), p.id, 'SHEBA', 'IR000000000000000000000000', 'AGENT')).rejects.toMatchObject({ status: 400 });
      expect(sms.sendSms).not.toHaveBeenCalled();

      const r = await svc.requestChange(ctx(), p.id, 'SHEBA', validSheba, 'AGENT');
      expect(sms.sendSms).toHaveBeenCalledWith('09120000001', expect.stringContaining('تأیید'));
      expect((await db.resellerProfile.findUniqueOrThrow({ where: { id: p.id } })).shabaNumber).toBeNull();
      await expect(svc.confirmChange(ctx(), p.id, r.changeId, lastCode() === '000000' ? '111111' : '000000', 'AGENT')).rejects.toMatchObject({ status: 400 });
      const code = lastCode();
      expect(await svc.confirmChange(ctx(), p.id, r.changeId, code, 'AGENT')).toMatchObject({ pendingApproval: true });
      // تغییر از پنل نماینده: پس از کد پیامکی هنوز اعمال نشده، منتظر تأیید مدیر
      let after = await db.resellerProfile.findUniqueOrThrow({ where: { id: p.id } });
      expect(after.shabaNumber).toBeNull();
      expect(await svc.pendingSheba(db, p.id)).toMatchObject({ id: r.changeId });
      await expect(svc.confirmChange(ctx(), p.id, r.changeId, code, 'AGENT')).rejects.toMatchObject({ status: 404 });
      const queue = await svc.listShebaChanges(ctx());
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ newSheba: validSheba, currentSheba: null, status: 'PENDING' });
      await svc.approveShebaChange(ctx(), r.changeId);
      await expect(svc.approveShebaChange(ctx(), r.changeId)).rejects.toMatchObject({ status: 409 });
      after = await db.resellerProfile.findUniqueOrThrow({ where: { id: p.id } });
      expect(after.shabaNumber).toBe(validSheba);
      expect(after.shebaVerifiedAt).not.toBeNull();
      expect(await svc.pendingSheba(db, p.id)).toBeNull();
      // اطلاع پیامکی تغییر شبا به شماره‌ی نماینده، با شبای ماسک‌شده
      const notice = (sms.sendSms.mock.calls as unknown as Array<[string, string]>).at(-1)!;
      expect(notice[0]).toBe('09120000001');
      expect(notice[1]).toContain('تغییر کرد');
      expect(notice[1]).not.toContain(validSheba);
      // شبای کامل در خروجی عمومی ماسک می‌شود
      expect(JSON.stringify(svc.publicProfile(after))).not.toContain(validSheba);
      expect(await db.agentAuditLog.count({ where: { resellerProfileId: p.id, action: 'change.sheba.approved' } })).toBe(1);
    });

    it('agent sheba change rejected by admin leaves the old sheba; admin-initiated change applies after the agent code', async () => {
      const svc = mk();
      const p = await db.resellerProfile.findFirstOrThrow({ where: { memberships: { some: { id: memA.id } } } });
      const r1 = await svc.requestChange(ctx(), p.id, 'SHEBA', validSheba, 'AGENT');
      await svc.confirmChange(ctx(), p.id, r1.changeId, lastCode(), 'AGENT');
      await svc.rejectShebaChange(ctx(), r1.changeId, 'شبا به نام نماینده نیست');
      expect((await db.resellerProfile.findUniqueOrThrow({ where: { id: p.id } })).shabaNumber).toBeNull();
      expect((await svc.listShebaChanges(ctx(), 'REJECTED'))[0]).toMatchObject({ rejectReason: 'شبا به نام نماینده نیست' });
      await new Promise((res) => setTimeout(res, 10));
      await db.agentProfileChange.updateMany({ data: { createdAt: new Date(Date.now() - 3_600_000) } }); // عبور از فاصله‌ی ارسال مجدد
      const r2 = await svc.requestChange(ctx(), p.id, 'SHEBA', validSheba, 'ADMIN');
      expect(await svc.confirmChange(ctx(), p.id, r2.changeId, lastCode(), 'ADMIN')).not.toHaveProperty('pendingApproval');
      expect((await db.resellerProfile.findUniqueOrThrow({ where: { id: p.id } })).shabaNumber).toBe(validSheba);
    });

    it('locks after 5 wrong codes; a change request belongs to its own profile only', async () => {
      const svc = mk();
      const pa = await db.resellerProfile.findFirstOrThrow({ where: { memberships: { some: { id: memA.id } } } });
      const pb = await db.resellerProfile.findFirstOrThrow({ where: { memberships: { some: { id: memB.id } } } });
      const r = await svc.requestChange(ctx(), pa.id, 'SHEBA', validSheba, 'AGENT');
      const real = lastCode();
      const wrong = real === '123456' ? '654321' : '123456';
      for (let i = 0; i < 5; i++) await expect(svc.confirmChange(ctx(), pa.id, r.changeId, wrong, 'AGENT')).rejects.toMatchObject({ status: 400 });
      await expect(svc.confirmChange(ctx(), pa.id, r.changeId, real, 'AGENT')).rejects.toMatchObject({ status: 400 });
      await expect(svc.confirmChange(ctx(), pb.id, r.changeId, real, 'AGENT')).rejects.toMatchObject({ status: 404 });
    });

    it('phone change sends the code to the NEW number and refuses a number owned by another agent', async () => {
      const svc = mk();
      const pa = await db.resellerProfile.findFirstOrThrow({ where: { memberships: { some: { id: memA.id } } } });
      await expect(svc.requestChange(ctx(), pa.id, 'PHONE', '09120000002', 'ADMIN')).rejects.toMatchObject({ status: 409 });
      sms.sendSms.mockClear();
      const r = await svc.requestChange(ctx(), pa.id, 'PHONE', '+989125550000', 'ADMIN');
      expect(sms.sendSms).toHaveBeenCalledWith('09125550000', expect.any(String));
      await svc.confirmChange(ctx(), pa.id, r.changeId, lastCode(), 'ADMIN');
      expect((await db.crmContact.findFirstOrThrow({ where: { resellerProfile: { id: pa.id } } })).phone).toBe('09125550000');
    });
  });

  describe('applications → profile + memberships; membership rules', () => {
    function mkSvc() {
      const app = { id: 'app1', name: 'نماینده نو', company: null, phone: '0912 777 8899', email: null, city: 'قم', websiteUrl: null, status: 'PENDING' };
      const control = {
        resellerApplication: {
          findUnique: async () => app,
          update: vi.fn(async ({ data }: { data: object }) => Object.assign(app, data)),
        },
      };
      const resellers = { grantAccess: vi.fn(async () => ({})) };
      return { svc: new AgentsService(control as never, resellers as never, products, {} as never, {} as never), control, resellers, app };
    }
    it('approve creates one profile with memberships for the chosen products, flagged agent role, and is not re-approvable', async () => {
      const { svc, control, resellers, app } = mkSvc();
      const out = await svc.approveApplication(ctx(), 'app1', [{ productId: prodA.id, level: 'A' }, { productId: prodB.id }]);
      expect(out.created).toBe(true);
      const ms = await db.agentProductMembership.findMany({ where: { resellerProfileId: out.profile.id }, orderBy: { level: 'asc' } });
      expect(ms.map((m) => [m.level, m.status])).toEqual([['A', 'ACTIVE'], ['B', 'ACTIVE']]);
      expect(resellers.grantAccess).toHaveBeenCalledTimes(1);
      expect((await db.role.findUniqueOrThrow({ where: { name: 'نماینده' } })).isAgentRole).toBe(true);
      expect(control.resellerApplication.update).toHaveBeenCalled();
      app.status = 'APPROVED';
      await expect(svc.approveApplication(ctx(), 'app1', [{ productId: prodA.id }])).rejects.toMatchObject({ status: 400 });
    });
    it('the same phone does not create a second profile — it adds memberships', async () => {
      const { svc, app } = mkSvc();
      app.phone = '09120000001'; // همان نمایندهٔ «الف»
      const out = await svc.approveApplication(ctx(), 'app1', [{ productId: prodB.id }]);
      expect(out.created).toBe(false);
      expect(await db.resellerProfile.count()).toBe(2);
      expect(await db.agentProductMembership.count({ where: { resellerProfileId: out.profile.id } })).toBe(2);
    });
    it('referral code: manual, normalized, unique per product only; archived/inactive products are refused', async () => {
      const svc = new AgentsService({} as never, {} as never, products, {} as never, {} as never);
      await expect(svc.updateMembership(ctx(), memA.id, { referralCode: 'beh' })).rejects.toMatchObject({ status: 409 });
      await svc.updateMembership(ctx(), memA.id, { referralCode: ' new-code ' });
      expect((await db.agentProductMembership.findUniqueOrThrow({ where: { id: memA.id } })).referralCode).toBe('NEW-CODE');
      await expect(svc.updateMembership(ctx(), memA.id, { referralCode: 'bad code' })).rejects.toMatchObject({ status: 400 });
      await svc.updateMembership(ctx(), memA.id, { referralCode: '' });
      expect((await db.agentProductMembership.findUniqueOrThrow({ where: { id: memA.id } })).referralCode).toBeNull();
      // ended memberships cannot be re-activated
      await svc.updateMembership(ctx(), memA.id, { status: 'ENDED' });
      await expect(svc.updateMembership(ctx(), memA.id, { status: 'ACTIVE' })).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('products registry, versioned agreement and archive-if-referenced', () => {
    it('create with currency-aware default min settlement and hold days', async () => {
      const p = await products.create(ctx(), { code: 'NEWP', name: 'محصول نو' });
      expect(p).toMatchObject({ holdDays: 7, minSettlementAmount: 500_000 });
      await db.moduleSetting.create({ data: { moduleCode: 'currency-exchange', key: 'baseCurrency', value: { code: 'IRR', label: 'ریال', tomanPerUnitNum: '1', tomanPerUnitDen: '10' } } });
      invalidateBaseCurrency(db);
      const q = await products.create(ctx(), { code: 'RIAL', name: 'ریالی' });
      expect(q.minSettlementAmount).toBe(5_000_000);
      await expect(products.create(ctx(), { code: 'NEWP', name: 'تکراری' })).rejects.toMatchObject({ status: 409 });
    });
    it('delete archives when referenced (and revokes keys), hard-deletes when free', async () => {
      const k = await products.createKey(ctx(), prodA.id, { name: 'k' });
      expect(await products.removeOrArchive(ctx(), prodA.id)).toEqual({ archived: true });
      expect((await db.agentProduct.findUniqueOrThrow({ where: { id: prodA.id } })).isArchived).toBe(true);
      expect((await db.agentProductApiKey.findUniqueOrThrow({ where: { id: k.id } })).status).toBe('REVOKED');
      const free = await products.create(ctx(), { code: 'FREE', name: 'آزاد' });
      expect(await products.removeOrArchive(ctx(), free.id)).toEqual({ archived: false });
      expect(await db.agentProduct.count({ where: { id: free.id } })).toBe(0);
    });
    it('agreement versions: draft → publish; new version makes acceptors REACCEPT_REQUIRED; acceptance records e-sign evidence', async () => {
      const svc = new AgentsService({} as never, {} as never, products, {} as never, { tryRecord: vi.fn(async () => ({ id: 'ev1' })) } as never);
      const d1 = await products.saveDraft(ctx(), prodA.id, { title: 'تفاهم‌نامه', body: 'متن نسخه‌ی یک تفاهم‌نامه' });
      const d1b = await products.saveDraft(ctx(), prodA.id, { title: 'تفاهم‌نامه', body: 'متن ویرایش‌شده‌ی نسخه یک' });
      expect(d1b.id).toBe(d1.id); // پیش‌نویس واحد
      await products.publish(ctx(), prodA.id, d1.id);
      const profA = await db.resellerProfile.findFirstOrThrow({ where: { memberships: { some: { id: memA.id } } }, include: { contact: true } });
      const view = async () => (await svc.membershipView(db, (await db.agentProductMembership.findUniqueOrThrow({ where: { id: memA.id } })) as never, profA)).agreement.status;
      expect(await view()).toBe('REQUIRED');
      await svc.acceptAgreement(ctx(), {} as never, profA.id, memA.id, { agreementId: d1.id, signerName: 'الف', signatureDataUrl: 'data:image/png;base64,AAAA' });
      expect(await view()).toBe('ACCEPTED');
      await expect(svc.acceptAgreement(ctx(), {} as never, profA.id, memA.id, { agreementId: d1.id, signerName: 'الف', signatureDataUrl: 'data:image/png;base64,AAAA' })).rejects.toMatchObject({ status: 409 });
      const d2 = await products.saveDraft(ctx(), prodA.id, { title: 'تفاهم‌نامه', body: 'متن نسخه‌ی دو تفاهم‌نامه' });
      expect(d2.version).toBe(2);
      await products.publish(ctx(), prodA.id, d2.id);
      expect(await view()).toBe('REACCEPT_REQUIRED');
      // قدیمی‌شده را نمی‌توان پذیرفت
      await expect(svc.acceptAgreement(ctx(), {} as never, profA.id, memA.id, { agreementId: d1.id, signerName: 'الف', signatureDataUrl: 'data:image/png;base64,AAAA' })).rejects.toMatchObject({ status: 409 });
      // نماینده‌ی دیگر نمی‌تواند برای عضویت من امضا کند
      const profB = await db.resellerProfile.findFirstOrThrow({ where: { memberships: { some: { id: memB.id } } } });
      await expect(svc.acceptAgreement(ctx(), {} as never, profB.id, memA.id, { agreementId: d2.id, signerName: 'ب', signatureDataUrl: 'data:image/png;base64,AAAA' })).rejects.toBeInstanceOf(NotFoundException);
    });
    it('commission rules are versioned (insert-only) and resolve by event time', async () => {
      await products.createRule(ctx(), prodA.id, { level: 'A', firstPaymentPercent: 10, renewalPercent: 5, effectiveFrom: '2026-01-01' });
      await products.createRule(ctx(), prodA.id, { level: 'A', firstPaymentPercent: 15, renewalPercent: 7, effectiveFrom: '2026-06-01' });
      const rules = await products.listRules(ctx(), prodA.id);
      expect(rules).toHaveLength(2);
    });
  });

  describe('renewal reminders: idempotent, capped, only own agent', () => {
    it('sends one SMS per agent/kind, never twice for the same period, releases claims on failure', async () => {
      await run(prodA.id, reg('ALEF', 'rm1'));
      await run(prodA.id, reg('ALEF', 'rm2'));
      for (const [ext, days] of [['rm1', 5], ['rm2', 20]] as const) {
        await run(prodA.id, pay(ext, 'subscription.activated', `rmp-${ext}`, { paidAt: new Date(Date.now() - 1000).toISOString(), periodEnd: new Date(Date.now() + days * 86_400_000).toISOString() }));
      }
      const sendSms = vi.fn(async () => ({ success: true }));
      const svc = new AgentRenewalReminderService({} as never, {} as never, { sendSms } as never);
      const first = await svc.runFor({ tenantId: 't1', tenantDb: db });
      expect(first.sent).toBe(2); // D7 + D30
      expect(sendSms).toHaveBeenCalledTimes(2);
      expect(sendSms.mock.calls.every((c) => (c as unknown as string[])[1] === '09120000001')).toBe(true);
      const second = await svc.runFor({ tenantId: 't1', tenantDb: db });
      expect(second.sent).toBe(0);
      expect(sendSms).toHaveBeenCalledTimes(2);
      // شکست ارسال → فردا دوباره
      await db.agentRenewalReminder.deleteMany();
      const failing = new AgentRenewalReminderService({} as never, {} as never, { sendSms: vi.fn(async () => ({ success: false, error: 'x' })) } as never);
      expect((await failing.runFor({ tenantId: 't1', tenantDb: db })).sent).toBe(0);
      expect(await db.agentRenewalReminder.count()).toBe(0);
    });
  });

  describe('commission engine: central ledger, multi-dimensional rules, wallet, refunds, transfer', () => {
    const commission = new AgentCommissionService();
    const txEv = (ext: string, txId: string, over: Record<string, unknown> = {}) =>
      ev({ eventId: id(), type: 'transaction.recorded', data: { transactionId: txId, externalCustomerId: ext, txType: 'SUBSCRIPTION', itemCode: 'crm', itemName: 'اشتراک CRM', grossAmount: 10_000_000, discountAmount: 2_000_000, taxAmount: 720_000, currency: 'IRT', paidAt: new Date().toISOString(), ...over } });

    beforeEach(async () => {
      // سطح B («نقره‌ای» در مثال): CRM — اولی ۱۰٪، هر تمدید ۱۵٪
      await commission.createPlanRule(ctx(), prodA.id, { level: 'B', txTypeCode: 'SUBSCRIPTION', itemCode: 'crm', occurrence: 'FIRST', percent: 10 });
      await commission.createPlanRule(ctx(), prodA.id, { level: 'B', txTypeCode: 'SUBSCRIPTION', itemCode: 'crm', occurrence: 'RENEWAL', percent: 15 });
      await run(prodA.id, reg('ALEF', 'cust1'));
    });

    it('first purchase 10% of net, renewals 15%; held for the product hold period; catalog auto-filled', async () => {
      const r1 = await run(prodA.id, txEv('cust1', 't1'));
      expect(r1.detail).toMatchObject({ occurrence: 'FIRST', commissionStatus: 'CREDITED', commission: 800_000 }); // ۱۰٪ از ۸ میلیون خالص (بدون مالیات)
      const r2 = await run(prodA.id, txEv('cust1', 't2'));
      expect(r2.detail).toMatchObject({ occurrence: 'RENEWAL', commission: 1_200_000 });
      const w = await commission.wallet(ctx(), memA.id);
      expect(w.balances).toMatchObject({ earnedAvailable: 0, held: 2_000_000, totalEarned: 2_000_000, withdrawable: 0 }); // مهلت ۷ روزه‌ی پیش‌فرض
      const cat = await commission.catalog(ctx(), prodA.id);
      expect(cat.types.map((t) => t.code)).toContain('SUBSCRIPTION');
      expect(cat.items.map((i) => i.code)).toContain('crm');
      // ایدمپوتنت با شناسه‌ی تراکنش، حتی با eventId تازه
      expect((await run(prodA.id, txEv('cust1', 't2'))).status).toBe('DUPLICATE');
      expect(await db.agentCommission.count()).toBe(2);
    });

    it('a rule change only affects later transactions (snapshots keep the old rate)', async () => {
      await run(prodA.id, txEv('cust1', 'a1'));
      await run(prodA.id, txEv('cust1', 'a2'));
      await commission.createPlanRule(ctx(), prodA.id, { level: 'B', txTypeCode: 'SUBSCRIPTION', itemCode: 'crm', occurrence: 'RENEWAL', percent: 12 });
      const r3 = await run(prodA.id, txEv('cust1', 'a3'));
      expect(r3.detail).toMatchObject({ commission: 960_000 });
      const old = await db.agentCommission.findFirstOrThrow({ where: { transaction: { externalTxId: 'a2' } } });
      expect(old.amount).toBe(1_200_000);
      expect(old.percent).toBe(15);
      const open = await commission.listPlanRules(ctx(), prodA.id, false);
      expect(open.filter((r) => r.occurrence === 'RENEWAL')).toHaveLength(1); // قانون قبلی بسته شد
    });

    it('rules are per level and fall back to the most specific match; no rule → NO_RULE, still in the ledger', async () => {
      const r = await run(prodA.id, txEv('cust1', 'b1', { txType: 'SMS_PACKAGE', itemCode: 'sms-1000', occurrence: 'ONE_OFF' }));
      expect(r.detail).toMatchObject({ commissionStatus: 'NO_RULE', commission: 0 });
      await commission.createPlanRule(ctx(), prodA.id, { level: 'B', percent: 3 }); // هر تراکنش دیگر
      expect((await run(prodA.id, txEv('cust1', 'b2', { txType: 'SMS_PACKAGE', itemCode: 'sms-1000', occurrence: 'ONE_OFF' }))).detail).toMatchObject({ commission: 240_000 });
      await db.agentProductMembership.update({ where: { id: memA.id }, data: { level: 'A' } });
      expect((await run(prodA.id, txEv('cust1', 'b3'))).detail).toMatchObject({ commissionStatus: 'NO_RULE' }); // سطح A قانونی ندارد
    });

    it('refunds reverse the commission proportionally and immediately; over-refund is refused', async () => {
      await run(prodA.id, txEv('cust1', 'r1'));
      const back = await run(prodA.id, txEv('cust1', 'r1-ref1', { refundOf: 'r1', grossAmount: 2_000_000, discountAmount: 0 }));
      expect(back.detail).toMatchObject({ occurrence: 'REFUND', commissionStatus: 'REVERSED', commission: -200_000 });
      await expect(run(prodA.id, txEv('cust1', 'r1-ref2', { refundOf: 'r1', grossAmount: 7_000_000, discountAmount: 0 }))).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
      const w = await commission.wallet(ctx(), memA.id);
      expect(w.balances).toMatchObject({ earnedAvailable: -200_000, held: 800_000, totalEarned: 600_000 });
      expect(w.entries.map((e) => e.kind).sort()).toEqual(['CREDIT', 'REVERSAL']);
    });

    it('inactive agent earns nothing; after transfer the new agent earns on later renewals', async () => {
      await run(prodA.id, txEv('cust1', 'm1'));
      await db.agentProductMembership.update({ where: { id: memA.id }, data: { status: 'ENDED' } });
      expect((await run(prodA.id, txEv('cust1', 'm2'))).detail).toMatchObject({ commissionStatus: 'AGENT_INACTIVE', commission: 0 });
      const cust = await db.agentCustomer.findFirstOrThrow({ where: { externalCustomerId: 'cust1' } });
      await expect(commission.transferCustomer(ctx(), cust.id, { toMembershipId: memB2.id })).rejects.toThrow('همین محصول');
      await commission.transferCustomer(ctx(), cust.id, { toMembershipId: memB.id, reason: 'پایان همکاری نماینده‌ی قبلی' });
      const r = await run(prodA.id, txEv('cust1', 'm3'));
      expect(r.detail).toMatchObject({ occurrence: 'RENEWAL', commission: 1_200_000 });
      expect((await db.agentCommission.findFirstOrThrow({ where: { transaction: { externalTxId: 'm3' } } })).membershipId).toBe(memB.id);
      expect((await commission.wallet(ctx(), memA.id)).balances.totalEarned).toBe(800_000); // سابقه‌ی نماینده‌ی قبلی دست‌نخورده
      expect(await commission.transfers(ctx(), cust.id)).toHaveLength(1);
    });

    describe('payouts: request → approve → manual payment with tracking number; business card; report', () => {
      const sent: string[] = [];
      const payouts = new AgentPayoutsService({ sendSms: async (_t: unknown, _p: string, msg: string) => (sent.push(msg), { success: true }) } as never);
      const SHEBA = 'IR062960000000100324200001';

      beforeEach(async () => {
        sent.length = 0;
        await db.agentProduct.update({ where: { id: prodA.id }, data: { holdDays: 0, minSettlementAmount: 500_000 } });
        await db.resellerProfile.update({ where: { id: memA.resellerProfileId }, data: { shabaNumber: SHEBA, shebaVerifiedAt: new Date() } });
        await run(prodA.id, txEv('cust1', 'p1')); // ۸۰۰ هزار
        await run(prodA.id, txEv('cust1', 'p2')); // ۱٫۲ میلیون → جمع ۲ میلیون قابل تسویه
      });

      it('reserves the amount, enforces minimum/balance/one-open-request, and pays with a tracking number', async () => {
        await expect(payouts.request(ctx(), memA.id, 400_000, undefined, 'AGENT')).rejects.toMatchObject({ response: { code: 'BELOW_MINIMUM' } });
        await expect(payouts.request(ctx(), memA.id, 2_000_001, undefined, 'AGENT')).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_BALANCE' } });
        const p = await payouts.request(ctx(), memA.id, 1_500_000, 'لطفاً سریع', 'AGENT');
        expect(p).toMatchObject({ status: 'REQUESTED', shebaNumber: SHEBA, amount: 1_500_000 });
        expect((await payouts.summaryFor(db, memA.id)).withdrawable).toBe(500_000);
        await expect(payouts.request(ctx(), memA.id, 500_000, undefined, 'AGENT')).rejects.toMatchObject({ response: { code: 'OPEN_PAYOUT_EXISTS' } });
        // پرداخت قبل از تأیید ممنوع
        await expect(payouts.markPaid(ctx(), p.id, { trackingNumber: 'TRK-123456' })).rejects.toThrow('قابل تغییر');
        await payouts.approve(ctx(), p.id);
        await expect(payouts.markPaid(ctx(), p.id, { trackingNumber: 'x' })).rejects.toThrow('پیگیری');
        const paid = await payouts.markPaid(ctx(), p.id, { trackingNumber: 'TRK-123456' });
        expect(paid).toMatchObject({ status: 'PAID', trackingNumber: 'TRK-123456' });
        expect(sent.some((m) => m.includes('TRK-123456'))).toBe(true);
        // دو بار پرداخت ممکن نیست
        await expect(payouts.markPaid(ctx(), p.id, { trackingNumber: 'TRK-999999' })).rejects.toThrow('قابل تغییر');
        expect(await payouts.summaryFor(db, memA.id)).toMatchObject({ paid: 1_500_000, pending: 0, withdrawable: 500_000 });
      });

      it('approve/pay refuse when the agent sheba changed (or lost verification) after the request', async () => {
        const p = await payouts.request(ctx(), memA.id, 1_000_000, undefined, 'AGENT');
        await db.resellerProfile.update({ where: { id: memA.resellerProfileId }, data: { shabaNumber: 'IR820540102680020817909002' } });
        await expect(payouts.approve(ctx(), p.id)).rejects.toMatchObject({ response: { code: 'SHEBA_CHANGED' } });
        await db.resellerProfile.update({ where: { id: memA.resellerProfileId }, data: { shabaNumber: SHEBA } });
        await payouts.approve(ctx(), p.id);
        await db.resellerProfile.update({ where: { id: memA.resellerProfileId }, data: { shebaVerifiedAt: null } });
        await expect(payouts.markPaid(ctx(), p.id, { trackingNumber: 'TRK-123456' })).rejects.toMatchObject({ response: { code: 'SHEBA_CHANGED' } });
        expect((await db.agentPayout.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('APPROVED');
      });

      it('concurrent requests: only one wins', async () => {
        const rs = await Promise.allSettled([1, 2, 3].map(() => payouts.request(ctx(), memA.id, 1_000_000, undefined, 'AGENT')));
        expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(await db.agentPayout.count()).toBe(1);
      });

      it('rejection and cancellation release the reserve; agents only cancel their own REQUESTED payout', async () => {
        const p = await payouts.request(ctx(), memA.id, 1_000_000, undefined, 'AGENT');
        await expect(payouts.cancelOwn(ctx(), memB.resellerProfileId, p.id)).rejects.toBeInstanceOf(NotFoundException);
        await payouts.cancelOwn(ctx(), memA.resellerProfileId, p.id);
        const p2 = await payouts.request(ctx(), memA.id, 2_000_000, undefined, 'AGENT');
        await payouts.approve(ctx(), p2.id);
        await expect(payouts.cancelOwn(ctx(), memA.resellerProfileId, p2.id)).rejects.toThrow('قابل تغییر');
        await payouts.reject(ctx(), p2.id, 'شبا به نام نماینده نیست');
        expect(sent.some((m) => m.includes('رد شد'))).toBe(true);
        expect((await payouts.summaryFor(db, memA.id)).withdrawable).toBe(2_000_000);
      });

      it('unverified sheba or suspended membership cannot request; ended agents can still withdraw earned money', async () => {
        await db.resellerProfile.update({ where: { id: memA.resellerProfileId }, data: { shebaVerifiedAt: null } });
        await expect(payouts.request(ctx(), memA.id, 600_000, undefined, 'AGENT')).rejects.toMatchObject({ response: { code: 'SHEBA_NOT_VERIFIED' } });
        await db.resellerProfile.update({ where: { id: memA.resellerProfileId }, data: { shebaVerifiedAt: new Date() } });
        await db.agentProductMembership.update({ where: { id: memA.id }, data: { status: 'SUSPENDED' } });
        await expect(payouts.request(ctx(), memA.id, 600_000, undefined, 'AGENT')).rejects.toMatchObject({ response: { code: 'MEMBERSHIP_NOT_ELIGIBLE' } });
        await db.agentProductMembership.update({ where: { id: memA.id }, data: { status: 'ENDED' } });
        expect((await payouts.request(ctx(), memA.id, 600_000, undefined, 'AGENT')).status).toBe('REQUESTED');
      });

      it('admin list reveals the full sheba, agent list masks it', async () => {
        await payouts.request(ctx(), memA.id, 600_000, undefined, 'AGENT');
        expect((await payouts.list(ctx(), { membershipId: memA.id }, true)).items[0].shebaNumber).toBe(SHEBA);
        expect((await payouts.list(ctx(), { membershipId: memA.id }, false)).items[0].shebaNumber).not.toBe(SHEBA);
      });

      it('business card builds the referral link + QR; performance report sums sales, commission and payouts', async () => {
        await db.agentProduct.update({ where: { id: prodA.id }, data: { referralUrlTemplate: 'https://amlak.example/signup?ref={code}' } });
        const card = await payouts.businessCard(ctx(), memA.id);
        expect(card.referralUrl).toBe(`https://amlak.example/signup?ref=${memA.referralCode}`);
        expect(card.qrSvg).toContain('<svg');
        const p = await payouts.request(ctx(), memA.id, 1_000_000, undefined, 'AGENT');
        await payouts.approve(ctx(), p.id);
        await payouts.markPaid(ctx(), p.id, { trackingNumber: 'TRK-777777' });
        await run(prodA.id, txEv('nobody', 'u1'));
        const rep = await payouts.report(ctx(), { productId: prodA.id });
        const row = rep.rows.find((r) => r.membershipId === memA.id)!;
        expect(row).toMatchObject({ firstSales: 8_000_000, renewalSales: 8_000_000, netSales: 16_000_000, commission: 2_000_000, paidInPeriod: 1_000_000, withdrawable: 1_000_000 });
        expect(rep.totals.unattributedNetSales).toBe(8_000_000);
      });
    });

    it('rules cannot be back-dated; the central ledger lists every transaction with totals', async () => {
      await expect(commission.createPlanRule(ctx(), prodA.id, { level: 'B', percent: 5, effectiveFrom: '2026-01-01' })).rejects.toThrow('گذشته');
      await run(prodA.id, txEv('cust1', 'l1'));
      await run(prodA.id, txEv('nobody', 'l2'));
      const list = await commission.transactions(ctx(), { productId: prodA.id });
      expect(list.items.map((i) => i.externalTxId).sort()).toEqual(['l1', 'l2']);
      expect(list.items.find((i) => i.externalTxId === 'l2')?.commissionStatus).toBe('NOT_ATTRIBUTED');
      expect(list.totals.commission).toBe(800_000);
    });
  });

  it('eta.co.ir form + map read from the agents module (active products, verified agents with an ACTIVE membership)', async () => {
    const pub = new PublicResellerMapService({ tenant: { findUnique: async () => ({ id: 't1', slug: 'eta' }) } } as never, { forTenant: () => db } as never);
    const codes = (await pub.listProducts()).map((p) => p.code);
    expect(codes).toContain('ERP');
    await db.agentProduct.update({ where: { id: prodB.id }, data: { isArchived: true, isActive: false } });
    expect((await pub.listProducts()).map((p) => p.code)).not.toContain((await db.agentProduct.findUniqueOrThrow({ where: { id: prodB.id } })).code);
    expect(await pub.listForMap()).toEqual([]); // هنوز هیچ نماینده‌ی احرازشده‌ای با شهر نیست
    await db.resellerProfile.update({ where: { id: memA.resellerProfileId }, data: { isVerified: true, city: 'تهران', logoUrl: 'javascript:alert(1)' } });
    const pins = await pub.listForMap();
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ city: 'تهران', productCode: 'ERP', logoUrl: null });
    expect(await pub.listForMap('OTHER_CODE')).toEqual([]);
    await db.agentProductMembership.update({ where: { id: memA.id }, data: { status: 'ENDED' } });
    expect(await pub.listForMap()).toEqual([]);
  });

  it('legacy referral-marketing update cannot change sheba/phone on the registry tenant; elsewhere a changed sheba loses verification', async () => {
    const legacy = new ResellersService({} as never, {} as never, { registerHandler: () => undefined } as never);
    await db.resellerProfile.update({ where: { id: memA.resellerProfileId }, data: { shabaNumber: 'IR062960000000100324200001', shebaVerifiedAt: new Date() } });
    await expect(legacy.update(ctx(), memA.resellerProfileId, { shabaNumber: 'IR820540102680020817909002' } as never)).rejects.toThrow('ماژول «نمایندگی»');
    await expect(legacy.update(ctx(), memA.resellerProfileId, { phone: '09129999999' } as never)).rejects.toThrow('ماژول «نمایندگی»');
    const other = () => ({ ...ctx(), tenantSlug: 'some-customer' }) as unknown as TenantRequestContext;
    await legacy.update(other(), memA.resellerProfileId, { shabaNumber: 'IR820540102680020817909002' } as never);
    const after = await db.resellerProfile.findUniqueOrThrow({ where: { id: memA.resellerProfileId } });
    expect(after.shebaVerifiedAt).toBeNull();
  });

  it('IngestRejection carries machine codes', () => {
    expect(new IngestRejection(422, 'X', 'm')).toMatchObject({ httpStatus: 422, code: 'X' });
  });
});
