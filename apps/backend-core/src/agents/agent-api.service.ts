import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma, PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { tenantAccess } from '../billing/subscription-summary.js';
import { clientIp } from '../security/client-ip.js';
import { SecurityEventsService } from '../security/security-events.service.js';
import { openSecret } from '../security/app-secrets.js';
import { AGENTS_MODULE_CODE, registrySlug } from './agent-constants.js';
import { SlidingWindowLimiter, hashAgentKey, parseBearerKey, safeEqualHex, verifySignature } from './agent-api-auth.js';
import { validateEvent, type NormalizedEvent } from './agent-event-validator.js';
import { AgentIngestService, IngestRejection, sanitizePayload, type IngestOutcome } from './agent-ingest.service.js';
import { agentSigningAad } from './agent-products.service.js';

export type AgentApiAuth = {
  db: TenantPrismaClient;
  tenantId: string;
  keyId: string;
  productId: string;
  productCode: string;
  ip: string;
};

const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => new HttpException({ statusCode: status, code, message, ...extra }, status);
const lastUsedWritten = new Map<string, number>();

/** دروازه‌ی API ورودی: کلید Bearer + HMAC + پنجره‌ی زمانی + سقف نرخ + اعتبارسنجی سخت + ثبت ممیزی؛ همیشه روی تننت رجیستری. */
@Injectable()
export class AgentApiService {
  private readonly logger = new Logger('AgentApiService');
  /** سقف پیش از احراز (به‌ازای IP) برای جلوگیری از حدس کلید */
  readonly ipLimiter = new SlidingWindowLimiter();
  readonly keyLimiter = new SlidingWindowLimiter();
  private registryCache: { at: number; tenant: { id: string; status: string } & Record<string, unknown>; db: TenantPrismaClient } | null = null;

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ingest: AgentIngestService,
    private readonly moduleGuard: ModuleGuard,
    private readonly events: SecurityEventsService,
  ) {}

  private async registry() {
    if (this.registryCache && Date.now() - this.registryCache.at < 60_000) return this.registryCache;
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug: registrySlug() } });
    if (!tenant) throw err(503, 'REGISTRY_UNAVAILABLE', 'سرویس موقتاً در دسترس نیست');
    this.registryCache = { at: Date.now(), tenant: tenant as never, db: this.tenantPrisma.forTenant(tenant) };
    return this.registryCache;
  }

  private fail(ip: string, why: string, keyPrefix?: string): never {
    this.events.record({ type: 'API_KEY_AUTH_FAILED', severity: 'WARNING', ip, message: `agents-api auth failed: ${why}`, context: { scope: 'agents-api', keyPrefix }, dedupeKey: `${ip}:${why}` });
    throw err(401, 'UNAUTHORIZED', 'کلید یا امضای نامعتبر');
  }

  async authenticate(req: Request & { rawBody?: Buffer }): Promise<AgentApiAuth> {
    const ip = clientIp(req);
    if (!this.ipLimiter.allow(`ip:${ip}`, Number(process.env.AGENT_API_IP_LIMIT_PER_MIN) || 300)) {
      throw err(429, 'RATE_LIMITED', 'تعداد درخواست بیش از حد مجاز است', { retryAfterSec: this.ipLimiter.retryAfterSec(`ip:${ip}`) });
    }
    const key = parseBearerKey(req.headers.authorization);
    if (!key) this.fail(ip, 'malformed bearer');
    const { tenant, db } = await this.registry();
    if (tenantAccess(tenant.status as never) === 'BLOCKED') throw err(403, 'TENANT_BLOCKED', 'دسترسی غیرفعال است');

    const keyHash = hashAgentKey(key!);
    const row = await db.agentProductApiKey.findUnique({ where: { keyHash }, include: { product: true } });
    // مقایسه‌ی constant-time حتی پس از یافتن ردیف (دفاع در عمق)
    if (!row || !safeEqualHex(row.keyHash, keyHash)) this.fail(ip, 'unknown key', key!.slice(0, 18));
    const k = row!;
    if (k.status !== 'ACTIVE' || (k.expiresAt && k.expiresAt.getTime() <= Date.now())) this.fail(ip, 'revoked or expired key', k.keyPrefix);
    if (k.product.isArchived || !k.product.isActive) throw err(403, 'PRODUCT_INACTIVE', 'این محصول غیرفعال است');

    const unavailable = await this.moduleGuard.moduleUnavailableReason(tenant.id, AGENTS_MODULE_CODE);
    if (unavailable) throw err(403, 'MODULE_DISABLED', 'ماژول نمایندگی فعال نیست');

    if (!this.keyLimiter.allow(`key:${k.id}`, k.maxPerMinute)) {
      throw err(429, 'RATE_LIMITED', 'سقف نرخ این کلید پر شده است', { retryAfterSec: this.keyLimiter.retryAfterSec(`key:${k.id}`) });
    }

    let secret: string;
    try {
      secret = openSecret(k.signingSecretEnc, agentSigningAad(k.id)).value;
    } catch {
      throw err(503, 'KEY_UNAVAILABLE', 'کلید موقتاً در دسترس نیست');
    }
    const raw = req.rawBody ?? Buffer.alloc(0);
    const sig = verifySignature({
      signingSecret: secret,
      timestamp: first(req.headers['x-exir-timestamp']),
      signature: first(req.headers['x-exir-signature']),
      rawBody: raw,
    });
    if (!sig.ok) {
      await this.logOnly(db, { productId: k.productId, keyId: k.id, status: 'REJECTED', httpStatus: 401, errorCode: sig.code, message: 'امضا/زمان نامعتبر', ip });
      this.fail(ip, sig.code, k.keyPrefix);
    }

    const last = lastUsedWritten.get(k.id) ?? 0;
    if (Date.now() - last > 60_000) {
      lastUsedWritten.set(k.id, Date.now());
      void db.agentProductApiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip } }).catch(() => undefined);
    }
    return { db, tenantId: tenant.id, keyId: k.id, productId: k.productId, productCode: k.product.code, ip };
  }

  private async logOnly(db: TenantPrismaClient, d: { productId?: string; keyId?: string; clientEventId?: string; type?: string; status: string; httpStatus: number; errorCode?: string; message?: string; payload?: Prisma.InputJsonValue; ip?: string }) {
    await db.agentApiEventLog.create({ data: d }).catch((e) => this.logger.warn(`event log failed: ${(e as Error).message}`));
  }

  /** POST /events — کل چرخه‌ی اعتبارسنجی → ایدمپوتنت‌پردازی → ممیزی. */
  async handleEvent(auth: AgentApiAuth, body: unknown): Promise<IngestOutcome & { duplicate?: boolean }> {
    const parsed = validateEvent(body);
    if (!parsed.ok) {
      const ce = typeof (body as { eventId?: unknown })?.eventId === 'string' ? String((body as { eventId: string }).eventId).slice(0, 100) : undefined;
      await this.logOnly(auth.db, { productId: auth.productId, keyId: auth.keyId, clientEventId: ce, type: typeof (body as { type?: unknown })?.type === 'string' ? String((body as { type: string }).type).slice(0, 60) : undefined, status: 'REJECTED', httpStatus: 400, errorCode: 'VALIDATION_ERROR', message: parsed.errors.slice(0, 5).join(' | '), ip: auth.ip });
      throw err(400, 'VALIDATION_ERROR', 'ساختار رویداد نامعتبر است', { details: parsed.errors });
    }
    return this.run(auth, parsed.event);
  }

  async run(auth: AgentApiAuth, event: NormalizedEvent, dryRun = false) {
    try {
      const out = await this.ingest.process(auth.db, { productId: auth.productId, keyId: auth.keyId, ip: auth.ip }, event, { dryRun });
      if (out.status === 'DUPLICATE') {
        await this.logOnly(auth.db, { productId: auth.productId, keyId: auth.keyId, clientEventId: event.eventId, type: event.type, status: 'DUPLICATE', httpStatus: 200, message: 'رویداد تکراری (قبلاً پردازش شده)', ip: auth.ip });
        return { ...out, duplicate: true };
      }
      return out;
    } catch (e) {
      if (e instanceof IngestRejection) {
        await this.logOnly(auth.db, { productId: auth.productId, keyId: auth.keyId, clientEventId: event.eventId, type: event.type, status: 'REJECTED', httpStatus: e.httpStatus, errorCode: e.code, message: e.message, payload: sanitizePayload(event) as Prisma.InputJsonValue, ip: auth.ip });
        throw err(e.httpStatus, e.code, e.message);
      }
      this.logger.error(`ingest failed: ${(e as Error).message}`);
      await this.logOnly(auth.db, { productId: auth.productId, keyId: auth.keyId, clientEventId: event.eventId, type: event.type, status: 'ERROR', httpStatus: 500, errorCode: 'INTERNAL', message: 'خطای داخلی', ip: auth.ip });
      throw err(500, 'INTERNAL', 'خطای داخلی؛ رویداد را با همان eventId دوباره ارسال کنید');
    }
  }

  /** دکمه‌ی «ارسال رویداد آزمایشی» (ادمین): زنجیره‌ی کامل ثبت‌نام → فعال‌سازی → تمدید → بازپرداخت → لغو، بدون اثر ماندگار. */
  async runTest(db: TenantPrismaClient, productId: string, referralCode: string): Promise<{ steps: Array<{ type: string; ok: boolean; status?: string; code?: string; message?: string }> }> {
    const now = new Date();
    const id = `test-${Date.now().toString(36)}`;
    const paidAt = new Date(now.getTime() - 1000);
    const end = new Date(now.getTime() + 30 * 86_400_000);
    const sub = { externalCustomerId: id, planCode: 'TEST', planName: 'پلن آزمایشی', amount: 1000, currency: 'IRT', paidAt, periodEnd: end, isTrial: false };
    const events: NormalizedEvent[] = [
      { eventId: `${id}-1`, type: 'customer.registered', occurredAt: now, data: { referralCode: referralCode.toUpperCase(), externalCustomerId: id, name: 'مشتری آزمایشی', phone: null, email: null } },
      { eventId: `${id}-2`, type: 'subscription.activated', occurredAt: now, data: { ...sub, paymentRef: `${id}-p1` } },
      { eventId: `${id}-3`, type: 'subscription.renewed', occurredAt: now, data: { ...sub, paymentRef: `${id}-p2` } },
      { eventId: `${id}-4`, type: 'payment.refunded', occurredAt: now, data: { externalCustomerId: id, paymentRef: `${id}-p2`, amount: 500, currency: 'IRT' } },
      { eventId: `${id}-5`, type: 'subscription.cancelled', occurredAt: now, data: { externalCustomerId: id, reason: 'تست' } },
    ];
    const steps = await this.ingest.dryRunSequence(db, productId, events);
    await this.logOnly(db, { productId, keyId: 'admin-test', clientEventId: id, type: 'test.sequence', status: steps.every((s) => s.ok) ? 'ACCEPTED' : 'REJECTED', httpStatus: 200, message: 'رویداد آزمایشی ادمین (بدون اثر ماندگار)', payload: { steps } as unknown as Prisma.InputJsonValue });
    return { steps };
  }

  async validateReferralCode(auth: AgentApiAuth, rawCode: string) {
    const code = String(rawCode ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_\-]{1,39}$/.test(code)) return { valid: false };
    const m = await auth.db.agentProductMembership.findFirst({ where: { productId: auth.productId, referralCode: code }, select: { status: true } });
    return { valid: !!m && m.status === 'ACTIVE' };
  }
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
