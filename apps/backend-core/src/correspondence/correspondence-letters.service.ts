import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getManagerUsers } from '../common/manager-users.js';
import type { Prisma } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { stableStringify } from '../common/signature-evidence/signature-evidence.util.js';
import { CorrespondenceCoreService, type CorrActor } from './correspondence-core.service.js';
import { CorrespondenceNumberingService } from './correspondence-numbering.service.js';
import { CorrespondenceReferralsService } from './correspondence-referrals.service.js';
import { CorrespondenceSettingsService } from './correspondence-settings.service.js';
import { CONFIDENTIALITIES, type LetterStatus, type LetterType } from './correspondence.constants.js';
import type { CreateLetterDto, ExternalFollowupDto, RegisterIncomingDto, UpdateLetterDto } from './dto/correspondence.dto.js';
import { buildRegisterCsv, type RegisterRow } from './letter-register-csv.js';
import type { Where } from './letter-scope.js';
import { buildLetterFilterWhere, clampPageSize, combineWhere, type LetterFilters } from './letter-search.js';
import { canCreateCorrection, canParaph, canRefer, canTransition, isArchivable, isEditable, nextStatus } from './letter-state.js';
import { letterHtmlToText, sanitizeLetterHtml } from './pdf/sanitize-letter-html.js';
import { deriveVerifyToken, hashVerifyToken } from './verify-token.js';

type Recipient = { name: string; title?: string; org?: string; contactId?: string; userId?: string };

/** فیلدهای محتوایی که در نسخه‌ها (CorrRevision) ثبت و مقایسه می‌شوند. */
const CONTENT_FIELDS = [
  'subject', 'bodyHtml', 'recipients', 'ccNames', 'categoryId', 'priority', 'confidentiality', 'letterDate', 'responseDueAt', 'attachmentsText',
  'letterheadId', 'templateId', 'tags', 'relatedContactId', 'relatedProjectId', 'relatedContractId', 'relatedInvoiceId',
  'externalNumber', 'externalDate', 'receivedAt', 'deliveryMethod', 'senderOrgName', 'senderName', 'senderContactId', 'pageCount',
] as const;

const LIST_SELECT = {
  id: true, type: true, status: true, subject: true, letterNumber: true, letterDate: true, externalNumber: true, externalDate: true, receivedAt: true,
  senderName: true, senderOrgName: true, recipientsText: true, categoryId: true, priority: true, confidentiality: true, responseDueAt: true,
  answeredAt: true, createdByName: true, createdByUserId: true, signerUserId: true, ownerUserId: true, createdAt: true, updatedAt: true,
  archivedAt: true, pageCount: true, voidedAt: true, replyToLetterId: true, registeredAt: true,
  category: { select: { id: true, name: true } },
} satisfies Prisma.CorrLetterSelect;

export function normalizeSenderKey(contactId: string | null | undefined, org: string | null | undefined, name: string | null | undefined): string | null {
  if (contactId) return `c:${contactId}`;
  const t = (org || name || '').replace(/[\s‌‏‎]+/g, ' ').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').trim().toLowerCase();
  return t ? `t:${t}` : null;
}

export function recipientsToText(rs: Recipient[]): string {
  return rs.map((r) => [r.name, r.org].filter(Boolean).join(' - ')).join('، ').slice(0, 2000);
}

function cleanRecipients(input: Recipient[] | undefined): Recipient[] {
  return (input ?? []).map((r) => ({
    name: r.name.trim(), ...(r.title ? { title: r.title.trim() } : {}), ...(r.org ? { org: r.org.trim() } : {}),
    ...(r.contactId ? { contactId: r.contactId } : {}), ...(r.userId ? { userId: r.userId } : {}),
  })).filter((r) => r.name);
}

const asDate = (v: string | null | undefined): Date | null | undefined => (v === undefined ? undefined : v === null ? null : new Date(v));

export function sanitizeBody(html: string | undefined): { bodyHtml: string; bodyText: string } {
  const bodyHtml = sanitizeLetterHtml(html ?? '');
  return { bodyHtml, bodyText: letterHtmlToText(bodyHtml).slice(0, 200_000) };
}

@Injectable()
export class CorrespondenceLettersService {
  constructor(
    private readonly core: CorrespondenceCoreService,
    private readonly numbering: CorrespondenceNumberingService,
    private readonly referrals: CorrespondenceReferralsService,
    private readonly settings: CorrespondenceSettingsService,
  ) {}

  // ── ایجاد پیش‌نویس ─────────────────────────────────────────────────────
  async createDraft(ctx: TenantRequestContext, actor: CorrActor, dto: CreateLetterDto) {
    this.core.assertCreate(actor);
    if (dto.categoryId) await this.assertCategory(ctx, dto.categoryId);
    let replyTo: Awaited<ReturnType<CorrespondenceCoreService['findVisible']>> | null = null;
    if (dto.replyToLetterId) replyTo = await this.core.findVisible(ctx, actor, dto.replyToLetterId);
    const recipients = cleanRecipients(dto.recipients);
    const body = sanitizeBody(dto.bodyHtml);
    return ctx.tenantDb.$transaction(async (tx) => {
      const letter = await tx.corrLetter.create({
        data: {
          type: dto.type, status: 'DRAFT', subject: (dto.subject ?? '').trim(), ...body, recipients: recipients as unknown as Prisma.InputJsonValue,
          recipientsText: recipientsToText(recipients), ccNames: dto.ccNames ?? [], categoryId: dto.categoryId ?? null,
          priority: dto.priority ?? 'NORMAL', confidentiality: dto.confidentiality ?? replyTo?.confidentiality ?? 'NORMAL',
          letterDate: dto.letterDate ? new Date(dto.letterDate) : new Date(), responseDueAt: asDate(dto.responseDueAt) ?? null,
          attachmentsText: dto.attachmentsText ?? null, letterheadId: dto.letterheadId ?? null, templateId: dto.templateId ?? null,
          replyToLetterId: replyTo?.id ?? null, relatedContactId: dto.relatedContactId ?? replyTo?.senderContactId ?? null,
          relatedProjectId: dto.relatedProjectId ?? null, relatedContractId: dto.relatedContractId ?? null, relatedInvoiceId: dto.relatedInvoiceId ?? null,
          tags: dto.tags ?? [], createdByUserId: actor.userId, createdByName: actor.name, ownerUserId: actor.userId,
        },
      });
      await this.core.addParticipant(tx, letter.id, actor.userId, 'CREATOR');
      await this.core.logEvent(tx, letter.id, 'CREATED', actor, null, { type: dto.type });
      if (replyTo) await this.core.logEvent(tx, replyTo.id, 'REPLIED', actor, null, { replyLetterId: letter.id });
      return letter;
    });
  }

