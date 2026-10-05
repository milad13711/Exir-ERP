import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { normalizeSearchTerm, searchTermAsInt } from '../common/search.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TenantSmsService, smsParts } from '../sms/tenant-sms.service.js';
import { InvoicesService } from '../sales/invoices.service.js';
import type { CreateProposalDto } from './dto/create-proposal.dto.js';
import type { UpdateProposalDto } from './dto/update-proposal.dto.js';
import type { AssignProposalDto, IssueProposalInvoiceDto, ProposalStatusValue } from './dto/proposal-actions.dto.js';
import {
  buildInvoiceNotes,
  isProposalExpired,
  maskPhone,
  proposalPublicUrl,
  recordProposalEvent,
  resolveInvoiceLines,
} from './proposal.util.js';

/** فیلدهایی که در فهرست لازم نیستند (متن بلند و امضا) — فقط در جزئیات می‌آیند. */
const LIST_OMIT = { content: true, acceptedSignatureDataUrl: true, invoiceLines: true } as const;

const DETAIL_INCLUDE = {
  contact: { select: { id: true, name: true, company: true, phone: true, email: true } },
  deal: { select: { id: true, title: true } },
  createdBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  comments: { orderBy: { createdAt: 'asc' as const } },
  events: { orderBy: { createdAt: 'desc' as const }, take: 100 },
  views: { orderBy: { createdAt: 'desc' as const }, take: 50 },
};

const LIST_INCLUDE = {
  contact: { select: { id: true, name: true, company: true } },
  assignedTo: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
};

type Scope = Record<string, unknown>;

