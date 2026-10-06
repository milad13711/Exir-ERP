import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { normalizeSearchTerm, searchTermAsInt } from '../common/search.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { MoodianTransportError } from './client/http-moodian.client.js';
import type { MoodianInquiryItem, SendPermit } from './client/moodian-client.js';
import { SendRefusedError, hashNormalized } from './client/send-guard.js';
import type { TaxInvoiceStatus } from './client/types.js';
import { MOODIAN_MAPPING_VERSION, INVOICE_PATTERN, INQUIRY_STATUS } from './mapping/moodian-field-map.js';
import { mapMoodianError, type MappedTaxError } from './mapping/moodian-errors.js';
import { mapSalesInvoiceToMoodian, type MapResult, type ProductMapping, type TaxIssue, type TaxOverrides } from './mapping/invoice-mapper.js';
import { assertTransition } from './state-machine.js';
import { TaxAuditService } from './tax-audit.service.js';
import { TaxSettingsService } from './tax-settings.service.js';
import { checkManualTaxId } from './taxid/taxid.js';
import type { ChainTaxInvoiceDto, UpdateTaxInvoiceDto } from './dto/tax.dto.js';

type Scope = Record<string, unknown>;

export const TAX_APPROVAL_ENTITY = 'TAX_INVOICE';
const MODULE_CODE = 'tax';
/** فاصله‌ی تلاش دوباره پس از خطای گذرا: ۲، ۸، ۳۲ دقیقه... تا سقف ۳ بار خودکار. */
export const MAX_AUTO_RETRIES = 3;
export const retryDelayMs = (n: number): number => Math.min(2 * 4 ** n, 120) * 60_000;

const LIST_INCLUDE = { salesInvoice: { select: { id: true, invoiceNo: true, officialInvoiceNo: true, total: true, issuedAt: true, contact: { select: { id: true, name: true, company: true } } } } };

export type TaxPreview = { payload: MapResult['payload']; issues: TaxIssue[]; blocking: boolean; mappingVersion: string; frozen: boolean };

@Injectable()
export class TaxInvoicesService implements OnModuleInit {
  private readonly logger = new Logger('TaxInvoicesService');

  constructor(
    private readonly approvals: ApprovalsService,
    private readonly settings: TaxSettingsService,
    private readonly audit: TaxAuditService,
    private readonly notifications: NotificationsService,
    private readonly automation: AutomationEngineService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler(TAX_APPROVAL_ENTITY, {
      approve: (ctx, id, opts) => this.approveConfirmed(ctx, id, opts.note),
      reject: (ctx, id, opts) => this.rejectApproval(ctx, id, opts.note),
      describe: async (ctx, id) => {
        const t = await ctx.tenantDb.taxInvoice.findUniqueOrThrow({ where: { id }, include: LIST_INCLUDE });
        const preview = await this.buildPreview(ctx, t as never);
        const h = preview.payload.header;
        return {
          fields: [
            { label: 'فاکتور فروش', value: String(t.salesInvoice.invoiceNo) },
            { label: 'مشتری', value: t.salesInvoice.contact.name },
            { label: 'موضوع', value: t.subject },
            { label: 'شماره مالیاتی (taxid)', value: String(h.taxid ?? '—') },
            { label: 'مبلغ کل (ریال)', value: Number(h.tbill ?? 0).toLocaleString('en-US') },
            { label: 'مالیات بر ارزش افزوده (ریال)', value: Number(h.tvam ?? 0).toLocaleString('en-US') },
            { label: 'ایرادات', value: preview.issues.length ? preview.issues.map((i) => `${i.severity === 'BLOCKING' ? '⛔' : '⚠️'} ${i.message}`).join('\n') : 'ندارد' },
            { label: 'هشدار', value: 'با تأیید، این صورتحساب منجمد می‌شود و برای ارسال به سامانه مودیان آماده می‌گردد' },
          ],
        };
      },
    });
  }

  // ── دسترسی و یافتن ────────────────────────────────────────────────────

  /** همه‌ی مسیرهای by-id از اینجا رد می‌شوند: خارج از دامنه = ۴۰۴. */
  async getScoped(ctx: TenantRequestContext, id: string, scope: Scope) {
    const row = await ctx.tenantDb.taxInvoice.findFirst({ where: { AND: [{ id }, scope] }, include: LIST_INCLUDE });
    if (!row) throw new NotFoundException('صورتحساب مالیاتی یافت نشد');
    return row;
  }

  private isManager(ctx: TenantRequestContext): boolean {
    return ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
  }

