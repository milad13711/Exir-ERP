import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { SignatureEvidenceService } from '../common/signature-evidence/signature-evidence.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { ResellersService } from '../referral-marketing/resellers.service.js';
import { AgentProductsService } from './agent-products.service.js';
import { AGENT_LEVELS, AGENT_ROLE_NAME, AGENTS_MODULE_CODE, type AgentLevel } from './agent-constants.js';
import { LEGACY_PRODUCT_NAMES, levelToTier } from './agent-backfill.js';
import { normalizeIranMobile, phoneKey } from './agent-phone.js';
import { assertValidSheba, maskSheba } from './sheba.js';
import { resolveRates } from './agent-rules.js';
import { assertRegistryTenant } from './agents-access.js';
import type { AcceptAgreementDto, AddMembershipDto, ApproveMembershipItemDto, CreateAgentProfileDto, UpdateAgentProfileDto, UpdateMembershipDto } from './dto/agents.dto.js';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_MS = 60_000;
const OTP_DAILY_CAP = 6;
const REFERRAL_CODE_RE = /^[A-Z0-9][A-Z0-9_\-]{1,39}$/;

type Db = TenantPrismaClient;

export function normalizeReferralCode(input: string): string {
  return String(input ?? '').trim().toUpperCase();
}

export function hashOtp(salt: string, code: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

export function otpMatches(salt: string, code: string, expectedHash: string): boolean {
  const a = Buffer.from(hashOtp(salt, code));
  const b = Buffer.from(expectedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** مدیریت نمایندگان: درخواست‌های eta، پروفایل‌ها، عضویت‌های محصولی، تفاهم‌نامه و تغییر حساس (شبا/شماره) با OTP. */
@Injectable()
export class AgentsService {
  private readonly logger = new Logger('AgentsService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly resellers: ResellersService,
    private readonly products: AgentProductsService,
    private readonly sms: ExirSmsService,
    private readonly evidence: SignatureEvidenceService,
  ) {}

  // ── نقش محدود «نماینده» ──────────────────────────────────
  /** نقش «نماینده» با پرچم isAgentRole و ماتریس حداقلی (نمایندگی + وظایف + لیست کار روزانه، همه «فقط خودم»). پیام‌رسان و کارتابل تأیید ماتریس ندارند و مسیرشان در agent-session-policy باز است. idempotent. */
  async ensureAgentRole(db: Db): Promise<{ id: string }> {
    let role = await db.role.findUnique({ where: { name: AGENT_ROLE_NAME } });
    if (!role) role = await db.role.create({ data: { name: AGENT_ROLE_NAME, isAgentRole: true } });
    else if (!role.isAgentRole) role = await db.role.update({ where: { id: role.id }, data: { isAgentRole: true } });
    const rows: Array<{ moduleCode: string; canCreate: boolean; canEdit: boolean }> = [
      { moduleCode: AGENTS_MODULE_CODE, canCreate: false, canEdit: false },
      { moduleCode: 'tasks', canCreate: true, canEdit: true },
      { moduleCode: 'daily-checklist', canCreate: true, canEdit: true },
    ];
    for (const r of rows) {
      await db.modulePermission.upsert({
        where: { roleId_moduleCode: { roleId: role.id, moduleCode: r.moduleCode } },
        create: { roleId: role.id, moduleCode: r.moduleCode, canViewAll: false, canViewOwn: true, canCreate: r.canCreate, canEdit: r.canEdit, canDelete: false },
        update: { canViewAll: false, canViewOwn: true, canCreate: r.canCreate, canEdit: r.canEdit, canDelete: false },
      });
    }
    return { id: role.id };
  }

  private async audit(db: Db, entry: { resellerProfileId?: string; membershipId?: string; action: string; detail?: string; ctx?: TenantRequestContext; actorType?: string }) {
    const actorUserId = entry.ctx ? await resolveTenantUserId(entry.ctx).catch(() => null) : null;
    await db.agentAuditLog
      .create({ data: { resellerProfileId: entry.resellerProfileId, membershipId: entry.membershipId, action: entry.action, detail: entry.detail, actorUserId, actorType: entry.actorType ?? 'ADMIN' } })
      .catch((e) => this.logger.warn(`audit failed: ${(e as Error).message}`));
  }

  // ── درخواست‌های همکاری (کنترل‌پلین، فرم عمومی eta.co.ir) ─────
  async listApplications(ctx: TenantRequestContext, status?: string) {
    assertRegistryTenant(ctx);
    const where = status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status) ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' } : {};
    return this.controlDb.resellerApplication.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 });
  }

  /** تأیید = ساخت (یا بازاستفاده از) پروفایل + عضویت ACTIVE برای محصولات انتخابی + اعطای ورود. تکرارپذیر. */
  async approveApplication(ctx: TenantRequestContext, id: string, items: ApproveMembershipItemDto[]) {
    assertRegistryTenant(ctx);
    const app = await this.controlDb.resellerApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('درخواست یافت نشد');
    if (app.status !== 'PENDING') throw new BadRequestException('این درخواست قبلاً بررسی شده است');
    const phone = normalizeIranMobile(app.phone);
    if (!phone) throw new BadRequestException('شماره‌ی موبایل درخواست‌دهنده معتبر نیست؛ ابتدا درخواست را اصلاح کنید');

    const result = await this.createOrExtendProfile(ctx, {
      name: app.name,
      company: app.company ?? undefined,
      phone,
      email: app.email ?? undefined,
      city: app.city ?? undefined,
      websiteUrl: app.websiteUrl ?? undefined,
      items,
    });
    await this.controlDb.resellerApplication.update({ where: { id }, data: { status: 'APPROVED', reviewedAt: new Date() } });
    await this.audit(ctx.tenantDb, { resellerProfileId: result.profile.id, action: 'application.approved', detail: `درخواست ${id}`, ctx });
    return { ...result, applicationId: id };
  }

  async rejectApplication(ctx: TenantRequestContext, id: string, note?: string) {
    assertRegistryTenant(ctx);
    const app = await this.controlDb.resellerApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('درخواست یافت نشد');
    if (app.status !== 'PENDING') throw new BadRequestException('این درخواست قبلاً بررسی شده است');
    return this.controlDb.resellerApplication.update({ where: { id }, data: { status: 'REJECTED', reviewedAt: new Date(), rejectionNote: note } });
  }

  async createProfile(ctx: TenantRequestContext, dto: CreateAgentProfileDto) {
    assertRegistryTenant(ctx);
    const phone = normalizeIranMobile(dto.phone);
    if (!phone) throw new BadRequestException('شماره‌ی موبایل نامعتبر است');
    const r = await this.createOrExtendProfile(ctx, { name: dto.name, company: dto.company, phone, city: dto.city, items: dto.memberships });
    await this.audit(ctx.tenantDb, { resellerProfileId: r.profile.id, action: 'profile.created', ctx });
    return r;
  }

  private async createOrExtendProfile(
    ctx: TenantRequestContext,
    input: { name: string; company?: string; phone: string; email?: string; city?: string; websiteUrl?: string; items: ApproveMembershipItemDto[] },
  ) {
    const db = ctx.tenantDb;
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const prods = await db.agentProduct.findMany({ where: { id: { in: productIds } } });
    if (prods.length !== productIds.length) throw new BadRequestException('محصول انتخابی یافت نشد');
    const bad = prods.find((p) => p.isArchived || !p.isActive);
    if (bad) throw new BadRequestException(`محصول «${bad.name}» غیرفعال یا بایگانی‌شده است`);

    // هر شماره فقط یک پروفایل: اگر نماینده‌ای با همین شماره هست، فقط عضویت اضافه می‌شود
    const existing = await this.findProfileByPhone(db, input.phone);
    const roleReady = await this.ensureAgentRole(db);
    let profile: { id: string; userId: string | null } = existing ?? { id: '', userId: null };
    let created = false;
    if (!existing) {
      const contact = await db.crmContact.create({
        data: { name: input.name, company: input.company, phone: input.phone, email: input.email, type: input.company ? 'COMPANY' : 'INDIVIDUAL', isCustomer: false, isSupplier: true },
      });
      const legacyCode = prods.find((p) => p.code in LEGACY_PRODUCT_NAMES)?.code;
      profile = await db.resellerProfile.create({
        data: {
          contactId: contact.id,
          websiteUrl: input.websiteUrl,
          city: input.city,
          isVerified: true,
          verifiedAt: new Date(),
          productCode: legacyCode as never, // سازگاری با نقشه‌ی eta.co.ir
          phoneVerifiedAt: null,
        },
      });
      created = true;
    }

    const memberships = [];
    for (const item of input.items) {
      const level = (item.level ?? 'B') as AgentLevel;
      const m = await db.agentProductMembership.upsert({
        where: { resellerProfileId_productId: { resellerProfileId: profile.id, productId: item.productId } },
        create: { resellerProfileId: profile.id, productId: item.productId, level, status: 'ACTIVE', startedAt: new Date(), approvedByUserId: await resolveTenantUserId(ctx).catch(() => null) },
        update: {},
      });
      memberships.push(m);
    }

    // اعطای ورود با همان جریان دعوت کاربر؛ نبودنِ SMS/ظرفیت، تأیید را نمی‌شکند
    let accessGranted = !!profile.userId;
    let accessError: string | null = null;
    if (!profile.userId) {
      try {
        void roleReady;
        await this.resellers.grantAccess(ctx, profile.id);
        accessGranted = true;
      } catch (err) {
        accessError = err instanceof Error ? err.message : 'اعطای دسترسی ناموفق بود';
      }
    }
    return { profile, memberships, created, accessGranted, accessError };
  }

  private async findProfileByPhone(db: Db, phone: string) {
    const key = phoneKey(phone);
    if (!key) return null;
    const rows = await db.resellerProfile.findMany({ include: { contact: { select: { phone: true } } } });
    return rows.find((r) => phoneKey(r.contact.phone) === key) ?? null;
  }

  // ── پروفایل‌ها ───────────────────────────────────────────
  async listProfiles(ctx: TenantRequestContext, f: { productId?: string; level?: string; status?: string; q?: string }) {
    assertRegistryTenant(ctx);
    await this.ensureAgentRole(ctx.tenantDb); // نقش‌های قدیمیِ «نماینده» هم پرچم محدودیت می‌گیرند (idempotent)
    const memberWhere: Record<string, unknown> = {};
    if (f.productId) memberWhere.productId = f.productId;
    if (f.level) memberWhere.level = f.level;
    if (f.status) memberWhere.status = f.status;
    const hasMemberFilter = Object.keys(memberWhere).length > 0;
    const q = f.q?.trim();
    const rows = await ctx.tenantDb.resellerProfile.findMany({
      where: {
        ...(hasMemberFilter ? { memberships: { some: memberWhere } } : {}),
        ...(q ? { OR: [{ contact: { name: { contains: q, mode: 'insensitive' } } }, { contact: { phone: { contains: q } } }, { contact: { company: { contains: q, mode: 'insensitive' } } }] } : {}),
      },
      include: {
        contact: { select: { id: true, name: true, company: true, phone: true } },
        user: { select: { id: true, status: true } },
        memberships: { include: { product: { select: { id: true, code: true, name: true } }, _count: { select: { customers: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => this.publicProfile(r));
  }

  async getProfile(ctx: TenantRequestContext, id: string) {
    assertRegistryTenant(ctx);
    const r = await ctx.tenantDb.resellerProfile.findUnique({
      where: { id },
      include: {
        contact: { select: { id: true, name: true, company: true, phone: true, address: true } },
        user: { select: { id: true, status: true } },
        memberships: {
          orderBy: { createdAt: 'asc' },
          include: { product: true, acceptances: { orderBy: { acceptedAt: 'desc' }, take: 1 }, _count: { select: { customers: true } } },
        },
      },
    });
    if (!r) throw new NotFoundException('نماینده یافت نشد');
    const enriched = [];
    for (const m of r.memberships) enriched.push(await this.membershipView(ctx.tenantDb, m, r));
    const audit = await ctx.tenantDb.agentAuditLog.findMany({ where: { resellerProfileId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { ...this.publicProfile(r), memberships: enriched, audit, pendingSheba: await this.pendingSheba(ctx.tenantDb, r.id) };
  }

  /** شبای کامل هرگز در فهرست/جزئیات برنمی‌گردد؛ فقط ماسک‌شده. */
  publicProfile<T extends { shabaNumber: string | null }>(r: T): Omit<T, 'shabaNumber'> & { shabaMasked: string | null; hasSheba: boolean } {
    const { shabaNumber, ...rest } = r;
    return { ...rest, shabaMasked: maskSheba(shabaNumber), hasSheba: !!shabaNumber };
  }

  /** نمای یک عضویت: درصدهای مؤثر، وضعیت تفاهم‌نامه، آمار فروش. */
  async membershipView(
    db: Db,
    m: { id: string; productId: string; level: string; agreementVersion: number | null; [k: string]: unknown },
    profile: { commissionFirstPaymentPercent: number; commissionRenewalPercent: number },
  ) {
    const [rules, latest, sums] = await Promise.all([
      db.agentCommissionRule.findMany({ where: { productId: m.productId } }),
      this.products.latestPublished(db, m.productId),
      db.agentTransaction.groupBy({ by: ['occurrence'], where: { membershipId: m.id }, _sum: { netAmount: true }, _count: true }),
    ]);
    const sold = sums.filter((s) => s.occurrence !== 'REFUND').reduce((a, s) => a + (s._sum.netAmount ?? 0), 0);
    const refunded = sums.filter((s) => s.occurrence === 'REFUND').reduce((a, s) => a + (s._sum.netAmount ?? 0), 0);
    return {
      ...m,
      rates: resolveRates(rules, m.level, new Date(), { first: profile.commissionFirstPaymentPercent, renewal: profile.commissionRenewalPercent }),
      agreement: {
        latestVersion: latest?.version ?? null,
        acceptedVersion: m.agreementVersion,
        status: !latest ? 'NONE' : m.agreementVersion === latest.version ? 'ACCEPTED' : m.agreementVersion ? 'REACCEPT_REQUIRED' : 'REQUIRED',
      },
      stats: { totalSales: sold - refunded },
    };
  }

  async updateProfile(ctx: TenantRequestContext, id: string, dto: UpdateAgentProfileDto) {
    assertRegistryTenant(ctx);
    const p = await ctx.tenantDb.resellerProfile.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('نماینده یافت نشد');
    if (dto.name !== undefined || dto.company !== undefined || dto.address !== undefined) {
      await ctx.tenantDb.crmContact.update({ where: { id: p.contactId }, data: { name: dto.name, company: dto.company, address: dto.address } });
    }
    await ctx.tenantDb.resellerProfile.update({
      where: { id },
      data: {
        city: dto.city,
        bio: dto.bio,
        websiteUrl: dto.websiteUrl,
        logoUrl: dto.logoUrl,
        isVerified: dto.isVerified,
        verifiedAt: dto.isVerified ? new Date() : dto.isVerified === false ? null : undefined,
      },
    });
    await this.audit(ctx.tenantDb, { resellerProfileId: id, action: 'profile.updated', detail: Object.keys(dto).join(','), ctx });
    return this.getProfile(ctx, id);
  }

  // ── عضویت‌ها ─────────────────────────────────────────────
  async addMembership(ctx: TenantRequestContext, profileId: string, dto: AddMembershipDto) {
    assertRegistryTenant(ctx);
    const [p, product] = await Promise.all([ctx.tenantDb.resellerProfile.findUnique({ where: { id: profileId } }), ctx.tenantDb.agentProduct.findUnique({ where: { id: dto.productId } })]);
    if (!p) throw new NotFoundException('نماینده یافت نشد');
    if (!product || product.isArchived || !product.isActive) throw new BadRequestException('محصول فعال یافت نشد');
    const dup = await ctx.tenantDb.agentProductMembership.findUnique({ where: { resellerProfileId_productId: { resellerProfileId: profileId, productId: dto.productId } } });
    if (dup) throw new ConflictException('این نماینده قبلاً در این محصول عضویت دارد');
    const m = await ctx.tenantDb.agentProductMembership.create({
      data: { resellerProfileId: profileId, productId: dto.productId, level: dto.level ?? 'B', status: 'ACTIVE', startedAt: new Date(), approvedByUserId: await resolveTenantUserId(ctx).catch(() => null) },
    });
    await this.audit(ctx.tenantDb, { resellerProfileId: profileId, membershipId: m.id, action: 'membership.added', detail: product.code, ctx });
    return m;
  }

  async updateMembership(ctx: TenantRequestContext, membershipId: string, dto: UpdateMembershipDto) {
    assertRegistryTenant(ctx);
    const m = await ctx.tenantDb.agentProductMembership.findUnique({ where: { id: membershipId }, include: { resellerProfile: true } });
    if (!m) throw new NotFoundException('عضویت یافت نشد');
    const data: Record<string, unknown> = {};
    const notes: string[] = [];
    if (dto.level !== undefined && dto.level !== m.level) {
      if (!(AGENT_LEVELS as readonly string[]).includes(dto.level)) throw new BadRequestException('سطح نامعتبر است');
      data.level = dto.level;
      notes.push(`سطح ${m.level}→${dto.level}`);
    }
    if (dto.status !== undefined && dto.status !== m.status) {
      if (m.status === 'ENDED' && dto.status !== 'ENDED') throw new BadRequestException('عضویتِ پایان‌یافته دوباره فعال نمی‌شود؛ عضویت تازه بسازید');
      data.status = dto.status;
      if (dto.status === 'ACTIVE' && !m.startedAt) data.startedAt = new Date();
      if (dto.status === 'ENDED') {
        data.endedAt = new Date();
        data.endReason = dto.endReason ?? 'پایان همکاری';
      }
      notes.push(`وضعیت ${m.status}→${dto.status}`);
    }
    if (dto.note !== undefined) data.note = dto.note || null;
    if (dto.referralCode !== undefined) {
      const code = normalizeReferralCode(dto.referralCode);
      if (code === '') {
        data.referralCode = null;
      } else {
        if (!REFERRAL_CODE_RE.test(code)) throw new BadRequestException('کد معرف: حروف لاتین، عدد، _ و - (۲ تا ۴۰ نویسه)');
        const clash = await ctx.tenantDb.agentProductMembership.findFirst({ where: { productId: m.productId, referralCode: code, NOT: { id: m.id } } });
        if (clash) throw new ConflictException('این کد معرف در این محصول قبلاً استفاده شده است');
        data.referralCode = code;
      }
      notes.push('کد معرف');
    }
    try {
      const updated = await ctx.tenantDb.agentProductMembership.update({ where: { id: membershipId }, data });
      if (data.level) await ctx.tenantDb.resellerProfile.update({ where: { id: m.resellerProfileId }, data: { tier: levelToTier(String(data.level)) } }).catch(() => undefined);
      await this.audit(ctx.tenantDb, { resellerProfileId: m.resellerProfileId, membershipId, action: 'membership.updated', detail: notes.join('، '), ctx });
      return updated;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('این کد معرف در این محصول قبلاً استفاده شده است');
      throw e;
    }
  }

  // ── تفاهم‌نامه: پذیرش با امضای الکترونیک (SignatureEvidence) ──
  async acceptAgreement(ctx: TenantRequestContext, req: Request, profileId: string, membershipId: string, dto: AcceptAgreementDto) {
    const m = await ctx.tenantDb.agentProductMembership.findFirst({ where: { id: membershipId, resellerProfileId: profileId } });
    if (!m) throw new NotFoundException('عضویت یافت نشد');
    if (m.status === 'ENDED') throw new ForbiddenException('عضویت پایان یافته است');
    const agreement = await ctx.tenantDb.agentAgreement.findFirst({ where: { id: dto.agreementId, productId: m.productId, status: 'PUBLISHED' } });
    if (!agreement) throw new NotFoundException('تفاهم‌نامه یافت نشد');
    const latest = await this.products.latestPublished(ctx.tenantDb, m.productId);
    if (!latest || latest.id !== agreement.id) throw new ConflictException('نسخه‌ی جدیدتری از تفاهم‌نامه منتشر شده است؛ صفحه را تازه کنید');
    const done = await ctx.tenantDb.agentAgreementAcceptance.findUnique({ where: { membershipId_agreementId: { membershipId, agreementId: agreement.id } } });
    if (done) throw new ConflictException('این نسخه را قبلاً پذیرفته‌اید');

    const contentHash = AgentProductsService.hashAgreement(agreement);
    const acceptance = await ctx.tenantDb.agentAgreementAcceptance.create({
      data: { membershipId, agreementId: agreement.id, version: agreement.version, acceptedByName: dto.signerName, contentHash },
    });
    const ev = await this.evidence.tryRecord(ctx, {
      entityType: 'agent_agreement',
      entityId: acceptance.id,
      action: 'agent_agreement_accept',
      signerName: dto.signerName,
      signerUserId: (await resolveTenantUserId(ctx).catch(() => null)) ?? undefined,
      signerRole: ctx.auth.role,
      contentHash,
      signatureData: dto.signatureDataUrl,
      req,
      clientEvidence: dto.evidence,
    });
    if (ev) await ctx.tenantDb.agentAgreementAcceptance.update({ where: { id: acceptance.id }, data: { evidenceId: ev.id } });
    await ctx.tenantDb.agentProductMembership.update({ where: { id: membershipId }, data: { agreementVersion: agreement.version, agreementAcceptedAt: new Date() } });
    await this.audit(ctx.tenantDb, { resellerProfileId: profileId, membershipId, action: 'agreement.accepted', detail: `v${agreement.version}`, ctx, actorType: 'AGENT' });
    return { version: agreement.version, acceptedAt: acceptance.acceptedAt };
  }

  // ── تغییر حساس شبا/شماره با OTP ─────────────────────────
  /**
   * شبا: کد به شماره‌ی تماس فعلیِ نماینده می‌رود؛ شماره: کد به شماره‌ی جدید می‌رود (اثبات مالکیت).
   * ادمین و خود نماینده هر دو همین مسیر را می‌روند — هیچ‌کس بدون تأیید پیامکی شبا/شماره را عوض نمی‌کند.
   */
  async requestChange(ctx: TenantRequestContext, profileId: string, kind: 'SHEBA' | 'PHONE', rawValue: string, actorType: 'ADMIN' | 'AGENT') {
    const db = ctx.tenantDb;
    const p = await db.resellerProfile.findUnique({ where: { id: profileId }, include: { contact: true } });
    if (!p) throw new NotFoundException('نماینده یافت نشد');
    let value: string;
    let sendTo: string | null;
    if (kind === 'SHEBA') {
      try {
        value = assertValidSheba(rawValue);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      if (p.shabaNumber === value) throw new BadRequestException('این شبا همان شبای فعلی است');
      sendTo = normalizeIranMobile(p.contact.phone);
      if (!sendTo) throw new BadRequestException('برای تأیید شبا ابتدا شماره‌ی موبایل معتبر نماینده را ثبت کنید');
    } else {
      const n = normalizeIranMobile(rawValue);
      if (!n) throw new BadRequestException('شماره‌ی موبایل نامعتبر است');
      value = n;
      if (phoneKey(p.contact.phone) === phoneKey(n)) throw new BadRequestException('این شماره همان شماره‌ی فعلی است');
      const other = await this.findProfileByPhone(db, n);
      if (other && other.id !== p.id) throw new ConflictException('این شماره برای نماینده‌ی دیگری ثبت شده است');
      sendTo = n;
    }
    const since = new Date(Date.now() - 24 * 3600_000);
    const recent = await db.agentProfileChange.findMany({ where: { resellerProfileId: profileId, kind, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' } });
    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < OTP_COOLDOWN_MS) throw new BadRequestException('کد به‌تازگی ارسال شده است؛ کمی صبر کنید');
    if (recent.length >= OTP_DAILY_CAP) throw new BadRequestException('تعداد درخواست تغییر امروز به سقف رسید؛ فردا دوباره تلاش کنید');

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = randomBytes(12).toString('hex');
    const row = await db.agentProfileChange.create({
      data: { resellerProfileId: profileId, kind, newValue: value, codeSalt: salt, codeHash: hashOtp(salt, code), expiresAt: new Date(Date.now() + OTP_TTL_MS), requestedByType: actorType },
    });
    let devCode: string | undefined;
    if (this.sms.isConfigured()) {
      const label = kind === 'SHEBA' ? 'تغییر شماره‌ی شبا' : 'تغییر شماره‌ی تماس';
      const res = await this.sms.sendSms(sendTo, `کد تأیید ${label} در اکسیر: ${code}`);
      if (!res.success) throw new BadRequestException('ارسال پیامک ناموفق بود؛ کمی بعد دوباره تلاش کنید');
    } else if (process.env.OTP_DEV_ECHO === 'true') {
      devCode = code; // فقط محیط توسعه‌ی بدون پنل پیامک (همان قاعده‌ی ورود)
    }
    await this.audit(db, { resellerProfileId: profileId, action: `change.${kind.toLowerCase()}.requested`, ctx, actorType });
    return { changeId: row.id, expiresInSeconds: OTP_TTL_MS / 1000, sentTo: sendTo.replace(/^(\d{4})\d{3}/, '$1•••'), ...(devCode ? { devCode } : {}) };
  }

  /** اطلاع پیامکی هر تغییر شبا به شماره‌ی ثبت‌شده‌ی نماینده (شبا ماسک‌شده). خطای پیامک تغییر را برنمی‌گرداند. */
  private async notifyShebaChanged(db: Db, contactId: string, sheba: string, actorType: 'ADMIN' | 'AGENT') {
    try {
      const c = await db.crmContact.findUnique({ where: { id: contactId }, select: { phone: true } });
      const phone = normalizeIranMobile(c?.phone);
      if (!phone || !this.sms.isConfigured()) return;
      const by = actorType === 'ADMIN' ? 'توسط مدیر' : 'از پنل شما';
      await this.sms.sendSms(phone, `شماره‌ی شبای واریز تسویه‌ی شما در اکسیر ${by} به ${maskSheba(sheba)} تغییر کرد. اگر این تغییر از طرف شما نبوده، فوراً با پشتیبانی تماس بگیرید.`);
    } catch (e) {
      this.logger.warn(`sheba change sms failed: ${(e as Error).message}`);
    }
  }

  async confirmChange(ctx: TenantRequestContext, profileId: string, changeId: string, code: string, actorType: 'ADMIN' | 'AGENT') {
    const db = ctx.tenantDb;
    const ch = await db.agentProfileChange.findFirst({ where: { id: changeId, resellerProfileId: profileId } });
    if (!ch || ch.confirmedAt) throw new NotFoundException('درخواست تغییر یافت نشد یا قبلاً تأیید شده است');
    if (ch.expiresAt.getTime() < Date.now()) throw new BadRequestException('کد منقضی شده است؛ دوباره درخواست دهید');
    if (ch.attempts >= OTP_MAX_ATTEMPTS) throw new BadRequestException('تعداد تلاش‌ها به سقف رسید؛ کد جدید بگیرید');
    if (!otpMatches(ch.codeSalt, code, ch.codeHash)) {
      await db.agentProfileChange.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('کد تأیید نادرست است');
    }
    // مصرف یک‌بارمصرف و اتمیک: فقط اولین تأییدکننده برنده است
    const claimed = await db.agentProfileChange.updateMany({ where: { id: ch.id, confirmedAt: null }, data: { confirmedAt: new Date() } });
    if (claimed.count !== 1) throw new ConflictException('این درخواست قبلاً تأیید شده است');
    const p = await db.resellerProfile.findUniqueOrThrow({ where: { id: profileId } });
    if (ch.kind === 'SHEBA' && ch.requestedByType === 'AGENT') {
      // شبای درخواستی خودِ نماینده: پس از کد پیامکی فقط «منتظر تأیید مدیر» می‌شود؛ شبای فعلی دست‌نخورده می‌ماند
      await db.agentProfileChange.updateMany({ where: { resellerProfileId: profileId, kind: 'SHEBA', approvalStatus: 'PENDING', id: { not: ch.id } }, data: { approvalStatus: 'SUPERSEDED' } });
      await db.agentProfileChange.update({ where: { id: ch.id }, data: { approvalStatus: 'PENDING' } });
      await this.audit(db, { resellerProfileId: profileId, action: 'change.sheba.awaiting_approval', detail: maskSheba(ch.newValue) ?? undefined, ctx, actorType });
      return { success: true, kind: ch.kind, pendingApproval: true };
    }
    if (ch.kind === 'SHEBA') {
      // شروع‌شده توسط مدیر (مالک/مدیر + 2FA) و تأییدشده با کد پیامکی نماینده
      await db.resellerProfile.update({ where: { id: profileId }, data: { shabaNumber: ch.newValue, shebaVerifiedAt: new Date() } });
      await db.agentProfileChange.update({ where: { id: ch.id }, data: { approvalStatus: 'APPROVED', reviewedByUserId: await resolveTenantUserId(ctx).catch(() => null), reviewedAt: new Date() } });
      await this.notifyShebaChanged(db, p.contactId, ch.newValue, actorType);
    } else {
      await db.crmContact.update({ where: { id: p.contactId }, data: { phone: ch.newValue } });
      await db.resellerProfile.update({ where: { id: profileId }, data: { phoneVerifiedAt: new Date() } });
    }
    await this.audit(db, { resellerProfileId: profileId, action: `change.${ch.kind.toLowerCase()}.confirmed`, ctx, actorType });
    return { success: true, kind: ch.kind };
  }

  // ── تأیید مدیر برای شبای درخواستی نماینده ─────────────────
  async pendingSheba(db: Db, profileId: string) {
    const r = await db.agentProfileChange.findFirst({ where: { resellerProfileId: profileId, kind: 'SHEBA', approvalStatus: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    return r ? { id: r.id, shabaMasked: maskSheba(r.newValue), requestedAt: r.confirmedAt ?? r.createdAt } : null;
  }

  /** صف تأیید تغییر شبا (فقط ادمین؛ شبای کامل قدیم و جدید برای مقایسه). */
  async listShebaChanges(ctx: TenantRequestContext, status = 'PENDING') {
    assertRegistryTenant(ctx);
    const st = ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED'].includes(status) ? status : 'PENDING';
    const rows = await ctx.tenantDb.agentProfileChange.findMany({
      where: { kind: 'SHEBA', approvalStatus: st },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { resellerProfile: { select: { id: true, shabaNumber: true, shebaVerifiedAt: true, contact: { select: { name: true, phone: true } } } } },
    });
    return rows.map((r) => ({
      id: r.id,
      resellerProfileId: r.resellerProfileId,
      agentName: r.resellerProfile.contact.name,
      agentPhone: r.resellerProfile.contact.phone,
      currentSheba: r.resellerProfile.shabaNumber,
      newSheba: r.newValue,
      status: r.approvalStatus,
      requestedAt: r.confirmedAt ?? r.createdAt,
      reviewedAt: r.reviewedAt,
      rejectReason: r.rejectReason,
    }));
  }

  async approveShebaChange(ctx: TenantRequestContext, changeId: string) {
    assertRegistryTenant(ctx);
    const by = await resolveTenantUserId(ctx).catch(() => null);
    const db = ctx.tenantDb;
    const ch = await db.$transaction(async (tx) => {
      const c = await tx.agentProfileChange.findUnique({ where: { id: changeId } });
      if (!c || c.kind !== 'SHEBA') throw new NotFoundException('درخواست تغییر شبا یافت نشد');
      const claimed = await tx.agentProfileChange.updateMany({ where: { id: c.id, approvalStatus: 'PENDING', confirmedAt: { not: null } }, data: { approvalStatus: 'APPROVED', reviewedByUserId: by, reviewedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException('این درخواست دیگر در انتظار تأیید نیست');
      await tx.resellerProfile.update({ where: { id: c.resellerProfileId }, data: { shabaNumber: c.newValue, shebaVerifiedAt: new Date() } });
      return c;
    });
    await this.audit(db, { resellerProfileId: ch.resellerProfileId, action: 'change.sheba.approved', detail: maskSheba(ch.newValue) ?? undefined, ctx });
    const p = await db.resellerProfile.findUniqueOrThrow({ where: { id: ch.resellerProfileId } });
    await this.notifyShebaChanged(db, p.contactId, ch.newValue, 'AGENT');
    return { success: true };
  }

  async rejectShebaChange(ctx: TenantRequestContext, changeId: string, reason: string) {
    assertRegistryTenant(ctx);
    const by = await resolveTenantUserId(ctx).catch(() => null);
    const db = ctx.tenantDb;
    const r = reason?.trim().slice(0, 500);
    if (!r) throw new BadRequestException('دلیل رد الزامی است');
    const c = await db.agentProfileChange.findUnique({ where: { id: changeId } });
    if (!c || c.kind !== 'SHEBA') throw new NotFoundException('درخواست تغییر شبا یافت نشد');
    const claimed = await db.agentProfileChange.updateMany({ where: { id: c.id, approvalStatus: 'PENDING' }, data: { approvalStatus: 'REJECTED', reviewedByUserId: by, reviewedAt: new Date(), rejectReason: r } });
    if (claimed.count !== 1) throw new ConflictException('این درخواست دیگر در انتظار تأیید نیست');
    await this.audit(db, { resellerProfileId: c.resellerProfileId, action: 'change.sheba.rejected', detail: r, ctx });
    try {
      const p = await db.resellerProfile.findUniqueOrThrow({ where: { id: c.resellerProfileId }, include: { contact: { select: { phone: true } } } });
      const phone = normalizeIranMobile(p.contact.phone);
      if (phone && this.sms.isConfigured()) await this.sms.sendSms(phone, `درخواست تغییر شبای شما در اکسیر تأیید نشد. دلیل: ${r}`);
    } catch (e) {
      this.logger.warn(`sheba reject sms failed: ${(e as Error).message}`);
    }
    return { success: true };
  }
}