  private async assertCategory(ctx: TenantRequestContext, id: string) {
    const c = await ctx.tenantDb.corrLetterCategory.findUnique({ where: { id }, select: { isActive: true } });
    if (!c) throw new BadRequestException('دسته یافت نشد');
  }

  // ── ویرایش (خودکار/دستی) با نسخه ───────────────────────────────────────
  async update(ctx: TenantRequestContext, actor: CorrActor, id: string, dto: UpdateLetterDto) {
    const letter = await this.core.findVisible(ctx, actor, id);
    const type = letter.type as LetterType;
    const status = letter.status as LetterStatus;
    if (letter.archivedAt) throw new ConflictException('نامه‌ی بایگانی‌شده ویرایش نمی‌شود؛ ابتدا از بایگانی خارج کنید');
    if (!isEditable(type, status)) throw new ConflictException(type === 'INCOMING' ? 'این نامه دیگر قابل ویرایش نیست' : 'نامه‌ی امضاشده/در گردش ویرایش نمی‌شود؛ برای اصلاح، «اصلاحیه» بسازید');
    if (!this.core.canMutateContent(actor, letter)) throw new ForbiddenException('اجازه‌ی ویرایش این نامه را ندارید');
    if (dto.baseUpdatedAt && new Date(dto.baseUpdatedAt).getTime() !== letter.updatedAt.getTime()) {
      throw new ConflictException('این نامه در همین فاصله توسط شخص دیگری تغییر کرده است؛ صفحه را بازآوری کنید');
    }
    const isIncoming = type === 'INCOMING';
    // ذخیره‌ی خودکار (بدون نسخه/رویداد) فقط برای پیش‌نویس و برگشتیِ صادره/داخلی؛ وارده همیشه نسخه + رویداد + دلیل
    const autosave = !!dto.autosave && !isIncoming && (status === 'DRAFT' || status === 'RETURNED_FOR_EDIT');
    if (isIncoming && !dto.reason?.trim()) throw new BadRequestException('دلیل ویرایش نامه‌ی ثبت‌شده را بنویسید');
    if (dto.categoryId) await this.assertCategory(ctx, dto.categoryId);

    const next: Record<string, unknown> = {};
    const set = (k: (typeof CONTENT_FIELDS)[number], v: unknown) => { if (v !== undefined) next[k] = v; };
    set('subject', dto.subject?.trim());
    if (dto.bodyHtml !== undefined) next.bodyHtml = sanitizeBody(dto.bodyHtml).bodyHtml;
    if (dto.recipients !== undefined) next.recipients = cleanRecipients(dto.recipients);
    set('ccNames', dto.ccNames);
    set('categoryId', dto.categoryId);
    set('priority', dto.priority);
    set('confidentiality', dto.confidentiality);
    set('letterDate', asDate(dto.letterDate));
    set('responseDueAt', asDate(dto.responseDueAt));
    set('attachmentsText', dto.attachmentsText);
    set('letterheadId', dto.letterheadId);
    set('templateId', dto.templateId);
    set('tags', dto.tags);
    set('relatedContactId', dto.relatedContactId);
    set('relatedProjectId', dto.relatedProjectId);
    set('relatedContractId', dto.relatedContractId);
    set('relatedInvoiceId', dto.relatedInvoiceId);
    if (isIncoming) {
      set('externalNumber', dto.externalNumber?.trim());
      set('externalDate', asDate(dto.externalDate));
      set('receivedAt', asDate(dto.receivedAt));
      set('deliveryMethod', dto.deliveryMethod);
      set('senderOrgName', dto.senderOrgName?.trim());
      set('senderName', dto.senderName?.trim());
      set('senderContactId', dto.senderContactId);
      set('pageCount', dto.pageCount);
    }
    // فقط فیلدهای واقعاً تغییرکرده
    const changed = Object.keys(next).filter((k) => stableStringify((letter as Record<string, unknown>)[k]) !== stableStringify(next[k]));
    if (!changed.length) return letter;

    const data: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of changed) {
      data[k] = next[k];
      before[k] = (letter as Record<string, unknown>)[k];
      after[k] = next[k];
    }
    if (changed.includes('bodyHtml')) data.bodyText = letterHtmlToText(String(next.bodyHtml)).slice(0, 200_000);
    if (changed.includes('recipients')) data.recipientsText = recipientsToText(next.recipients as Recipient[]);
    if (isIncoming && (changed.includes('senderContactId') || changed.includes('senderOrgName') || changed.includes('senderName'))) {
      data.senderKey = normalizeSenderKey((next.senderContactId ?? letter.senderContactId) as string | null, (next.senderOrgName ?? letter.senderOrgName) as string | null, (next.senderName ?? letter.senderName) as string | null);
    }
    // تغییر محرمانگی همیشه نسخه + رویداد می‌سازد، فقط سازنده/مسئول یا مدیر، و برای غیرمدیر فقط به سمت بالاتر
    if (changed.includes('confidentiality')) {
      const order = CONFIDENTIALITIES as readonly string[];
      const mine = !!actor.userId && (letter.createdByUserId === actor.userId || letter.ownerUserId === actor.userId);
      if (!(actor.isManager || mine)) throw new ForbiddenException('فقط سازنده یا مسئول نامه می‌تواند محرمانگی را تغییر دهد');
      if (!actor.isManager && order.indexOf(String(next.confidentiality)) < order.indexOf(letter.confidentiality)) throw new ForbiddenException('کاهش سطح محرمانگی فقط توسط مدیر ممکن است');
    }
    const revise = !autosave || changed.includes('confidentiality');
    return ctx.tenantDb.$transaction(async (tx) => {
      const upd = await tx.corrLetter.updateMany({
        where: { id, updatedAt: letter.updatedAt },
        data: { ...(data as Prisma.CorrLetterUpdateManyMutationInput), ...(revise ? { revisionNo: { increment: 1 } } : {}) },
      });
      if (upd.count !== 1) throw new ConflictException('این نامه در همین فاصله تغییر کرده است؛ دوباره تلاش کنید');
      if (revise) {
        await tx.corrRevision.create({
          data: {
            letterId: id, revisionNo: letter.revisionNo + 1, reason: dto.reason?.trim() || null, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue,
            changedFields: changed, actorUserId: actor.userId, actorName: actor.name,
          },
        });
        await this.core.logEvent(tx, id, 'EDITED', actor, dto.reason?.trim() || null, {
          changedFields: changed,
          ...(changed.includes('confidentiality') ? { confidentiality: { from: letter.confidentiality, to: next.confidentiality } } : {}),
        });
      }
      return tx.corrLetter.findUniqueOrThrow({ where: { id } });
    });
  }

  async deleteDraft(ctx: TenantRequestContext, actor: CorrActor, id: string) {
    const letter = await this.core.findVisible(ctx, actor, id);
    if (letter.status !== 'DRAFT' || letter.letterNumber) throw new ConflictException('فقط پیش‌نویس بدون شماره حذف می‌شود؛ نامه‌ی شماره‌دار را باطل کنید');
    if (!(actor.isManager || actor.matrix.canDelete || letter.createdByUserId === actor.userId)) throw new ForbiddenException('اجازه‌ی حذف این پیش‌نویس را ندارید');
    await ctx.tenantDb.$transaction([
      ctx.tenantDb.attachment.deleteMany({ where: { entityType: 'Letter', entityId: id } }),
      ctx.tenantDb.corrLetter.delete({ where: { id } }),
    ]);
    return { success: true };
  }

  async revisions(ctx: TenantRequestContext, actor: CorrActor, id: string) {
    await this.core.findVisible(ctx, actor, id);
    return ctx.tenantDb.corrRevision.findMany({ where: { letterId: id }, orderBy: { revisionNo: 'desc' }, take: 200 });
  }

  // ── ثبت نامه‌ی وارده ───────────────────────────────────────────────────
  /** نامه‌های مشابه (همان فرستنده + همان شماره‌ی اصلی + همان روز) — فقط شمارش و، اگر در دامنه‌ی کاربر باشند، مشخصات. */
  async findDuplicates(ctx: TenantRequestContext, actor: CorrActor, input: { senderContactId?: string | null; senderOrgName?: string | null; senderName?: string | null; externalNumber?: string | null; externalDate?: string | Date | null }) {
    const key = normalizeSenderKey(input.senderContactId, input.senderOrgName, input.senderName);
    const num = input.externalNumber?.trim();
    if (!key || !num) return { count: 0, visible: [] as { id: string; letterNumber: string | null; subject: string }[] };
    const where: Prisma.CorrLetterWhereInput = { type: 'INCOMING', senderKey: key, externalNumber: num, status: { not: 'VOID' } };
    if (input.externalDate) {
      const d = new Date(input.externalDate);
      if (!Number.isNaN(d.getTime())) where.externalDate = { gte: new Date(d.getTime() - 12 * 3600_000), lt: new Date(d.getTime() + 12 * 3600_000) };
    }
    const all = await ctx.tenantDb.corrLetter.findMany({ where, select: { id: true }, take: 20 });
    if (!all.length) return { count: 0, visible: [] };
    const visible = await ctx.tenantDb.corrLetter.findMany({
      where: combineWhere({ id: { in: all.map((a) => a.id) } }, this.core.visibleWhere(actor)) as Prisma.CorrLetterWhereInput,
      select: { id: true, letterNumber: true, subject: true },
    });
    return { count: all.length, visible };
  }

  async registerIncoming(ctx: TenantRequestContext, actor: CorrActor, dto: RegisterIncomingDto) {
    this.core.assertCreate(actor);
    if (dto.categoryId) await this.assertCategory(ctx, dto.categoryId);
    const dup = await this.findDuplicates(ctx, actor, dto);
    if (dup.count > 0) {
      if (!dto.allowDuplicate) {
        throw new ConflictException({
          statusCode: 409, code: 'DUPLICATE_INCOMING', message: 'نامه‌ای با همین فرستنده، شماره و تاریخ قبلاً ثبت شده است',
          duplicates: dup.visible,
        });
      }
      if (!(actor.isManager || actor.matrix.canEdit)) throw new ForbiddenException('ثبت نامه‌ی تکراری فقط با دسترسی ویرایش یا مدیر مجاز است');
    }
    const now = new Date();
    const body = sanitizeBody(dto.bodyHtml);
    const letter = await ctx.tenantDb.$transaction(async (tx) => {
      const num = await this.numbering.issue(tx, 'INCOMING', now, dto.categoryId);
      const newId = randomUUID();
      const created = await tx.corrLetter.create({
        data: {
          id: newId, verifyTokenHash: hashVerifyToken(deriveVerifyToken(ctx.tenantId, newId)),
          type: 'INCOMING', status: 'REGISTERED', subject: dto.subject.trim(), ...body, letterNumber: num.number, numberingSchemeId: num.schemeId,
          numberPeriodKey: num.periodKey, numberSeq: num.seq, issuedAt: now, registeredAt: now, registeredByUserId: actor.userId, registeredByName: actor.name,
          letterDate: dto.externalDate ? new Date(dto.externalDate) : now,
          externalNumber: dto.externalNumber?.trim() || null, externalDate: dto.externalDate ? new Date(dto.externalDate) : null,
          receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : now, deliveryMethod: dto.deliveryMethod ?? null,
          senderOrgName: dto.senderOrgName?.trim() || null, senderName: dto.senderName?.trim() || null, senderContactId: dto.senderContactId ?? null,
          senderKey: normalizeSenderKey(dto.senderContactId, dto.senderOrgName, dto.senderName), pageCount: dto.pageCount ?? null,
          attachmentsText: dto.attachmentsText ?? null, categoryId: dto.categoryId ?? null, priority: dto.priority ?? 'NORMAL',
          confidentiality: dto.confidentiality ?? 'NORMAL', responseDueAt: dto.responseDueAt ? new Date(dto.responseDueAt) : null, tags: dto.tags ?? [],
          relatedContactId: dto.relatedContactId ?? dto.senderContactId ?? null, relatedProjectId: dto.relatedProjectId ?? null,
          relatedContractId: dto.relatedContractId ?? null, relatedInvoiceId: dto.relatedInvoiceId ?? null,
          createdByUserId: actor.userId, createdByName: actor.name, ownerUserId: actor.userId,
          recipientsText: '',
        },
      });
      await this.core.addParticipant(tx, created.id, actor.userId, 'CREATOR');
      await this.core.logEvent(tx, created.id, 'REGISTERED', actor, null, { secretariatNumber: num.number, duplicateOverride: dup.count > 0 && !!dto.allowDuplicate });
      return created;
    });
    if (dto.referral?.toUserIds?.length) {
      // ارجاع فوری هنگام ثبت: شکست ارجاع، ثبت نامه (و شماره‌ی صادرشده) را باطل نمی‌کند
      try {
        await this.referrals.refer(ctx, actor, letter.id, dto.referral);
      } catch (e) {
        return { ...(await ctx.tenantDb.corrLetter.findUniqueOrThrow({ where: { id: letter.id } })), referralError: e instanceof Error ? e.message : 'ارجاع انجام نشد' };
      }
    }
    return ctx.tenantDb.corrLetter.findUniqueOrThrow({ where: { id: letter.id } });
  }

  async addFollowup(ctx: TenantRequestContext, actor: CorrActor, id: string, dto: ExternalFollowupDto) {
    const letter = await this.core.findVisible(ctx, actor, id);
    if (letter.type !== 'INCOMING') throw new BadRequestException('پیگیری بیرونی فقط برای نامه‌ی وارده است');
    if (letter.status === 'VOID') throw new ConflictException('نامه‌ی باطل‌شده پیگیری نمی‌شود');
    const allowed = actor.isManager || actor.matrix.canEdit || actor.matrix.canCreate && (letter.createdByUserId === actor.userId || letter.ownerUserId === actor.userId || (await this.isParticipant(ctx, id, actor.userId)));
    if (!allowed) throw new ForbiddenException('اجازه‌ی ثبت پیگیری را ندارید');
    await this.core.logEvent(ctx.tenantDb, id, 'EXTERNAL_FOLLOWUP', actor, dto.text.trim(), { kind: dto.kind ?? 'NOTE', at: (dto.at ? new Date(dto.at) : new Date()).toISOString() });
    return { success: true };
  }

  private async isParticipant(ctx: TenantRequestContext, letterId: string, userId: string | null) {
    if (!userId) return false;
    return !!(await ctx.tenantDb.corrParticipant.findFirst({ where: { letterId, userId }, select: { id: true } }));
  }

  // ── خواندن ─────────────────────────────────────────────────────────────
  async list(ctx: TenantRequestContext, actor: CorrActor, filters: LetterFilters & { categoryId?: string }, cursor: string | undefined, limit?: number) {
    const f: LetterFilters = { ...filters };
    if (filters.categoryId) f.categoryIds = await this.settings.descendantIds(ctx, filters.categoryId);
    const where = combineWhere(this.core.visibleWhere(actor), buildLetterFilterWhere(f, actor.userId)) as Prisma.CorrLetterWhereInput;
    const take = clampPageSize(limit);
    const rows = await ctx.tenantDb.corrLetter.findMany({
      where, select: LIST_SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  /** پرچم‌های اجازه برای UI (سرور در هر اقدام دوباره بررسی می‌کند). */
  private flags(actor: CorrActor, l: Prisma.CorrLetterGetPayload<object>, participant: boolean, openReferral: boolean, openReview: boolean) {
    const type = l.type as LetterType;
    const status = l.status as LetterStatus;
    const mutate = this.core.canMutateContent(actor, l);
    const isSigner = !!actor.userId && l.signerUserId === actor.userId;
    const archived = !!l.archivedAt;
    return {
      canEdit: !archived && mutate && isEditable(type, status),
      canSubmit: !archived && mutate && canTransition(type, status, 'submit'),
      canSign: !archived && (isSigner || actor.isOwner) && canTransition(type, status, 'sign') && !!actor.userId,
      canReturn: !archived && (isSigner || actor.isOwner) && canTransition(type, status, 'return'),
      canReject: !archived && (isSigner || actor.isOwner) && canTransition(type, status, 'reject'),
      canReview: openReview && status === 'PENDING_REVIEW',
      canRefer: !archived && canRefer(type, status) && (actor.isManager || actor.matrix.canEdit || openReferral || (participant && actor.matrix.canCreate)),
      canParaph: canParaph(status) && (actor.isManager || participant),
      canSend: !archived && type === 'OUTGOING' && mutate && canTransition(type, status, 'send'),
      canDeliver: !archived && mutate && canTransition(type, status, 'deliver'),
      canReply: type === 'INCOMING' && actor.matrix.canCreate && status !== 'VOID',
      canCorrect: actor.matrix.canCreate && canCreateCorrection(type, status),
      canVoid: status !== 'VOID' && (actor.isManager || actor.matrix.canDelete || (status === 'DRAFT' && l.createdByUserId === actor.userId)),
      canClose: !archived && type === 'INCOMING' && (actor.isManager || actor.matrix.canEdit || openReferral || l.ownerUserId === actor.userId) && canTransition(type, status, 'close'),
      canReopen: !archived && (actor.isManager || actor.matrix.canEdit) && canTransition(type, status, 'reopen'),
      canArchive: !archived && isArchivable(type, status) && (actor.isManager || actor.matrix.canEdit),
      canUnarchive: archived && (actor.isManager || actor.matrix.canEdit),
      canFollowup: type === 'INCOMING' && status !== 'VOID' && (actor.isManager || actor.matrix.canEdit || (actor.matrix.canCreate && participant)),
      canViewEvidence: actor.isManager || actor.matrix.canViewAll,
    };
  }

  async getDetail(ctx: TenantRequestContext, actor: CorrActor, id: string) {
    const visible = this.core.visibleWhere(actor);
    const letter = await ctx.tenantDb.corrLetter.findFirst({
      where: combineWhere({ id }, visible) as Prisma.CorrLetterWhereInput,
      include: {
        category: { select: { id: true, name: true, code: true } },
        referrals: { orderBy: { seq: 'asc' } },
        paraphs: { orderBy: { order: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
        participants: true,
        deliveries: { orderBy: { createdAt: 'asc' } },
        reviews: { orderBy: { order: 'asc' } },
      },
    });
    if (!letter) throw new NotFoundException('نامه یافت نشد');
    const userIds = [...new Set(letter.participants.map((p) => p.userId))];
    const users = userIds.length ? await ctx.tenantDb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const [replyTo, replies, correctionOf, corrections, attachmentCount] = await Promise.all([
      letter.replyToLetterId
        ? ctx.tenantDb.corrLetter.findFirst({ where: combineWhere({ id: letter.replyToLetterId }, visible) as Prisma.CorrLetterWhereInput, select: { id: true, type: true, subject: true, letterNumber: true, status: true } })
        : null,
      ctx.tenantDb.corrLetter.findMany({ where: combineWhere({ replyToLetterId: id }, visible) as Prisma.CorrLetterWhereInput, select: { id: true, type: true, subject: true, letterNumber: true, status: true }, take: 50 }),
      letter.correctionOfLetterId
        ? ctx.tenantDb.corrLetter.findFirst({ where: combineWhere({ id: letter.correctionOfLetterId }, visible) as Prisma.CorrLetterWhereInput, select: { id: true, subject: true, letterNumber: true, status: true } })
        : null,
      ctx.tenantDb.corrLetter.findMany({ where: combineWhere({ correctionOfLetterId: id }, visible) as Prisma.CorrLetterWhereInput, select: { id: true, subject: true, letterNumber: true, status: true }, take: 20 }),
      ctx.tenantDb.attachment.count({ where: { entityType: 'Letter', entityId: id } }),
    ]);
    const participant = !!actor.userId && (letter.createdByUserId === actor.userId || letter.ownerUserId === actor.userId || letter.signerUserId === actor.userId || letter.participants.some((p) => p.userId === actor.userId));
    const openReferral = !!actor.userId && letter.referrals.some((r) => r.toUserId === actor.userId && ['PENDING', 'SEEN'].includes(r.status));
    const openReview = !!actor.userId && letter.reviews.some((r) => r.reviewerUserId === actor.userId && r.status === 'PENDING');
    const snapshot = letter.pdfSnapshotAttachmentId;
    const { verifyTokenHash: _omit, ...safe } = letter;
    void _omit;
    return {
      ...safe,
      participants: letter.participants.map((p) => ({ ...p, name: nameOf.get(p.userId) ?? null })),
      replyTo, replies, correctionOf, corrections, attachmentCount, hasSnapshot: !!snapshot,
      flags: this.flags(actor, letter, participant, openReferral, openReview),
    };
  }

  // ── کارتابل و شمارنده‌ها ────────────────────────────────────────────────
  async inbox(ctx: TenantRequestContext, actor: CorrActor, tab: string) {
    const me = actor.userId;
    if (!me) return { items: [] };
    const sel = LIST_SELECT;
    const visible = this.core.visibleWhere(actor);
    const now = new Date();
    switch (tab) {
      case 'signature': {
        const items = await ctx.tenantDb.corrLetter.findMany({ where: combineWhere({ signerUserId: me, status: 'PENDING_SIGNATURE', archivedAt: null }, visible) as Prisma.CorrLetterWhereInput, select: sel, orderBy: { submittedAt: 'asc' }, take: 100 });
        return { items };
      }
      case 'review': {
        const items = await ctx.tenantDb.corrLetter.findMany({ where: combineWhere({ status: 'PENDING_REVIEW', reviews: { some: { reviewerUserId: me, status: 'PENDING' } } }, visible) as Prisma.CorrLetterWhereInput, select: sel, orderBy: { submittedAt: 'asc' }, take: 100 });
        return { items };
      }
      case 'drafts': {
        const items = await ctx.tenantDb.corrLetter.findMany({ where: { createdByUserId: me, status: { in: ['DRAFT', 'RETURNED_FOR_EDIT'] } }, select: sel, orderBy: { updatedAt: 'desc' }, take: 100 });
        return { items };
      }
      case 'overdue': {
        const refs = await ctx.tenantDb.corrReferral.findMany({
          where: { toUserId: me, status: { in: ['PENDING', 'SEEN'] }, dueAt: { lt: now }, kind: 'ACTION', letter: visible as Prisma.CorrLetterWhereInput },
          include: { letter: { select: sel } }, orderBy: { dueAt: 'asc' }, take: 100,
        });
        return { items: refs.map((r) => ({ ...r.letter, referral: { id: r.id, dueAt: r.dueAt, instruction: r.instruction, fromName: r.fromName, status: r.status } })) };
      }
      case 'referrals':
      default: {
        const refs = await ctx.tenantDb.corrReferral.findMany({
          where: { toUserId: me, status: { in: ['PENDING', 'SEEN'] }, letter: visible as Prisma.CorrLetterWhereInput },
          include: { letter: { select: sel } }, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], take: 100,
        });
        return { items: refs.map((r) => ({ ...r.letter, referral: { id: r.id, dueAt: r.dueAt, instruction: r.instruction, fromName: r.fromName, status: r.status, kind: r.kind } })) };
      }
    }
  }

  async counters(ctx: TenantRequestContext, actor: CorrActor) {
    const me = actor.userId;
    const visible = this.core.visibleWhere(actor);
    const now = new Date();
    const v = (w: Where) => combineWhere(w, visible) as Prisma.CorrLetterWhereInput;
    const [pendingSignature, pendingReview, referralsToMe, overdueReferrals, drafts, awaitingIncoming, overdueResponses, unarchivedDone] = await Promise.all([
      me ? ctx.tenantDb.corrLetter.count({ where: v({ signerUserId: me, status: 'PENDING_SIGNATURE', archivedAt: null }) }) : 0,
      me ? ctx.tenantDb.corrLetter.count({ where: v({ status: 'PENDING_REVIEW', reviews: { some: { reviewerUserId: me, status: 'PENDING' } } }) }) : 0,
      me ? ctx.tenantDb.corrReferral.count({ where: { toUserId: me, status: { in: ['PENDING', 'SEEN'] }, letter: visible as Prisma.CorrLetterWhereInput } }) : 0,
      me ? ctx.tenantDb.corrReferral.count({ where: { toUserId: me, status: { in: ['PENDING', 'SEEN'] }, kind: 'ACTION', dueAt: { lt: now }, letter: visible as Prisma.CorrLetterWhereInput } }) : 0,
      me ? ctx.tenantDb.corrLetter.count({ where: { createdByUserId: me, status: { in: ['DRAFT', 'RETURNED_FOR_EDIT'] } } }) : 0,
      ctx.tenantDb.corrLetter.count({ where: v({ type: 'INCOMING', status: { in: ['REGISTERED', 'REFERRED', 'IN_PROGRESS'] }, archivedAt: null }) }),
      ctx.tenantDb.corrLetter.count({ where: v({ responseDueAt: { lt: now }, status: { in: ['REGISTERED', 'REFERRED', 'IN_PROGRESS'] }, archivedAt: null }) }),
      Promise.resolve(0),
    ]);
    void unarchivedDone;
    return { pendingSignature, pendingReview, referralsToMe, overdueReferrals, drafts, awaitingIncoming, overdueResponses };
  }

  /** گزارش تأخیر: وارده‌های بدون پاسخ پس از مهلت + ارجاع‌های معوق (در دامنه‌ی دید). */
  async overdueReport(ctx: TenantRequestContext, actor: CorrActor) {
    const visible = this.core.visibleWhere(actor);
    const now = new Date();
    const [letters, referrals] = await Promise.all([
      ctx.tenantDb.corrLetter.findMany({
        where: combineWhere({ type: 'INCOMING', status: { in: ['REGISTERED', 'REFERRED', 'IN_PROGRESS'] }, responseDueAt: { lt: now }, archivedAt: null }, visible) as Prisma.CorrLetterWhereInput,
        select: LIST_SELECT, orderBy: { responseDueAt: 'asc' }, take: 300,
      }),
      ctx.tenantDb.corrReferral.findMany({
        where: { status: { in: ['PENDING', 'SEEN'] }, kind: 'ACTION', dueAt: { lt: now }, letter: visible as Prisma.CorrLetterWhereInput },
        include: { letter: { select: { id: true, subject: true, letterNumber: true, confidentiality: true, type: true } } }, orderBy: { dueAt: 'asc' }, take: 300,
      }),
    ]);
    return { letters, referrals };
  }

  // ── ابطال/بایگانی ──────────────────────────────────────────────────────
  async voidLetter(ctx: TenantRequestContext, actor: CorrActor, id: string, reason: string) {
    const letter = await this.core.findVisible(ctx, actor, id);
    const type = letter.type as LetterType;
    if (!canTransition(type, letter.status as LetterStatus, 'void')) throw new ConflictException('این نامه قبلاً باطل شده است');
    const isOwnDraft = letter.status === 'DRAFT' && letter.createdByUserId === actor.userId;
    // پس از پیش‌نویس: ابطال فقط مدیر یا امضاکننده؛ بقیه فقط «درخواست ابطال» (رویداد + اعلان به مدیران)
    const preDraft = ['DRAFT', 'PENDING_REVIEW', 'PENDING_SIGNATURE', 'RETURNED_FOR_EDIT', 'REJECTED'].includes(letter.status);
    const isSigner = !!actor.userId && (letter.signerUserId === actor.userId || letter.signedByUserId === actor.userId);
    const mayVoid = actor.isManager || isSigner || (preDraft && (isOwnDraft || actor.matrix.canDelete));
    if (!mayVoid) {
      if (!(actor.matrix.canEdit || actor.matrix.canDelete || letter.createdByUserId === actor.userId)) throw new ForbiddenException('اجازه‌ی ابطال این نامه را ندارید');
      await this.core.logEvent(ctx.tenantDb, id, 'VOID_REQUESTED', actor, reason.trim());
      const mgrs = await getManagerUsers(this.core.controlDbRef, ctx.tenantDb, ctx.tenantId).catch(() => []);
      await this.core.notify(ctx, mgrs.map((m) => m.tenantUserId), 'درخواست ابطال یک نامه ثبت شد', 'correspondence.void_request', letter, actor.userId);
      return { requested: true as const };
    }
    const res = await ctx.tenantDb.$transaction(async (tx) => {
      const r = await tx.corrLetter.updateMany({ where: { id, status: { not: 'VOID' } }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason.trim(), voidedByUserId: actor.userId } });
      if (r.count !== 1) throw new ConflictException('این نامه قبلاً باطل شده است');
      await tx.corrReferral.updateMany({ where: { letterId: id, status: { in: ['PENDING', 'SEEN'] } }, data: { status: 'CANCELLED', completedAt: new Date() } });
      await this.core.logEvent(tx, id, 'VOIDED', actor, reason.trim(), { burnedNumber: letter.letterNumber });
      return tx.corrLetter.findUniqueOrThrow({ where: { id } });
    });
    const recipients = (await ctx.tenantDb.corrParticipant.findMany({ where: { letterId: id }, select: { userId: true } })).map((p) => p.userId);
    await this.core.notify(ctx, recipients, 'نامه باطل شد', 'correspondence.voided', letter, actor.userId);
    return res;
  }

  async archive(ctx: TenantRequestContext, actor: CorrActor, id: string, folderId?: string, retentionUntil?: string) {
    const letter = await this.core.findVisible(ctx, actor, id);
    if (letter.archivedAt) throw new ConflictException('نامه قبلاً بایگانی شده است');
    if (!(actor.isManager || actor.matrix.canEdit)) throw new ForbiddenException('اجازه‌ی بایگانی را ندارید');
    if (!isArchivable(letter.type as LetterType, letter.status as LetterStatus)) throw new BadRequestException('این نامه هنوز در گردش است و بایگانی نمی‌شود');
    let retention: Date | null = retentionUntil ? new Date(retentionUntil) : null;
    if (folderId) {
      const f = await ctx.tenantDb.corrArchiveFolder.findUnique({ where: { id: folderId } });
      if (!f) throw new BadRequestException('پوشه یافت نشد');
      if (!retention && f.retentionDays) retention = new Date(Date.now() + f.retentionDays * 86400_000);
    }
    return ctx.tenantDb.$transaction(async (tx) => {
      const upd = await tx.corrLetter.update({ where: { id }, data: { archivedAt: new Date(), archiveFolderId: folderId ?? null, retentionUntil: retention } });
      await this.core.logEvent(tx, id, 'ARCHIVED', actor, null, { folderId: folderId ?? null });
      return upd;
    });
  }

  async bulkArchive(ctx: TenantRequestContext, actor: CorrActor, ids: string[], folderId?: string, retentionUntil?: string) {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of [...new Set(ids)].slice(0, 200)) {
      try {
        await this.archive(ctx, actor, id, folderId, retentionUntil);
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: e instanceof Error ? e.message : 'خطا' });
      }
    }
    return { results, archived: results.filter((r) => r.ok).length };
  }

  async unarchive(ctx: TenantRequestContext, actor: CorrActor, id: string) {
    const letter = await this.core.findVisible(ctx, actor, id);
    if (!letter.archivedAt) throw new ConflictException('نامه بایگانی نیست');
    if (!(actor.isManager || actor.matrix.canEdit)) throw new ForbiddenException('اجازه‌ی خارج‌کردن از بایگانی را ندارید');
    return ctx.tenantDb.$transaction(async (tx) => {
      const upd = await tx.corrLetter.update({ where: { id }, data: { archivedAt: null, archiveFolderId: null, retentionUntil: null } });
      await this.core.logEvent(tx, id, 'UNARCHIVED', actor);
      return upd;
    });
  }

  // ── دفتر ثبت (CSV) ─────────────────────────────────────────────────────
  async registerCsv(ctx: TenantRequestContext, actor: CorrActor, filters: LetterFilters & { categoryId?: string }): Promise<string> {
    const f: LetterFilters = { ...filters, archived: filters.archived ?? 'all' };
    if (filters.categoryId) f.categoryIds = await this.settings.descendantIds(ctx, filters.categoryId);
    const where = combineWhere(this.core.visibleWhere(actor), buildLetterFilterWhere(f, actor.userId)) as Prisma.CorrLetterWhereInput;
    const rows = await ctx.tenantDb.corrLetter.findMany({
      where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 20000,
      select: {
        type: true, status: true, letterNumber: true, externalNumber: true, externalDate: true, letterDate: true, registeredAt: true, subject: true,
        senderName: true, senderOrgName: true, recipientsText: true, priority: true, confidentiality: true, responseDueAt: true, createdByName: true,
        voidReason: true, pageCount: true, category: { select: { name: true } },
      },
    });
    const mapped: RegisterRow[] = rows.map((r) => ({ ...r, categoryName: r.category?.name ?? null }));
    return buildRegisterCsv(mapped);
  }

  // ── پاسخ و اصلاحیه ─────────────────────────────────────────────────────
  async createReply(ctx: TenantRequestContext, actor: CorrActor, id: string, type: 'OUTGOING' | 'INTERNAL' = 'OUTGOING') {
    const src = await this.core.findVisible(ctx, actor, id);
    if (src.type !== 'INCOMING') throw new BadRequestException('پاسخ فقط برای نامه‌ی وارده ساخته می‌شود');
    if (src.status === 'VOID') throw new ConflictException('نامه‌ی باطل‌شده پاسخ ندارد');
    const recipients: Recipient[] = [{ name: src.senderOrgName || src.senderName || 'فرستنده', ...(src.senderOrgName && src.senderName ? { title: src.senderName } : {}), ...(src.senderContactId ? { contactId: src.senderContactId } : {}) }];
    const subjectPrefix = 'پاسخ به: ';
    return this.createDraft(ctx, actor, {
      type, subject: src.subject.startsWith(subjectPrefix) ? src.subject : subjectPrefix + src.subject, recipients,
      categoryId: src.categoryId ?? undefined, priority: src.priority, confidentiality: src.confidentiality, replyToLetterId: src.id,
      attachmentsText: undefined, relatedContactId: src.relatedContactId ?? undefined, relatedProjectId: src.relatedProjectId ?? undefined,
      relatedContractId: src.relatedContractId ?? undefined, relatedInvoiceId: src.relatedInvoiceId ?? undefined,
      bodyHtml: `<p>در پاسخ به نامه‌ی شماره ${src.externalNumber ?? ''} مورخ ${src.externalDate ? src.externalDate.toISOString().slice(0, 10) : ''}</p>`,
    } as CreateLetterDto);
  }

  /** «اصلاحیه»: نامه‌ی جدید با ارجاع به نامه‌ی امضاشده‌ی اصلی؛ اصلی دست‌نخورده می‌ماند. */
  async createCorrection(ctx: TenantRequestContext, actor: CorrActor, id: string) {
    this.core.assertCreate(actor);
    const src = await this.core.findVisible(ctx, actor, id);
    if (!canCreateCorrection(src.type as LetterType, src.status as LetterStatus)) throw new ConflictException('فقط برای نامه‌ی صادرشده می‌توان اصلاحیه ساخت');
    return ctx.tenantDb.$transaction(async (tx) => {
      const body = sanitizeBody(`<p>پیرو نامه‌ی شماره ${src.letterNumber ?? ''}، اصلاحیه به شرح زیر اعلام می‌گردد:</p>${src.bodyHtml}`);
      const letter = await tx.corrLetter.create({
        data: {
          type: src.type, status: 'DRAFT', subject: `اصلاحیه: ${src.subject}`.slice(0, 300), ...body, recipients: src.recipients as Prisma.InputJsonValue,
          recipientsText: src.recipientsText, ccNames: src.ccNames, categoryId: src.categoryId, priority: src.priority, confidentiality: src.confidentiality,
          letterDate: new Date(), letterheadId: src.letterheadId, templateId: src.templateId, correctionOfLetterId: src.id, replyToLetterId: src.replyToLetterId,
          relatedContactId: src.relatedContactId, relatedProjectId: src.relatedProjectId, relatedContractId: src.relatedContractId, relatedInvoiceId: src.relatedInvoiceId,
          tags: src.tags, createdByUserId: actor.userId, createdByName: actor.name, ownerUserId: actor.userId,
        },
      });
      await this.core.addParticipant(tx, letter.id, actor.userId, 'CREATOR');
      await this.core.logEvent(tx, letter.id, 'CREATED', actor, `اصلاحیه‌ی نامه ${src.letterNumber ?? ''}`, { correctionOf: src.id });
      await this.core.logEvent(tx, src.id, 'CORRECTION_CREATED', actor, null, { correctionLetterId: letter.id });
      return letter;
    });
  }

  async reopen(ctx: TenantRequestContext, actor: CorrActor, id: string, note?: string) {
    const letter = await this.core.findVisible(ctx, actor, id);
    const to = nextStatus(letter.type as LetterType, letter.status as LetterStatus, 'reopen');
    if (!to) throw new ConflictException('در این وضعیت بازگشایی ممکن نیست');
    if (!(actor.isManager || actor.matrix.canEdit || (letter.status === 'REJECTED' && letter.createdByUserId === actor.userId))) throw new ForbiddenException('اجازه‌ی بازگشایی را ندارید');
    if (letter.archivedAt) throw new ConflictException('ابتدا از بایگانی خارج کنید');
    return ctx.tenantDb.$transaction(async (tx) => {
      const u = await tx.corrLetter.update({ where: { id }, data: { status: to, closedAt: null, answeredAt: letter.type === 'INCOMING' ? null : undefined } });
      await this.core.logEvent(tx, id, 'REOPENED', actor, note ?? null, { from: letter.status, to });
      return u;
    });
  }

  async closeIncoming(ctx: TenantRequestContext, actor: CorrActor, id: string, note?: string) {
    const letter = await this.core.findVisible(ctx, actor, id);
    const to = nextStatus(letter.type as LetterType, letter.status as LetterStatus, 'close');
    if (!to) throw new ConflictException('در این وضعیت امکان مختومه‌کردن نیست');
    const hasOpenRef = !!actor.userId && !!(await ctx.tenantDb.corrReferral.findFirst({ where: { letterId: id, toUserId: actor.userId, status: { in: ['PENDING', 'SEEN'] } }, select: { id: true } }));
    if (!(actor.isManager || actor.matrix.canEdit || hasOpenRef || letter.ownerUserId === actor.userId)) throw new ForbiddenException('اجازه‌ی مختومه‌کردن را ندارید');
    return ctx.tenantDb.$transaction(async (tx) => {
      const u = await tx.corrLetter.update({ where: { id }, data: { status: to, closedAt: new Date() } });
      await tx.corrReferral.updateMany({ where: { letterId: id, status: { in: ['PENDING', 'SEEN'] } }, data: { status: 'CANCELLED', completedAt: new Date() } });
      await this.core.logEvent(tx, id, 'CLOSED', actor, note ?? null);
      return u;
    });
  }

  /** فهرست کاربران برای انتخاب امضاکننده/گیرنده‌ی ارجاع (فقط نام و سمت؛ بدون تماس). */
  async people(ctx: TenantRequestContext, restrictToAccessible = false) {
    const [users, access] = await Promise.all([
      ctx.tenantDb.user.findMany({ where: { NOT: { status: 'DISABLED' } }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 1000 }),
      this.core.usersWithModuleAccess(ctx),
    ]);
    const emps = await ctx.tenantDb.employee.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, position: true } });
    const pos = new Map(emps.map((e) => [e.userId, e.position]));
    const all = users.map((u) => ({ id: u.id, name: u.name, title: pos.get(u.id) ?? null, hasAccess: access.has(u.id) }));
    // «فقط خودم»: فهرست کامل کاربران نشت نکند؛ فقط افراد قابل‌انتخاب (دارای دسترسی به ماژول)
    return restrictToAccessible ? all.filter((u) => u.hasAccess) : all;
  }
}