  /**
   * تأیید فقط توسط «مدیر واقعی» (OWNER/ADMIN عضو تننت). ApprovalsService برای تأییدکننده‌ی تعیین‌شده نقش ctx را ADMIN می‌کند؛
   * پس اینجا نقش واقعی از عضویت کنترل‌پلین دوباره خوانده می‌شود.
   */
  async assertRealManager(ctx: TenantRequestContext): Promise<void> {
    if (ctx.auth.type === 'api_key') {
      if (!this.isManager(ctx)) throw new ForbiddenException('فقط مدیر می‌تواند صورتحساب مالیاتی را تأیید کند');
      return;
    }
    const m = await this.controlDb.tenantMembership.findFirst({
      where: { tenantId: ctx.tenantId, globalUserId: ctx.auth.sub, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
      select: { id: true },
    });
    if (!m) throw new ForbiddenException('فقط مالک یا مدیر می‌تواند صورتحساب مالیاتی را تأیید کند');
  }

  // ── نگاشت ─────────────────────────────────────────────────────────────

  async buildPreview(ctx: TenantRequestContext, t: { id: string; salesInvoiceId: string; status: string; subject: string; pattern: number; taxid: string | null; irtaxid: string | null; createdAt: Date; overrides: unknown; payloadSnapshot?: unknown }): Promise<TaxPreview> {
    const frozen = t.payloadSnapshot !== null && t.payloadSnapshot !== undefined && !['DRAFT'].includes(t.status);
    const mapped = await this.runMapper(ctx, t);
    if (frozen) {
      return { payload: t.payloadSnapshot as MapResult['payload'], issues: mapped.issues, blocking: false, mappingVersion: MOODIAN_MAPPING_VERSION, frozen: true };
    }
    return { payload: mapped.payload, issues: mapped.issues, blocking: mapped.blocking, mappingVersion: MOODIAN_MAPPING_VERSION, frozen: false };
  }

  private async runMapper(ctx: TenantRequestContext, t: { salesInvoiceId: string; subject: string; pattern: number; taxid: string | null; irtaxid: string | null; createdAt: Date; overrides: unknown }): Promise<MapResult> {
    const inv = await ctx.tenantDb.salesInvoice.findUnique({
      where: { id: t.salesInvoiceId },
      include: { lines: true, contact: true },
    });
    if (!inv) throw new NotFoundException('فاکتور فروش یافت نشد');
    const productIds = inv.lines.map((l) => l.productId).filter((x): x is string => !!x);
    const codes = productIds.length ? await ctx.tenantDb.taxProductCode.findMany({ where: { productId: { in: productIds } } }) : [];
    const mappings = new Map<string, ProductMapping>(codes.map((c) => [c.productId, { sstid: c.sstid, unitCode: c.unitCode, vatRate: c.vatRate }]));
    const s = await this.settings.getRow(ctx);
    return mapSalesInvoiceToMoodian({
      settings: { economicCode: s.economicCode, fiscalId: s.fiscalId, branchCode: s.branchCode, defaultVatRate: s.defaultVatRate, defaultSstid: s.defaultSstid, defaultUnitCode: s.defaultUnitCode },
      invoice: {
        invoiceNo: inv.invoiceNo, officialInvoiceNo: inv.officialInvoiceNo, isOfficial: inv.isOfficial, status: inv.status, issuedAt: inv.issuedAt, subtotal: inv.subtotal,
        discount: inv.discount, taxRate: inv.taxRate, taxAmount: inv.taxAmount, total: inv.total, paidAmount: inv.paidAmount, signedAt: inv.signedAt,
        lines: inv.lines.map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
        contact: { type: inv.contact.type, name: inv.contact.name, economicCode: inv.contact.economicCode, nationalId: inv.contact.nationalId, legalId: inv.contact.legalId },
      },
      taxInvoice: { subject: t.subject as never, pattern: t.pattern, taxid: t.taxid, irtaxid: t.irtaxid, createdAt: t.createdAt, overrides: (t.overrides ?? null) as TaxOverrides | null },
      mappings,
    });
  }

  /** نواقص مربوط به آماده‌بودن ارسال (کلید/تنظیمات) — برای نمایش؛ مانع تأیید نیست ولی ارسال را متوقف می‌کند. */
  private async readinessIssues(ctx: TenantRequestContext): Promise<TaxIssue[]> {
    const s = await this.settings.getRow(ctx);
    const out: TaxIssue[] = [];
    if (!s.privateKeyEnc) out.push({ code: 'NO_PRIVATE_KEY', severity: 'WARNING', message: 'کلید خصوصی مودی بارگذاری نشده است (تا آن زمان ارسال ممکن نیست)' });
    if (!s.serverPublicKeyPem) out.push({ code: 'NO_SERVER_KEY', severity: 'WARNING', message: 'کلید عمومی سازمان هنوز دریافت نشده است' });
    if (!s.sendingEnabled) out.push({ code: 'SENDING_DISABLED', severity: 'WARNING', message: 'ارسال واقعی غیرفعال است' });
    return out;
  }

  // ── فهرست و جزئیات ────────────────────────────────────────────────────

  async list(ctx: TenantRequestContext, scope: Scope, f: { q?: string; status?: string }) {
    const term = normalizeSearchTerm(f.q);
    const no = term ? searchTermAsInt(term) : undefined;
    const and: Scope[] = [scope];
    if (term) {
      and.push({
        OR: [
          ...(no !== undefined ? [{ salesInvoice: { invoiceNo: no } }, { salesInvoice: { officialInvoiceNo: no } }] : []),
          { taxid: { contains: term, mode: 'insensitive' } },
          { referenceNumber: { contains: term, mode: 'insensitive' } },
          { salesInvoice: { contact: { name: { contains: term, mode: 'insensitive' } } } },
        ],
      });
    }
    if (f.status) and.push({ status: f.status });
    return ctx.tenantDb.taxInvoice.findMany({
      where: { AND: and },
      omit: { payloadSnapshot: true },
      include: LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async detail(ctx: TenantRequestContext, id: string, scope: Scope) {
    const t = await this.getScoped(ctx, id, scope);
    const preview = await this.buildPreview(ctx, t as never);
    const logs = await ctx.tenantDb.taxSubmissionLog.findMany({ where: { taxInvoiceId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const approval = await ctx.tenantDb.approvalRequest.findFirst({ where: { entityType: TAX_APPROVAL_ENTITY, entityId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, decisionNote: true, decidedAt: true } });
    const chain = await ctx.tenantDb.taxInvoice.findMany({ where: { refTaxInvoiceId: id }, select: { id: true, subject: true, status: true, taxid: true }, orderBy: { createdAt: 'asc' } });
    const { payloadSnapshot: _p, ...rest } = t as typeof t & { payloadSnapshot?: unknown };
    void _p;
    return { ...rest, preview, issues: [...preview.issues, ...(await this.readinessIssues(ctx))], logs, approval, chain };
  }

  // ── ساخت و ویرایش ─────────────────────────────────────────────────────

  async createFromSalesInvoice(ctx: TenantRequestContext, salesInvoiceId: string, salesScope: Scope) {
    const inv = await ctx.tenantDb.salesInvoice.findFirst({ where: { AND: [{ id: salesInvoiceId }, salesScope] }, select: { id: true, status: true, isOfficial: true } });
    if (!inv) throw new NotFoundException('فاکتور فروش یافت نشد');
    const existing = await ctx.tenantDb.taxInvoice.findFirst({ where: { salesInvoiceId, subject: 'ORIGINAL', status: { not: 'CANCELLED' } }, select: { id: true, status: true } });
    if (existing) throw new ConflictException('برای این فاکتور قبلاً صورتحساب مالیاتی ساخته شده است');
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const created = await ctx.tenantDb.taxInvoice.create({
      data: { salesInvoiceId, subject: 'ORIGINAL', pattern: INVOICE_PATTERN.SALE, createdByUserId: userId ?? undefined, mappingVersion: MOODIAN_MAPPING_VERSION },
    });
    await this.audit.activity(ctx, 'tax.invoice.created', created.id, { salesInvoiceId });
    return this.refresh(ctx, created.id, {});
  }

  /** محاسبه‌ی دوباره‌ی پیش‌نمایش و ذخیره‌ی تصمیم‌های نگاشت (نوع/الگو/سریال). فقط DRAFT. */
  async refresh(ctx: TenantRequestContext, id: string, scope: Scope) {
    const t = await this.getScoped(ctx, id, scope);
    if (t.status !== 'DRAFT') throw new BadRequestException('فقط پیش‌نویس قابل بازمحاسبه است');
    const mapped = await this.runMapper(ctx, t);
    await ctx.tenantDb.taxInvoice.update({ where: { id }, data: { invoiceType: mapped.resolved.invoiceType, inno: mapped.resolved.inno, mappingVersion: MOODIAN_MAPPING_VERSION } });
    return this.detail(ctx, id, scope);
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateTaxInvoiceDto, scope: Scope) {
    const t = await this.getScoped(ctx, id, scope);
    if (t.status !== 'DRAFT') throw new BadRequestException('فقط پیش‌نویس قابل ویرایش است');
    const settings = await this.settings.getRow(ctx);
    const data: Record<string, unknown> = {};
    if (dto.taxid !== undefined) {
      if (dto.taxid === '') {
        data.taxid = null;
        data.inno = null;
      } else {
        const chk = checkManualTaxId(dto.taxid, settings.fiscalId);
        if (!chk.ok) throw new BadRequestException(chk.reason);
        const dup = await ctx.tenantDb.taxInvoice.findFirst({ where: { taxid: chk.taxid, id: { not: id }, status: { not: 'CANCELLED' } }, select: { id: true } });
        if (dup) throw new ConflictException('این شماره مالیاتی برای صورتحساب دیگری ثبت شده است');
        data.taxid = chk.taxid;
        data.inno = chk.inno;
      }
    }
    if (dto.overrides !== undefined) data.overrides = { ...((t.overrides as object | null) ?? {}), ...dto.overrides };
    if (Object.keys(data).length) await ctx.tenantDb.taxInvoice.update({ where: { id }, data });
    await this.audit.activity(ctx, 'tax.invoice.updated', id, { fields: Object.keys(data) });
    return this.refresh(ctx, id, scope);
  }

  // ── درخواست تأیید و تصمیم مدیر ────────────────────────────────────────

  async requestApproval(ctx: TenantRequestContext, id: string, scope: Scope) {
    const t = await this.getScoped(ctx, id, scope);
    assertTransition(t.status as TaxInvoiceStatus, 'PENDING_APPROVAL');
    const mapped = await this.runMapper(ctx, t);
    if (mapped.blocking) throw new BadRequestException({ message: 'ابتدا ایرادات مسدودکننده را برطرف کنید', issues: mapped.issues.filter((i) => i.severity === 'BLOCKING') });
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    // CAS: دو درخواست هم‌زمان فقط یک‌بار موفق می‌شود
    const res = await ctx.tenantDb.taxInvoice.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'PENDING_APPROVAL', requestedByUserId: userId ?? undefined, invoiceType: mapped.resolved.invoiceType, inno: mapped.resolved.inno, errors: Prisma.DbNull },
    });
    if (res.count !== 1) throw new ConflictException('وضعیت صورتحساب هم‌زمان تغییر کرد');
    await this.approvals.request(ctx, {
      moduleCode: MODULE_CODE,
      entityType: TAX_APPROVAL_ENTITY,
      entityId: id,
      title: `ارسال صورتحساب مالیاتی فاکتور ${t.salesInvoice.invoiceNo} به سامانه مودیان`,
      summary: `مشتری: ${t.salesInvoice.contact.name} — مبلغ: ${t.salesInvoice.total.toLocaleString('en-US')} تومان`,
      link: `/tax?open=${id}`,
      requestedByUserId: userId ?? undefined,
    });
    await this.audit.activity(ctx, 'tax.invoice.approval_requested', id);
    return this.detail(ctx, id, scope);
  }

  /** مدیر مستقیم از صفحه‌ی مالیات تأیید/رد می‌کند؛ همان مسیر کارتابل (ApprovalsService.decide). */
  async decide(ctx: TenantRequestContext, id: string, approved: boolean, note: string | undefined, scope: Scope) {
    await this.getScoped(ctx, id, scope);
    await this.assertRealManager(ctx);
    const req = await ctx.tenantDb.approvalRequest.findFirst({ where: { entityType: TAX_APPROVAL_ENTITY, entityId: id, status: 'PENDING' } });
    if (!req) throw new BadRequestException('درخواست تأیید فعالی برای این صورتحساب وجود ندارد');
    await this.approvals.decide(ctx, req.id, approved, { note });
    return this.detail(ctx, id, scope);
  }

  /** پردازشگر تأیید (از کارتابل یا decide). محتوا را منجمد می‌کند. */
  async approveConfirmed(ctx: TenantRequestContext, id: string, note?: string): Promise<void> {
    await this.assertRealManager(ctx);
    const t = await ctx.tenantDb.taxInvoice.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('صورتحساب مالیاتی یافت نشد');
    assertTransition(t.status as TaxInvoiceStatus, 'APPROVED');
    const mapped = await this.runMapper(ctx, t);
    if (mapped.blocking) {
      throw new BadRequestException(`تأیید ممکن نیست: ${mapped.issues.filter((i) => i.severity === 'BLOCKING').map((i) => i.message).join('؛ ')}`);
    }
    const approverId = await resolveTenantUserId(ctx).catch(() => null);
    const res = await ctx.tenantDb.taxInvoice.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: {
        status: 'APPROVED',
        payloadSnapshot: mapped.payload as unknown as object,
        normalizedHash: hashNormalized(mapped.payload),
        mappingVersion: MOODIAN_MAPPING_VERSION,
        invoiceType: mapped.resolved.invoiceType,
        inno: mapped.resolved.inno,
        approvedByUserId: approverId ?? ctx.auth.sub,
        approvedAt: new Date(),
        errors: Prisma.DbNull,
        nextAttemptAt: new Date(),
      },
    });
    if (res.count !== 1) throw new ConflictException('وضعیت صورتحساب هم‌زمان تغییر کرد');
    await this.audit.activity(ctx, 'tax.invoice.approved', id, { note: note ?? null, hash: hashNormalized(mapped.payload) });
    await this.audit.submission(ctx, id, { kind: 'WORKFLOW', ok: true, summary: { event: 'approved' } });
    if (t.requestedByUserId) {
      await this.notifications.notify(ctx.tenantDb, { userId: t.requestedByUserId, type: 'TAX_APPROVED', title: 'صورتحساب مالیاتی تأیید شد و در صف ارسال است', link: `/tax?open=${id}` }).catch(() => undefined);
    }
  }

  async rejectApproval(ctx: TenantRequestContext, id: string, note?: string): Promise<void> {
    await this.assertRealManager(ctx);
    const t = await ctx.tenantDb.taxInvoice.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('صورتحساب مالیاتی یافت نشد');
    assertTransition(t.status as TaxInvoiceStatus, 'DRAFT');
    await ctx.tenantDb.taxInvoice.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: 'DRAFT', errors: note ? [{ fa: `رد مدیر: ${note}` }] : undefined } });
    await this.audit.activity(ctx, 'tax.invoice.approval_rejected', id, { note: note ?? null });
    if (t.requestedByUserId) {
      await this.notifications.notify(ctx.tenantDb, { userId: t.requestedByUserId, type: 'TAX_APPROVAL_REJECTED', title: 'درخواست ارسال صورتحساب مالیاتی رد شد', body: note, link: `/tax?open=${id}` }).catch(() => undefined);
    }
  }

  // ── انصراف / ارسال مجدد / ابطال و اصلاح ───────────────────────────────

  async discard(ctx: TenantRequestContext, id: string, scope: Scope) {
    const t = await this.getScoped(ctx, id, scope);
    assertTransition(t.status as TaxInvoiceStatus, 'CANCELLED');
    await ctx.tenantDb.taxInvoice.updateMany({ where: { id, status: t.status }, data: { status: 'CANCELLED' } });
    await this.approvals.closeForEntity(ctx, TAX_APPROVAL_ENTITY, id, 'REJECTED').catch(() => undefined);
    await this.audit.activity(ctx, 'tax.invoice.discarded', id);
    return this.detail(ctx, id, scope);
  }

  /**
   * ارسال مجدد ایمن:
   *  - FAILED (خطای فنی/انتقال؛ محتوای تأییدشده دست‌نخورده) → دوباره در صف، همان uid و retry=true
   *  - REJECTED (سامانه محتوا را رد کرد) → به پیش‌نویس برمی‌گردد؛ پس از اصلاح باید دوباره تأیید مدیر بگیرد
   */
  async resend(ctx: TenantRequestContext, id: string, scope: Scope) {
    const t = await this.getScoped(ctx, id, scope);
    if (t.status === 'REJECTED') {
      assertTransition('REJECTED', 'DRAFT');
      await ctx.tenantDb.taxInvoice.updateMany({
        where: { id, status: 'REJECTED' },
        data: { status: 'DRAFT', payloadSnapshot: Prisma.DbNull, normalizedHash: null, approvedAt: null, approvedByUserId: null, retryFlag: true },
      });
      await this.audit.activity(ctx, 'tax.invoice.reopened', id);
      return this.detail(ctx, id, scope);
    }
    if (t.status === 'FAILED') {
      if (!t.approvedAt || !t.payloadSnapshot) throw new BadRequestException('این صورتحساب تأیید نشده است');
      assertTransition('FAILED', 'QUEUED');
      await ctx.tenantDb.taxInvoice.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'APPROVED', retryFlag: true, nextAttemptAt: new Date() } });
      await this.audit.activity(ctx, 'tax.invoice.resend_queued', id);
      return this.detail(ctx, id, scope);
    }
    throw new BadRequestException('فقط صورتحساب ناموفق یا ردشده قابل ارسال مجدد است');
  }

  /** ابطالی/اصلاحی: TaxInvoice تازه با irtaxid = شماره‌ی مالیاتی صورتحساب پذیرفته‌شده‌ی مرجع. */
  async createChain(ctx: TenantRequestContext, id: string, dto: ChainTaxInvoiceDto, scope: Scope) {
    const orig = await this.getScoped(ctx, id, scope);
    if (orig.status !== 'ACCEPTED' || !orig.taxid) throw new BadRequestException('فقط برای صورتحساب پذیرفته‌شده می‌توان ابطالی یا اصلاحی صادر کرد');
    if (orig.subject === 'CANCELLATION') throw new BadRequestException('صورتحساب ابطالی خودش قابل ابطال/اصلاح نیست');
    const active = await ctx.tenantDb.taxInvoice.findFirst({
      where: { refTaxInvoiceId: id, status: { notIn: ['CANCELLED', 'REJECTED', 'FAILED'] } },
      select: { id: true, subject: true, status: true },
    });
    if (active) throw new ConflictException('برای این صورتحساب قبلاً ابطالی/اصلاحی در جریان یا پذیرفته‌شده است');
    const settings = await this.settings.getRow(ctx);
    let taxid: string | undefined;
    let inno: string | undefined;
    if (dto.taxid) {
      const chk = checkManualTaxId(dto.taxid, settings.fiscalId);
      if (!chk.ok) throw new BadRequestException(chk.reason);
      taxid = chk.taxid;
      inno = chk.inno;
    }
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const created = await ctx.tenantDb.taxInvoice.create({
      data: {
        salesInvoiceId: orig.salesInvoiceId,
        refTaxInvoiceId: orig.id,
        subject: dto.kind,
        pattern: orig.pattern,
        irtaxid: orig.taxid,
        taxid,
        inno,
        overrides: (orig.overrides ?? undefined) as object | undefined,
        createdByUserId: userId ?? undefined,
        mappingVersion: MOODIAN_MAPPING_VERSION,
      },
    });
    await this.audit.activity(ctx, 'tax.invoice.chain_created', created.id, { kind: dto.kind, ref: orig.id });
    return this.refresh(ctx, created.id, {});
  }

  // ── ارسال ─────────────────────────────────────────────────────────────

  /** «ارسال همین حالا» برای صورتحساب تأییدشده. گارد سخت ارسال هم در اینجا هم در کلاینت اعمال می‌شود. */
  async sendNow(ctx: TenantRequestContext, id: string, scope: Scope) {
    await this.getScoped(ctx, id, scope);
    const out = await this.dispatch(ctx, id);
    const detail = await this.detail(ctx, id, scope);
    return { ...detail, dispatch: out };
  }

  async dispatch(ctx: TenantRequestContext, id: string): Promise<{ sent: boolean; reason?: string }> {
    // پیش‌گارد: شرایط سراسری ارسال برقرار نیست → هیچ تغییر وضعیتی و هیچ تلاشی (خطا هم محسوب نمی‌شود)
    const pre = await this.settings.getRow(ctx);
    if (!pre.sendingEnabled) return { sent: false, reason: 'SENDING_DISABLED' };
    if (pre.environment === 'PRODUCTION' && !pre.verifiedAgainstSandboxAt) return { sent: false, reason: 'PRODUCTION_NOT_VERIFIED' };

    // CAS: APPROVED → QUEUED؛ تنها یک اجراکننده (کران یا دستی) برنده می‌شود
    const cas = await ctx.tenantDb.taxInvoice.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'QUEUED' } });
    if (cas.count !== 1) return { sent: false, reason: 'NOT_APPROVED_OR_BUSY' };
    const t = await ctx.tenantDb.taxInvoice.findUniqueOrThrow({ where: { id } });
    const revert = async () => {
      await ctx.tenantDb.taxInvoice.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'APPROVED' } });
    };

    let built;
    try {
      built = await this.settings.buildClient(ctx, id, pre);
    } catch (e) {
      // پیکربندی ناقص (کلید/آدرس) — خطای ارسال نیست؛ بسته‌ای نرفته
      await revert();
      await this.audit.submission(ctx, id, { kind: 'SEND_REFUSED', ok: false, errorCode: 'NOT_CONFIGURED', summary: { message: e instanceof Error ? e.message : 'config error' } });
      return { sent: false, reason: 'NOT_CONFIGURED' };
    }

    const permit: SendPermit = {
      taxInvoiceId: t.id, status: 'QUEUED', approvedAt: t.approvedAt, approvedByUserId: t.approvedByUserId, uid: t.uid, retry: t.retryFlag || t.retryCount > 0,
      invoice: t.payloadSnapshot, expectedHash: t.normalizedHash,
    };
    let result;
    try {
      result = await built.client.sendInvoice(permit);
      await ctx.tenantDb.taxInvoice.update({ where: { id }, data: { environment: built.row.environment } });
    } catch (e) {
      if (e instanceof SendRefusedError) {
        // هیچ بسته‌ای نرفته → برگشت به APPROVED
        await revert();
        await this.audit.submission(ctx, id, { kind: 'SEND_REFUSED', ok: false, errorCode: e.reason, summary: { reason: e.reason } });
        return { sent: false, reason: e.reason };
      }
      const transient = e instanceof MoodianTransportError ? e.transient : false;
      await this.markFailed(ctx, id, t.retryCount, [{ code: null, detail: null, fa: e instanceof Error ? e.message : 'خطای ناشناخته در ارسال', transient }]);
      return { sent: false, reason: 'FAILED' };
    }

    if (result.errorCode) {
      // ۵۰۰۵: این uid قبلاً دریافت شده → فقط پیگیری با استعلام
      if (result.errorCode === '5005') {
        await ctx.tenantDb.taxInvoice.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'SENT', sentAt: new Date(), errors: Prisma.DbNull } });
        return { sent: true };
      }
      await this.markFailed(ctx, id, t.retryCount, [mapMoodianError(result.errorCode, result.errorDetail)]);
      return { sent: false, reason: 'FAILED' };
    }
    assertTransition('QUEUED', 'SENT');
    await ctx.tenantDb.taxInvoice.updateMany({
      where: { id, status: 'QUEUED' },
      data: { status: 'SENT', referenceNumber: result.referenceNumber, sentAt: new Date(), errors: Prisma.DbNull, nextAttemptAt: null },
    });
    await this.audit.activity(ctx, 'tax.invoice.sent', id, { referenceNumber: result.referenceNumber });
    return { sent: true };
  }

  private async markFailed(ctx: TenantRequestContext, id: string, retryCount: number, errors: MappedTaxError[]): Promise<void> {
    const transient = errors.every((e) => e.transient);
    const next = retryCount + 1;
    await ctx.tenantDb.taxInvoice.updateMany({
      where: { id, status: { in: ['QUEUED', 'SENT'] } },
      data: {
        status: 'FAILED',
        errors: errors as unknown as object,
        retryCount: next,
        retryFlag: true,
        nextAttemptAt: transient && next <= MAX_AUTO_RETRIES ? new Date(Date.now() + retryDelayMs(next)) : null,
      },
    });
    await this.audit.activity(ctx, 'tax.invoice.failed', id, { errors: errors.map((e) => ({ code: e.code, fa: e.fa })), retryCount: next });
  }

  // ── استعلام ───────────────────────────────────────────────────────────

  /** نتیجه‌ی خام تاکس را به فهرست خطاهای فارسی تبدیل می‌کند. */
  static parseTaxResult(item: MoodianInquiryItem): MappedTaxError[] {
    const r = item.data?.taxResult;
    const list: MappedTaxError[] = [];
    const pushOne = (code: unknown, detail: unknown) => list.push(mapMoodianError(code as string | null, typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : null));
    if (Array.isArray(r)) {
      for (const e of r) {
        if (typeof e === 'string') pushOne(null, e);
        else if (e && typeof e === 'object') pushOne((e as any).code ?? (e as any).errorCode ?? null, (e as any).message ?? (e as any).errorDetail ?? (e as any).detail ?? null);
      }
    } else if (typeof r === 'string' && r !== 'SUCCESS') pushOne(null, r);
    else if (r && typeof r === 'object') pushOne((r as any).code ?? (r as any).errorCode ?? null, (r as any).message ?? (r as any).errorDetail ?? null);
    if (list.length === 0) list.push({ code: null, detail: null, fa: 'سامانه مودیان صورتحساب را رد کرد (جزئیات خطا ارسال نشده)', transient: false });
    return list;
  }

  async inquire(ctx: TenantRequestContext, id: string, scope: Scope) {
    await this.getScoped(ctx, id, scope);
    const out = await this.pollOne(ctx, id);
    return { ...(await this.detail(ctx, id, scope)), inquiry: out };
  }

  async pollOne(ctx: TenantRequestContext, id: string): Promise<{ status: string }> {
    const t = await ctx.tenantDb.taxInvoice.findUnique({ where: { id }, include: LIST_INCLUDE });
    if (!t) throw new NotFoundException('صورتحساب مالیاتی یافت نشد');
    if (t.status !== 'SENT') throw new BadRequestException('فقط صورتحساب ارسال‌شده قابل استعلام است');
    const { client, row } = await this.settings.buildClient(ctx, id);
    let items: MoodianInquiryItem[];
    try {
      items = await client.inquiryByUid([t.uid]);
    } catch (e) {
      await ctx.tenantDb.taxInvoice.update({ where: { id }, data: { lastInquiryAt: new Date() } });
      await this.audit.submission(ctx, id, { kind: 'INQUIRY_ERROR', ok: false, summary: { message: e instanceof Error ? e.message : 'error' } });
      return { status: 'ERROR' };
    }
    const item = items.find((i) => i.uid === t.uid) ?? items[0];
    await ctx.tenantDb.taxInvoice.update({ where: { id }, data: { lastInquiryAt: new Date(), referenceNumber: t.referenceNumber ?? item?.referenceNumber ?? undefined } });
    if (!item) return { status: 'NOT_FOUND' };
    const status = String(item.status).toUpperCase();
    if (status === INQUIRY_STATUS.SUCCESS) {
      assertTransition('SENT', 'ACCEPTED');
      await ctx.tenantDb.taxInvoice.updateMany({ where: { id, status: 'SENT' }, data: { status: 'ACCEPTED', resultAt: new Date(), errors: Prisma.DbNull } });
      if (row.environment === 'SANDBOX') await this.settings.markSandboxVerified(ctx);
      await this.audit.activity(ctx, 'tax.invoice.accepted', id);
      await this.notifyResult(ctx, t, true, []);
    } else if (status === INQUIRY_STATUS.FAILED) {
      const errors = TaxInvoicesService.parseTaxResult(item);
      assertTransition('SENT', 'REJECTED');
      await ctx.tenantDb.taxInvoice.updateMany({ where: { id, status: 'SENT' }, data: { status: 'REJECTED', resultAt: new Date(), errors: errors as unknown as object } });
      await this.audit.activity(ctx, 'tax.invoice.rejected', id, { errors: errors.map((e) => ({ code: e.code, fa: e.fa })) });
      await this.notifyResult(ctx, t, false, errors);
    }
    return { status };
  }

  private async notifyResult(ctx: TenantRequestContext, t: { id: string; requestedByUserId: string | null; createdByUserId: string | null; salesInvoice: { invoiceNo: number; total: number; contact: { name: string } }; taxid: string | null }, accepted: boolean, errors: MappedTaxError[]): Promise<void> {
    const title = accepted ? `صورتحساب مالیاتی فاکتور ${t.salesInvoice.invoiceNo} در سامانه مودیان پذیرفته شد` : `صورتحساب مالیاتی فاکتور ${t.salesInvoice.invoiceNo} در سامانه مودیان رد شد`;
    const body = accepted ? undefined : errors.map((e) => e.fa).join('؛ ').slice(0, 500);
    const recipients = new Set<string>();
    if (t.requestedByUserId) recipients.add(t.requestedByUserId);
    if (t.createdByUserId) recipients.add(t.createdByUserId);
    try {
      for (const m of await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId)) recipients.add(m.tenantUserId);
    } catch {
      // مدیران در دسترس نبودند — فقط درخواست‌دهنده
    }
    for (const userId of recipients) {
      await this.notifications.notify(ctx.tenantDb, { userId, type: accepted ? 'TAX_ACCEPTED' : 'TAX_REJECTED', title, body, link: `/tax?open=${t.id}` }).catch(() => undefined);
    }
    await this.automation
      .emit(ctx, accepted ? 'tax.invoice.accepted' : 'tax.invoice.rejected', {
        invoiceNo: t.salesInvoice.invoiceNo,
        customerName: t.salesInvoice.contact.name,
        amount: t.salesInvoice.total,
        taxid: t.taxid,
        errorSummary: body ?? null,
        ownerUserId: t.requestedByUserId ?? t.createdByUserId,
      })
      .catch((e) => this.logger.warn(`automation emit failed: ${e instanceof Error ? e.message : e}`));
  }

  // ── کارگر پس‌زمینه (برای هر تننت) ─────────────────────────────────────

  /** یک دور پردازش: ارسال‌های آماده + استعلام ارسال‌شده‌ها. هیچ‌چیز بدون تأیید پیشین ارسال نمی‌شود (dispatch فقط APPROVED را برمی‌دارد). */
  async processTenant(ctx: TenantRequestContext, limit = 20): Promise<{ sent: number; polled: number }> {
    const now = new Date();
    const ready = await ctx.tenantDb.taxInvoice.findMany({
      where: { status: 'APPROVED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    // FAILED گذرا با زمان تلاش مجدد رسیده (و هنوز زیر سقف) خودکار برمی‌گردد به APPROVED با retry=true
    const retriable = await ctx.tenantDb.taxInvoice.findMany({
      where: { status: 'FAILED', retryCount: { lte: MAX_AUTO_RETRIES }, nextAttemptAt: { not: null, lte: now }, approvedAt: { not: null } },
      select: { id: true },
      take: limit,
    });
    for (const r of retriable) {
      await ctx.tenantDb.taxInvoice.updateMany({ where: { id: r.id, status: 'FAILED' }, data: { status: 'APPROVED', retryFlag: true } });
      ready.push(r);
    }
    // QUEUED رهاشده (کرش بین CAS و ارسال): ابتدا با استعلام روشن می‌کنیم آیا بسته رسیده؛ اگر نه، با retry=true دوباره
    const stale = await ctx.tenantDb.taxInvoice.findMany({ where: { status: 'QUEUED', updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, select: { id: true } });
    for (const s of stale) {
      await ctx.tenantDb.taxInvoice.updateMany({ where: { id: s.id, status: 'QUEUED' }, data: { status: 'APPROVED', retryFlag: true } });
    }
    let sent = 0;
    for (const r of ready) {
      try {
        const out = await this.dispatch(ctx, r.id);
        if (out.sent) sent += 1;
        else if (out.reason === 'SENDING_DISABLED' || out.reason === 'PRODUCTION_NOT_VERIFIED') break; // گارد سراسری: بقیه هم همین‌اند
      } catch (e) {
        this.logger.error(`dispatch ${r.id} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    const toPoll = await ctx.tenantDb.taxInvoice.findMany({
      where: { status: 'SENT', OR: [{ lastInquiryAt: null }, { lastInquiryAt: { lt: new Date(now.getTime() - 60_000) } }] },
      select: { id: true },
      orderBy: { sentAt: 'asc' },
      take: limit,
    });
    let polled = 0;
    for (const p of toPoll) {
      try {
        await this.pollOne(ctx, p.id);
        polled += 1;
      } catch (e) {
        this.logger.error(`poll ${p.id} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { sent, polled };
  }
}
