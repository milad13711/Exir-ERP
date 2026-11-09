import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { loadBaseCurrency } from '../base-currency/base-unit.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { sealSecret } from '../security/app-secrets.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AGENT_API_BASE, DEFAULT_HOLD_DAYS, DEFAULT_MIN_SETTLEMENT_TOMAN } from './agent-constants.js';
import { generateAgentKey, maskAgentKey } from './agent-api-auth.js';
import { tomanToBase } from './agent-money.js';
import type { CreateAgentProductDto, CreateApiKeyDto, CreateCommissionRuleDto, SaveAgreementDto, UpdateAgentProductDto, UpdateApiKeyDto } from './dto/product.dto.js';

export const agentSigningAad = (keyId: string) => `agentapi:signing:${keyId}`;

/** رجیستری محصولات اکسیر، قوانین کمیسیون نسخه‌دار، تفاهم‌نامه‌ی نسخه‌دار و کلیدهای API هر محصول. */
@Injectable()
export class AgentProductsService {
  // ── محصولات ──────────────────────────────────────────────
  list(ctx: TenantRequestContext, includeArchived = false) {
    return ctx.tenantDb.agentProduct.findMany({
      where: includeArchived ? {} : { isArchived: false },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { memberships: true, customers: true, apiKeys: true } } },
    });
  }

  async get(ctx: TenantRequestContext, id: string) {
    const p = await ctx.tenantDb.agentProduct.findUnique({ where: { id }, include: { _count: { select: { memberships: true, customers: true, apiKeys: true } } } });
    if (!p) throw new NotFoundException('محصول یافت نشد');
    return p;
  }

  async create(ctx: TenantRequestContext, dto: CreateAgentProductDto) {
    const base = await loadBaseCurrency(ctx.tenantDb);
    const exists = await ctx.tenantDb.agentProduct.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException('محصولی با این کد قبلاً ثبت شده است');
    return ctx.tenantDb.agentProduct.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        logoUrl: dto.logoUrl,
        websiteUrl: dto.websiteUrl,
        referralUrlTemplate: dto.referralUrlTemplate || null,
        referralCodePolicy: dto.referralCodePolicy ?? 'MANUAL',
        holdDays: dto.holdDays ?? DEFAULT_HOLD_DAYS,
        // پیش‌فرض ۵۰۰٬۰۰۰ تومان، متناسب با ارز پایه‌ی فعلی تننت
        minSettlementAmount: dto.minSettlementAmount ?? tomanToBase(DEFAULT_MIN_SETTLEMENT_TOMAN, base),
      },
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateAgentProductDto) {
    await this.get(ctx, id);
    return ctx.tenantDb.agentProduct.update({ where: { id }, data: { ...dto, ...(dto.referralUrlTemplate !== undefined ? { referralUrlTemplate: dto.referralUrlTemplate || null } : {}) } });
  }

  /** اگر محصول به عضویت/مشتری/کلید/تفاهم‌نامه وصل باشد بایگانی می‌شود (غیرفعال)، وگرنه حذف. */
  async removeOrArchive(ctx: TenantRequestContext, id: string): Promise<{ archived: boolean }> {
    const p = await ctx.tenantDb.agentProduct.findUnique({
      where: { id },
      include: { _count: { select: { memberships: true, customers: true, apiKeys: true, agreements: true, rules: true } } },
    });
    if (!p) throw new NotFoundException('محصول یافت نشد');
    const referenced = Object.values(p._count).some((n) => n > 0);
    if (referenced) {
      await ctx.tenantDb.agentProduct.update({ where: { id }, data: { isArchived: true, isActive: false } });
      await ctx.tenantDb.agentProductApiKey.updateMany({ where: { productId: id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } });
      return { archived: true };
    }
    await ctx.tenantDb.agentProduct.delete({ where: { id } });
    return { archived: false };
  }

  async restore(ctx: TenantRequestContext, id: string) {
    await this.get(ctx, id);
    return ctx.tenantDb.agentProduct.update({ where: { id }, data: { isArchived: false, isActive: true } });
  }

  // ── قوانین کمیسیون نسخه‌دار ─────────────────────────────
  listRules(ctx: TenantRequestContext, productId: string) {
    return ctx.tenantDb.agentCommissionRule.findMany({ where: { productId }, orderBy: [{ level: 'asc' }, { effectiveFrom: 'desc' }] });
  }

  async createRule(ctx: TenantRequestContext, productId: string, dto: CreateCommissionRuleDto) {
    await this.get(ctx, productId);
    const when = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    if (Number.isNaN(when.getTime())) throw new BadRequestException('تاریخ شروع اعتبار نامعتبر است');
    return ctx.tenantDb.agentCommissionRule.create({
      data: {
        productId,
        level: dto.level,
        firstPaymentPercent: dto.firstPaymentPercent,
        renewalPercent: dto.renewalPercent,
        effectiveFrom: when,
        note: dto.note,
        createdByUserId: await resolveTenantUserId(ctx).catch(() => null),
      },
    });
  }

  // ── تفاهم‌نامه‌ی نسخه‌دار ────────────────────────────────
  listAgreements(ctx: TenantRequestContext, productId: string) {
    return ctx.tenantDb.agentAgreement.findMany({ where: { productId }, orderBy: { version: 'desc' }, include: { _count: { select: { acceptances: true } } } });
  }

  async saveDraft(ctx: TenantRequestContext, productId: string, dto: SaveAgreementDto) {
    await this.get(ctx, productId);
    const draft = await ctx.tenantDb.agentAgreement.findFirst({ where: { productId, status: 'DRAFT' } });
    if (draft) return ctx.tenantDb.agentAgreement.update({ where: { id: draft.id }, data: { title: dto.title, body: dto.body } });
    const last = await ctx.tenantDb.agentAgreement.findFirst({ where: { productId }, orderBy: { version: 'desc' } });
    return ctx.tenantDb.agentAgreement.create({
      data: { productId, version: (last?.version ?? 0) + 1, title: dto.title, body: dto.body, createdByUserId: await resolveTenantUserId(ctx).catch(() => null) },
    });
  }

  /** انتشار پیش‌نویس: نسخه‌ی جدید معتبر می‌شود و نمایندگانِ نسخه‌ی قبلی باید دوباره بپذیرند (agreementStatus = REQUIRED). */
  async publish(ctx: TenantRequestContext, productId: string, agreementId: string) {
    const a = await ctx.tenantDb.agentAgreement.findFirst({ where: { id: agreementId, productId } });
    if (!a) throw new NotFoundException('تفاهم‌نامه یافت نشد');
    if (a.status === 'PUBLISHED') throw new ConflictException('این نسخه قبلاً منتشر شده است');
    return ctx.tenantDb.agentAgreement.update({ where: { id: a.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
  }

  latestPublished(db: TenantRequestContext['tenantDb'], productId: string) {
    return db.agentAgreement.findFirst({ where: { productId, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
  }

  // ── کلیدهای API ──────────────────────────────────────────
  async listKeys(ctx: TenantRequestContext, productId: string) {
    const keys = await ctx.tenantDb.agentProductApiKey.findMany({ where: { productId }, orderBy: { createdAt: 'desc' } });
    return keys.map((k) => this.publicKey(k));
  }

  /** فقط همین‌جا کلید و رمز امضا یک‌بار برمی‌گردند؛ بعد از آن هرگز. */
  async createKey(ctx: TenantRequestContext, productId: string, dto: CreateApiKeyDto) {
    const product = await this.get(ctx, productId);
    if (product.isArchived || !product.isActive) throw new BadRequestException('محصول غیرفعال یا بایگانی‌شده کلید API نمی‌گیرد');
    let expiresAt: Date | null = null;
    if (dto.expiresAt) {
      expiresAt = new Date(dto.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new BadRequestException('تاریخ انقضا نامعتبر یا گذشته است');
    }
    const gen = generateAgentKey();
    const id = randomUUID();
    let signingSecretEnc: string;
    try {
      signingSecretEnc = sealSecret(gen.signingSecret, agentSigningAad(id));
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const row = await ctx.tenantDb.agentProductApiKey.create({
      data: {
        id,
        productId,
        name: dto.name,
        keyPrefix: gen.keyPrefix,
        keyHash: gen.keyHash,
        signingSecretEnc,
        maxPerMinute: dto.maxPerMinute ?? 120,
        expiresAt,
        createdByUserId: await resolveTenantUserId(ctx).catch(() => null),
      },
    });
    return { ...this.publicKey(row), apiKey: gen.key, signingSecret: gen.signingSecret, showOnce: true };
  }

  /** چرخش: کلید قدیمی همان لحظه باطل و کلید/رمز جدید ساخته می‌شود (نام و سقف نرخ منتقل می‌شود). */
  async rotateKey(ctx: TenantRequestContext, productId: string, keyId: string) {
    const old = await ctx.tenantDb.agentProductApiKey.findFirst({ where: { id: keyId, productId } });
    if (!old) throw new NotFoundException('کلید یافت نشد');
    if (old.status !== 'ACTIVE') throw new ConflictException('این کلید قبلاً باطل شده است');
    await this.revokeKey(ctx, productId, keyId);
    return this.createKey(ctx, productId, { name: old.name, maxPerMinute: old.maxPerMinute });
  }

  async revokeKey(ctx: TenantRequestContext, productId: string, keyId: string) {
    const k = await ctx.tenantDb.agentProductApiKey.findFirst({ where: { id: keyId, productId } });
    if (!k) throw new NotFoundException('کلید یافت نشد');
    if (k.status === 'REVOKED') return this.publicKey(k);
    const row = await ctx.tenantDb.agentProductApiKey.update({
      where: { id: keyId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedByUserId: await resolveTenantUserId(ctx).catch(() => null) },
    });
    return this.publicKey(row);
  }

  async updateKey(ctx: TenantRequestContext, productId: string, keyId: string, dto: UpdateApiKeyDto) {
    const k = await ctx.tenantDb.agentProductApiKey.findFirst({ where: { id: keyId, productId } });
    if (!k) throw new NotFoundException('کلید یافت نشد');
    return this.publicKey(await ctx.tenantDb.agentProductApiKey.update({ where: { id: keyId }, data: dto }));
  }

  /** نمایش ایمن: هرگز هش/رمز امضا؛ فقط پیشوند مخفی‌شده. */
  private publicKey(k: { id: string; productId: string; name: string; keyPrefix: string; status: string; maxPerMinute: number; lastUsedAt: Date | null; lastUsedIp: string | null; expiresAt: Date | null; createdAt: Date; revokedAt: Date | null }) {
    return {
      id: k.id,
      productId: k.productId,
      name: k.name,
      maskedKey: maskAgentKey(k.keyPrefix),
      status: k.status,
      maxPerMinute: k.maxPerMinute,
      lastUsedAt: k.lastUsedAt,
      lastUsedIp: k.lastUsedIp,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
      revokedAt: k.revokedAt,
    };
  }

  /** نشانی پایه‌ی API برای نمایش در تنظیمات (از PUBLIC_API_URL یا نشانی درخواست). */
  baseUrl(requestOrigin?: string): string {
    const root = (process.env.PUBLIC_API_URL ?? process.env.API_PUBLIC_URL ?? requestOrigin ?? '').replace(/\/$/, '');
    const withApi = /\/api$/.test(root) ? root : `${root}/api`;
    return `${withApi}${AGENT_API_BASE}`;
  }

  /** هش متن تفاهم‌نامه برای مدرک امضا. */
  static hashAgreement(a: { version: number; title: string; body: string }): string {
    return createHash('sha256').update(JSON.stringify({ v: a.version, t: a.title, b: a.body })).digest('hex');
  }
}