@Injectable()
export class ProposalsService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly notifications: NotificationsService,
    private readonly sms: TenantSmsService,
    private readonly invoices: InvoicesService,
  ) {}

  // ── یافتن با دامنه‌ی دسترسی ───────────────────────────────────────────

  /** همه‌ی مسیرهای by-id از اینجا رد می‌شوند: خارج از دامنه‌ی کاربر دقیقاً مثل «وجود ندارد» → ۴۰۴. */
  private async getScoped(ctx: TenantRequestContext, id: string, scope: Scope) {
    const proposal = await ctx.tenantDb.proposal.findFirst({ where: { AND: [{ id }, scope] } });
    if (!proposal) throw new NotFoundException('پروپوزال یافت نشد');
    return proposal;
  }

  private assertNotLocked(proposal: { status: string }) {
    if (proposal.status === 'ACCEPTED') {
      throw new ForbiddenException('پروپوزال پذیرفته‌شده قفل است؛ فقط «یادداشت وضعیت» قابل ویرایش است');
    }
  }

  /** هر پروپوزال ارسال‌شده‌ای که مهلت اعتبارش گذشته و هنوز پاسخی نگرفته، «منقضی» می‌شود. */
  async syncExpiry(ctx: TenantRequestContext, extraWhere: Scope = {}): Promise<void> {
    await ctx.tenantDb.proposal.updateMany({
      where: { ...extraWhere, status: { in: ['SENT', 'VIEWED', 'REVISION_REQUESTED'] }, validUntil: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      data: { status: 'EXPIRED' },
    });
    // تاریخ‌های دارای ساعت (غیر نیمه‌شب) دقیق‌تر: همان لحظه
    const candidates = await ctx.tenantDb.proposal.findMany({
      where: { ...extraWhere, status: { in: ['SENT', 'VIEWED', 'REVISION_REQUESTED'] }, validUntil: { lt: new Date() } },
      select: { id: true, validUntil: true },
    });
    const ids = candidates.filter((c) => isProposalExpired(c.validUntil)).map((c) => c.id);
    if (ids.length > 0) await ctx.tenantDb.proposal.updateMany({ where: { id: { in: ids } }, data: { status: 'EXPIRED' } });
  }

  // ── فهرست و جزئیات ────────────────────────────────────────────────────

  async list(ctx: TenantRequestContext, scope: Scope, filters: { q?: string; status?: string; contactId?: string; assignedUserId?: string }) {
    await this.syncExpiry(ctx);
    const term = normalizeSearchTerm(filters.q);
    const no = term ? searchTermAsInt(term) : undefined;
    const and: Scope[] = [scope];
    if (term) {
      and.push({
        OR: [
          ...(no !== undefined ? [{ proposalNo: no }] : []),
          { title: { contains: term, mode: 'insensitive' } },
          { contact: { name: { contains: term, mode: 'insensitive' } } },
          { contact: { company: { contains: term, mode: 'insensitive' } } },
        ],
      });
    }
    if (filters.status) and.push({ status: filters.status });
    if (filters.contactId) and.push({ contactId: filters.contactId });
    if (filters.assignedUserId) and.push({ assignedUserId: filters.assignedUserId });
    return ctx.tenantDb.proposal.findMany({
      where: { AND: and },
      omit: LIST_OMIT,
      include: LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async detail(ctx: TenantRequestContext, id: string, scope: Scope) {
    await this.getScoped(ctx, id, scope);
    await this.syncExpiry(ctx, { id });
    const proposal = await ctx.tenantDb.proposal.findFirst({ where: { AND: [{ id }, scope] }, include: DETAIL_INCLUDE });
    if (!proposal) throw new NotFoundException('پروپوزال یافت نشد');
    const invoice = proposal.invoiceId
      ? await ctx.tenantDb.salesInvoice.findUnique({ where: { id: proposal.invoiceId }, select: { id: true, invoiceNo: true, status: true } })
      : null;
    return { ...proposal, invoice };
  }

  // ── ساخت و ویرایش ─────────────────────────────────────────────────────

  private async assertContactAndDeal(ctx: TenantRequestContext, contactId: string, dealId: string | null | undefined, contactScope: Scope) {
    const contact = await ctx.tenantDb.crmContact.findFirst({ where: { AND: [{ id: contactId }, contactScope] }, select: { id: true } });
    if (!contact) throw new NotFoundException('مشتری یافت نشد');
    if (dealId) {
      const deal = await ctx.tenantDb.crmDeal.findFirst({ where: { id: dealId, contactId }, select: { id: true } });
      if (!deal) throw new BadRequestException('معامله‌ی انتخاب‌شده متعلق به این مشتری نیست');
    }
  }

  private async assertUserExists(ctx: TenantRequestContext, userId: string) {
    const user = await ctx.tenantDb.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new BadRequestException('همکار انتخاب‌شده یافت نشد');
  }

  async create(ctx: TenantRequestContext, dto: CreateProposalDto, contactScope: Scope) {
    await this.assertContactAndDeal(ctx, dto.contactId, dto.dealId, contactScope);
    if (dto.assignedUserId) await this.assertUserExists(ctx, dto.assignedUserId);
    const createdByUserId = await resolveTenantUserId(ctx);

    const proposal = await ctx.tenantDb.proposal.create({
      data: {
        title: dto.title.trim(),
        contactId: dto.contactId,
        dealId: dto.dealId ?? undefined,
        content: dto.content ?? '',
        durationText: dto.durationText?.trim() || undefined,
        amount: dto.amount ?? 0,
        paymentMethodText: dto.paymentMethodText?.trim() || undefined,
        paymentTerms: dto.paymentTerms?.trim() || undefined,
        paymentDeadline: dto.paymentDeadline?.trim() || undefined,
        paymentDueAt: dto.paymentDueAt ? new Date(dto.paymentDueAt) : undefined,
        bankInfo: dto.bankInfo?.trim() || undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        internalNote: dto.internalNote?.trim() || undefined,
        invoiceLines: dto.invoiceLines && dto.invoiceLines.length > 0 ? (dto.invoiceLines as unknown as object) : undefined,
        assignedUserId: dto.assignedUserId ?? undefined,
        createdByUserId: createdByUserId ?? undefined,
      },
    });
    await recordProposalEvent(ctx.tenantDb, { proposalId: proposal.id, contactId: proposal.contactId, proposalNo: proposal.proposalNo, type: 'CREATED', body: `«${proposal.title}» ایجاد شد`, userId: createdByUserId });
    if (proposal.assignedUserId && proposal.assignedUserId !== createdByUserId) {
      await this.notifyAssignee(ctx, proposal, 'ASSIGNED');
    }
    return proposal;
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateProposalDto, scope: Scope, contactScope: Scope) {
    const existing = await this.getScoped(ctx, id, scope);
    this.assertNotLocked(existing);
    const me = await resolveTenantUserId(ctx);

    if (dto.contactId && dto.contactId !== existing.contactId) {
      await this.assertContactAndDeal(ctx, dto.contactId, dto.dealId === undefined ? null : dto.dealId, contactScope);
    } else if (dto.dealId) {
      await this.assertContactAndDeal(ctx, existing.contactId, dto.dealId, contactScope);
    }
    const assigneeChanged = dto.assignedUserId !== undefined && dto.assignedUserId !== existing.assignedUserId;
    if (dto.assignedUserId) await this.assertUserExists(ctx, dto.assignedUserId);

    const nextValidUntil = dto.validUntil === undefined ? existing.validUntil : dto.validUntil ? new Date(dto.validUntil) : null;
    // ویرایش مهلت اعتبار یک پروپوزال منقضی به آینده، آن را دوباره فعال می‌کند
    let statusPatch: { status: 'SENT' | 'DRAFT' } | undefined;
    if (existing.status === 'EXPIRED' && !isProposalExpired(nextValidUntil)) {
      statusPatch = { status: existing.sentAt ? 'SENT' : 'DRAFT' };
    }

    const nullable = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : v.trim() || null);
    const updated = await ctx.tenantDb.proposal.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        contactId: dto.contactId,
        ...(dto.dealId !== undefined ? { dealId: dto.dealId } : {}),
        content: dto.content,
        durationText: nullable(dto.durationText),
        amount: dto.amount,
        paymentMethodText: nullable(dto.paymentMethodText),
        paymentTerms: nullable(dto.paymentTerms),
        paymentDeadline: nullable(dto.paymentDeadline),
        ...(dto.paymentDueAt !== undefined ? { paymentDueAt: dto.paymentDueAt ? new Date(dto.paymentDueAt) : null } : {}),
        bankInfo: nullable(dto.bankInfo),
        ...(dto.validUntil !== undefined ? { validUntil: nextValidUntil } : {}),
        internalNote: nullable(dto.internalNote),
        ...(dto.invoiceLines !== undefined
          ? { invoiceLines: dto.invoiceLines && dto.invoiceLines.length > 0 ? (dto.invoiceLines as unknown as object) : Prisma.DbNull }
          : {}),
        ...(dto.assignedUserId !== undefined ? { assignedUserId: dto.assignedUserId } : {}),
        ...statusPatch,
      },
    });
    await recordProposalEvent(ctx.tenantDb, { proposalId: id, contactId: updated.contactId, proposalNo: updated.proposalNo, type: 'UPDATED', body: 'پروپوزال ویرایش شد', userId: me });
    if (assigneeChanged && updated.assignedUserId && updated.assignedUserId !== me) {
      await this.notifyAssignee(ctx, updated, 'ASSIGNED');
    }
    return updated;
  }

  async remove(ctx: TenantRequestContext, id: string, scope: Scope) {
    const existing = await this.getScoped(ctx, id, scope);
    await ctx.tenantDb.attachment.deleteMany({ where: { entityType: 'Proposal', entityId: id } });
    await ctx.tenantDb.proposal.delete({ where: { id } });
    // پروپوزال حذف‌شده از تاریخچه‌ی مشتری هم باید قابل‌ردیابی بماند، پس خود یادداشت CRM پاک نمی‌شود.
    await ctx.tenantDb.crmActivity
      .create({ data: { type: 'NOTE', contactId: existing.contactId, body: `پروپوزال شماره ${existing.proposalNo} حذف شد` } })
      .catch(() => undefined);
    return { success: true };
  }

  // ── وضعیت ─────────────────────────────────────────────────────────────

  /** تغییر دستی وضعیت توسط تیم. پروپوزال پذیرفته‌شده قفل است (فقط یادداشت وضعیت). */
  async setStatus(ctx: TenantRequestContext, id: string, status: ProposalStatusValue, note: string | undefined, scope: Scope) {
    const existing = await this.getScoped(ctx, id, scope);
    this.assertNotLocked(existing);
    if (existing.status === status) return existing;
    const me = await resolveTenantUserId(ctx);

    const data: Record<string, unknown> = { status };
    if (note !== undefined) data.statusNote = note.trim() || null;
    if (status === 'SENT' && !existing.sentAt) data.sentAt = new Date();
    if (status === 'ACCEPTED') {
      const user = me ? await ctx.tenantDb.user.findUnique({ where: { id: me }, select: { name: true } }) : null;
      Object.assign(data, { acceptedAt: new Date(), respondedAt: new Date(), acceptedManually: true, acceptedByName: `ثبت دستی توسط ${user?.name ?? 'کاربر'}` });
    }
    if (status === 'REJECTED' || status === 'REVISION_REQUESTED') data.respondedAt = new Date();
    if (status === 'EXPIRED' || status === 'DRAFT' || status === 'SENT' || status === 'VIEWED') data.respondedAt = null;

    const updated = await ctx.tenantDb.proposal.update({ where: { id }, data });
    const eventType = status === 'ACCEPTED' || status === 'REJECTED' || status === 'REVISION_REQUESTED' ? status : status === 'SENT' ? 'SENT' : 'STATUS_CHANGED';
    await recordProposalEvent(ctx.tenantDb, {
      proposalId: id,
      contactId: updated.contactId,
      proposalNo: updated.proposalNo,
      type: eventType,
      body: `وضعیت دستی: ${STATUS_FA[status]}${note?.trim() ? ` — ${note.trim()}` : ''}`,
      userId: me,
    });
    return updated;
  }

  async updateStatusNote(ctx: TenantRequestContext, id: string, statusNote: string, scope: Scope) {
    await this.getScoped(ctx, id, scope);
    return ctx.tenantDb.proposal.update({ where: { id }, data: { statusNote: statusNote.trim() || null } });
  }

  // ── ارجاع به همکار ────────────────────────────────────────────────────

  async assign(ctx: TenantRequestContext, id: string, dto: AssignProposalDto, scope: Scope) {
    const existing = await this.getScoped(ctx, id, scope);
    const me = await resolveTenantUserId(ctx);
    if (dto.userId) await this.assertUserExists(ctx, dto.userId);
    const updated = await ctx.tenantDb.proposal.update({ where: { id }, data: { assignedUserId: dto.userId ?? null }, include: { contact: { select: { name: true, company: true } } } });
    await recordProposalEvent(ctx.tenantDb, {
      proposalId: id,
      contactId: existing.contactId,
      proposalNo: existing.proposalNo,
      type: 'ASSIGNED',
      body: dto.userId ? 'ارجاع به همکار برای پیگیری' : 'ارجاع برداشته شد',
      userId: me,
    });
    if (dto.userId && dto.userId !== me) {
      await this.notifyAssignee(ctx, updated, 'ASSIGNED');
    }
    if (dto.userId && dto.createTask) {
      await ctx.tenantDb.task.create({
        data: {
          title: `پیگیری پروپوزال شماره ${updated.proposalNo} — ${updated.contact.company || updated.contact.name}`,
          description: `پروپوزال «${updated.title}» برای پیگیری به شما ارجاع شد.`,
          assignedUserId: dto.userId,
          relatedModule: 'proposals',
          relatedEntityId: id,
          dueAt: updated.validUntil ?? undefined,
        },
      });
    }
    return { id: updated.id, assignedUserId: updated.assignedUserId };
  }

  private async notifyAssignee(
    ctx: TenantRequestContext,
    proposal: { id: string; proposalNo: number; title: string; assignedUserId: string | null },
    _kind: 'ASSIGNED',
  ) {
    if (!proposal.assignedUserId) return;
    await this.notifications.notify(ctx.tenantDb, {
      userId: proposal.assignedUserId,
      type: 'proposals.proposal.assigned',
      title: `پروپوزال شماره ${proposal.proposalNo} برای پیگیری به شما ارجاع شد`,
      body: proposal.title,
      link: `/proposals?id=${proposal.id}`,
    });
  }

  // ── نظر تیم ───────────────────────────────────────────────────────────

  async addStaffComment(ctx: TenantRequestContext, id: string, body: string, scope: Scope) {
    await this.getScoped(ctx, id, scope);
    const me = await resolveTenantUserId(ctx);
    const user = me ? await ctx.tenantDb.user.findUnique({ where: { id: me }, select: { name: true } }) : null;
    return ctx.tenantDb.proposalComment.create({
      data: { proposalId: id, authorType: 'STAFF', authorName: user?.name ?? 'تیم', kind: 'COMMENT', body: body.trim() },
    });
  }

  // ── لینک و پیامک ──────────────────────────────────────────────────────

  private async sellerName(ctx: TenantRequestContext): Promise<string> {
    const t = await this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
    return t?.name ?? '';
  }

  buildSmsMessage(proposal: { title: string; proposalNo: number; validUntil: Date | null }, url: string, sellerName: string): string {
    const faNo = String(proposal.proposalNo).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
    return [
      `${sellerName ? `${sellerName}: ` : ''}پروپوزال «${proposal.title}» (شماره ${faNo}) برای شما آماده شد.`,
      `مشاهده، پذیرش یا ارسال نظر: ${url}`,
    ].join('\n');
  }

  /** لینک عمومی را برمی‌گرداند؛ پروپوزال پیش‌نویس با به‌اشتراک‌گذاری لینک «ارسال‌شده» می‌شود (وگرنه صفحه‌ی عمومی باز نمی‌شود). */
  async shareLink(ctx: TenantRequestContext, id: string, scope: Scope, publicWebUrl: string) {
    const p = await this.getScoped(ctx, id, scope);
    if (p.status === 'DRAFT') await this.markSent(ctx, p, 'LINK_SHARED', 'لینک عمومی برای اشتراک‌گذاری آماده شد');
    return { url: proposalPublicUrl(publicWebUrl, ctx.tenantSlug, p.publicToken) };
  }

  private async markSent(
    ctx: TenantRequestContext,
    p: { id: string; contactId: string; proposalNo: number; sentAt: Date | null },
    eventType: string,
    body: string,
  ) {
    const me = await resolveTenantUserId(ctx);
    await ctx.tenantDb.proposal.update({ where: { id: p.id }, data: { status: 'SENT', sentAt: p.sentAt ?? new Date() } });
    await recordProposalEvent(ctx.tenantDb, { proposalId: p.id, contactId: p.contactId, proposalNo: p.proposalNo, type: 'SENT', body: eventType === 'SMS_SENT' ? 'ارسال شد' : body, userId: me });
  }

  async smsPreview(ctx: TenantRequestContext, id: string, scope: Scope, publicWebUrl: string) {
    const p = await ctx.tenantDb.proposal.findFirst({ where: { AND: [{ id }, scope] }, include: { contact: { select: { name: true, phone: true } } } });
    if (!p) throw new NotFoundException('پروپوزال یافت نشد');
    const url = proposalPublicUrl(publicWebUrl, ctx.tenantSlug, p.publicToken);
    const message = this.buildSmsMessage(p, url, await this.sellerName(ctx));
    return { phone: p.contact.phone, contactName: p.contact.name, message, parts: smsParts(message), url };
  }

  async sendSms(ctx: TenantRequestContext, id: string, scope: Scope, publicWebUrl: string) {
    const p = await ctx.tenantDb.proposal.findFirst({ where: { AND: [{ id }, scope] }, include: { contact: { select: { name: true, phone: true } } } });
    if (!p) throw new NotFoundException('پروپوزال یافت نشد');
    if (!p.contact.phone) throw new BadRequestException('این مشتری شماره موبایل ثبت‌شده ندارد');
    const url = proposalPublicUrl(publicWebUrl, ctx.tenantSlug, p.publicToken);
    const message = this.buildSmsMessage(p, url, await this.sellerName(ctx));
    const result = await this.sms.sendSms(ctx, p.contact.phone, message);
    if (!result.success) throw new BadRequestException(result.error ?? 'ارسال پیامک ناموفق بود');

    const me = await resolveTenantUserId(ctx);
    if (p.status === 'DRAFT' || p.status === 'REVISION_REQUESTED') {
      await ctx.tenantDb.proposal.update({ where: { id }, data: { status: 'SENT', sentAt: p.sentAt ?? new Date() } });
    } else if (!p.sentAt) {
      await ctx.tenantDb.proposal.update({ where: { id }, data: { sentAt: new Date() } });
    }
    await recordProposalEvent(ctx.tenantDb, {
      proposalId: id,
      contactId: p.contactId,
      proposalNo: p.proposalNo,
      type: 'SMS_SENT',
      body: `پیامک لینک به ${maskPhone(p.contact.phone)} ارسال شد`,
      userId: me,
    });
    return { ok: true, url };
  }

  // ── صدور فاکتور ───────────────────────────────────────────────────────

  async isSalesEnabled(ctx: TenantRequestContext): Promise<boolean> {
    const def = await this.controlDb.moduleDefinition.findUnique({ where: { code: 'sales' } });
    if (!def) return false;
    const install = await this.controlDb.tenantModule.findFirst({ where: { tenantId: ctx.tenantId, moduleId: def.id } });
    return install ? install.status === 'INSTALLED' || install.status === 'TRIAL' : def.isCore;
  }

  /**
   * فاکتور فروش پیش‌نویس برای مشتری می‌سازد: ردیف‌ها (یا یک ردیف به مبلغ پروژه)، روش پرداخت BANK_TRANSFER،
   * شماره کارت/حساب پروپوزال در paymentBankInfo و یادداشت خودکار (سررسید، مهلت پرداخت، شرایط، شماره‌ی پروپوزال).
   * ساخت از مسیر InvoicesService.create انجام می‌شود تا همه‌ی قوانین فاکتور اعمال شود.
   */
  async issueInvoice(ctx: TenantRequestContext, id: string, dto: IssueProposalInvoiceDto, scope: Scope) {
    const p = await this.getScoped(ctx, id, scope);
    if (p.status !== 'ACCEPTED') throw new BadRequestException('فقط برای پروپوزال پذیرفته‌شده می‌توان فاکتور صادر کرد');
    if (p.invoiceId) throw new ConflictException('برای این پروپوزال قبلاً فاکتور صادر شده است');
    if (!(await this.isSalesEnabled(ctx))) throw new ForbiddenException('برای صدور فاکتور، ماژول «فروش و فاکتور» باید فعال باشد');

    const bankInfo = p.bankInfo?.trim() || (await this.invoices.getDefaultBankInfo(ctx.tenantDb)).trim();
    if (!bankInfo) throw new BadRequestException('شماره کارت/حساب برای واریز در پروپوزال (یا تنظیمات فروش) ثبت نشده است');

    const lines = resolveInvoiceLines(p, dto.lines);
    if (lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) <= 0) {
      throw new BadRequestException('مبلغ پروژه صفر است؛ مبلغ یا ردیف‌های فاکتور را مشخص کنید');
    }
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : p.paymentDueAt;

    // رزرو اتمیک: دو کلیک هم‌زمان دو فاکتور نمی‌سازد
    const claim = await ctx.tenantDb.proposal.updateMany({ where: { id, invoiceId: null, invoicedAt: null, status: 'ACCEPTED' }, data: { invoicedAt: new Date() } });
    if (claim.count === 0) throw new ConflictException('برای این پروپوزال قبلاً فاکتور صادر شده است');

    let invoice: { id: string; invoiceNo: number };
    try {
      invoice = await this.invoices.create(ctx, {
        contactId: p.contactId,
        dealId: p.dealId ?? undefined,
        dueAt: dueAt ? dueAt.toISOString() : undefined,
        notes: buildInvoiceNotes(p, dueAt),
        paymentMethod: 'BANK_TRANSFER',
        paymentBankInfo: bankInfo,
        lines,
      });
    } catch (err) {
      await ctx.tenantDb.proposal.update({ where: { id }, data: { invoicedAt: null } });
      throw err;
    }
    await ctx.tenantDb.proposal.update({ where: { id }, data: { invoiceId: invoice.id } });
    const me = await resolveTenantUserId(ctx);
    await recordProposalEvent(ctx.tenantDb, {
      proposalId: id,
      contactId: p.contactId,
      proposalNo: p.proposalNo,
      type: 'INVOICED',
      body: `فاکتور فروش شماره ${invoice.invoiceNo} (پیش‌نویس) صادر شد`,
      userId: me,
    });
    return { invoiceId: invoice.id, invoiceNo: invoice.invoiceNo };
  }
}

const STATUS_FA: Record<ProposalStatusValue, string> = {
  DRAFT: 'پیش‌نویس',
  SENT: 'ارسال‌شده',
  VIEWED: 'مشاهده‌شده',
  ACCEPTED: 'پذیرفته‌شده',
  REJECTED: 'ردشده',
  REVISION_REQUESTED: 'نیاز به اصلاحات',
  EXPIRED: 'منقضی',
};
