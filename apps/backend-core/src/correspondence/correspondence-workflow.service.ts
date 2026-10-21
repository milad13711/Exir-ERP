import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { Prisma } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { SignatureEvidenceService } from '../common/signature-evidence/signature-evidence.service.js';
import { hashContent } from '../common/signature-evidence/signature-evidence.util.js';
import { CompanyStampService } from '../settings/company-stamp.service.js';
import { CorrespondenceCoreService, type CorrActor } from './correspondence-core.service.js';
import { CorrespondenceSignatureService } from './correspondence-signature.service.js';
import { freezeSignatureBlock } from './signature-block.js';
import { CorrespondenceNumberingService } from './correspondence-numbering.service.js';
import { CorrespondenceRenderService } from './correspondence-render.service.js';
import { EVIDENCE_ENTITY, RECEIPT_ATTACHMENT_ENTITY, SNAPSHOT_ATTACHMENT_ENTITY, type LetterStatus, type LetterType } from './correspondence.constants.js';
import type { MarkDeliveredDto, MarkSentDto, ReviewDecisionDto, SignDto, SubmitDto } from './dto/correspondence.dto.js';
import { canTransition, nextStatus } from './letter-state.js';
import { deriveVerifyToken, hashVerifyToken } from './verify-token.js';
import { PdfCache } from './pdf/token-bucket.js';
import { letterHtmlToText } from './pdf/sanitize-letter-html.js';

const PDF_PREFIX = 'data:application/pdf;base64,';
const CHANGED_MSG = 'نامه در حین امضا تغییر کرد یا هم‌زمان امضا شد؛ صفحه را بازآوری و دوباره بررسی کنید';

/** محتوای قانونی-قابل‌اتکای نامه که هش امضا روی آن بسته می‌شود (پایدار، بدون فیلدهای گذرا). */
export function canonicalLetterContent(
  l: { id: string; type: string; letterNumber: string | null; subject: string; bodyHtml: string; recipients: unknown; ccNames: string[]; categoryId: string | null; priority: string; confidentiality: string; replyToLetterId: string | null; attachmentsText: string | null; signatureBlock?: unknown },
  date: Date | null,
  signer: { userId: string | null; name: string },
  paraphs: { authorName: string; text: string; order: number }[],
  attachments: { id: string; title: string }[],
) {
  return {
    v: 1, id: l.id, type: l.type, number: l.letterNumber, date: date ? date.toISOString() : null, subject: l.subject, bodyHtml: l.bodyHtml,
    recipients: l.recipients, ccNames: l.ccNames, categoryId: l.categoryId, priority: l.priority, confidentiality: l.confidentiality,
    replyTo: l.replyToLetterId, attachmentsText: l.attachmentsText, signatureBlock: l.signatureBlock ?? null, signer, paraphs, attachments,
  };
}

@Injectable()
export class CorrespondenceWorkflowService {
  private readonly logger = new Logger('CorrespondenceWorkflow');
  /** کش کوتاه‌مدت PDF زنده (فشار روی Chromium را کم می‌کند؛ دسترسی پیش از کش بررسی می‌شود) */
  private readonly cache = new PdfCache(60_000);

  constructor(
    private readonly core: CorrespondenceCoreService,
    private readonly numbering: CorrespondenceNumberingService,
    private readonly render: CorrespondenceRenderService,
    private readonly evidence: SignatureEvidenceService,
    private readonly stamps: CompanyStampService,
    private readonly signatures: CorrespondenceSignatureService,
  ) {}

  /** تعیین امضاکننده/بازبین فقط وقتی معنا دارد که کاربر به ماژول دسترسی دارد. */
  private async assertUsersCanAccess(ctx: TenantRequestContext, userIds: string[], what: string) {
    const ok = await this.core.usersWithModuleAccess(ctx);
    const bad = userIds.filter((u) => !ok.has(u));
    if (bad.length) {
      const names = await ctx.tenantDb.user.findMany({ where: { id: { in: bad } }, select: { name: true } });
      throw new BadRequestException(`${what} به ماژول مکاتبات دسترسی ندارد: ${names.map((n) => n.name).join('، ')}`);
    }
  }

  // ── ارجاع برای امضا ────────────────────────────────────────────────────
  async submit(ctx: TenantRequestContext, actor: CorrActor, id: string, dto: SubmitDto) {
    const letter = await this.core.findVisible(ctx, actor, id);
    const type = letter.type as LetterType;
    const status = letter.status as LetterStatus;
    if (!canTransition(type, status, 'submit')) throw new ConflictException('در این وضعیت امکان ارجاع برای امضا نیست');
    if (!this.core.canMutateContent(actor, letter)) throw new ForbiddenException('اجازه‌ی ارسال این نامه برای امضا را ندارید');
    if (letter.archivedAt) throw new ConflictException('نامه‌ی بایگانی‌شده ارسال نمی‌شود');
    const problems: string[] = [];
    if (!letter.subject.trim()) problems.push('موضوع نامه خالی است');
    if (!letterHtmlToText(letter.bodyHtml).trim()) problems.push('متن نامه خالی است');
    const recips = Array.isArray(letter.recipients) ? letter.recipients : [];
    if (type === 'OUTGOING' && recips.length === 0) problems.push('گیرنده‌ی نامه مشخص نیست');
    if (problems.length) throw new BadRequestException(problems.join('؛ '));
    const reviewerIds = [...new Set(dto.reviewerUserIds ?? [])].filter((r) => r !== dto.signerUserId);
    const signer = await ctx.tenantDb.user.findUnique({ where: { id: dto.signerUserId }, select: { id: true, name: true } });
    if (!signer) throw new BadRequestException('امضاکننده یافت نشد');
    await this.assertUsersCanAccess(ctx, [signer.id, ...reviewerIds], 'کاربر انتخاب‌شده');
    const reviewers = reviewerIds.length ? await ctx.tenantDb.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } }) : [];
    if (reviewers.length !== reviewerIds.length) throw new BadRequestException('یکی از بازبین‌ها یافت نشد');
    const to = nextStatus(type, status, reviewers.length ? 'submit_review' : 'submit')!;

    const upd = await ctx.tenantDb.$transaction(async (tx) => {
      const r = await tx.corrLetter.updateMany({ where: { id, status: { in: ['DRAFT', 'RETURNED_FOR_EDIT'] } }, data: { status: to, signerUserId: signer.id, submittedAt: new Date(), lastReturnNote: null } });
      if (r.count !== 1) throw new ConflictException('وضعیت نامه در همین فاصله تغییر کرد');
      await tx.corrLetterReview.deleteMany({ where: { letterId: id } });
      let order = 0;
      for (const rv of reviewers) await tx.corrLetterReview.create({ data: { letterId: id, reviewerUserId: rv.id, reviewerName: rv.name, order: ++order } });
      await this.core.addParticipant(tx, id, signer.id, 'SIGNER');
      for (const rv of reviewers) await this.core.addParticipant(tx, id, rv.id, 'REVIEWER');
      await this.core.logEvent(tx, id, 'SUBMITTED', actor, dto.note ?? null, { signerUserId: signer.id, signerName: signer.name, reviewerIds, to });
      return tx.corrLetter.findUniqueOrThrow({ where: { id } });
    });
    if (reviewers.length) await this.core.notify(ctx, reviewers.map((r) => r.id), 'نامه‌ای برای بازبینی شما ارسال شد', 'correspondence.review', letter, actor.userId);
    else await this.core.notify(ctx, [signer.id], 'نامه‌ای برای امضای شما ارسال شد', 'correspondence.sign', letter, actor.userId);
    return upd;
  }

  async review(ctx: TenantRequestContext, actor: CorrActor, id: string, dto: ReviewDecisionDto) {
    const letter = await this.core.findVisible(ctx, actor, id);
    if (letter.status !== 'PENDING_REVIEW') throw new ConflictException('این نامه در مرحله‌ی بازبینی نیست');
    if (!actor.userId) throw new ForbiddenException('بازبین باید کاربر سامانه باشد');
    if (dto.decision === 'CHANGES' && !dto.note?.trim()) throw new BadRequestException('دلیل درخواست اصلاح را بنویسید');
    const res = await ctx.tenantDb.$transaction(async (tx) => {
      const mine = await tx.corrLetterReview.updateMany({
        where: { letterId: id, reviewerUserId: actor.userId!, status: 'PENDING' },
        data: { status: dto.decision === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED', note: dto.note?.trim() || null, decidedAt: new Date() },
      });
      if (mine.count !== 1) throw new ForbiddenException('بازبینی این نامه به شما سپرده نشده یا قبلاً ثبت شده است');
      await this.core.logEvent(tx, id, 'REVIEWED', actor, dto.note?.trim() || null, { decision: dto.decision });
      if (dto.decision === 'CHANGES') {
        await tx.corrLetter.update({ where: { id }, data: { status: 'RETURNED_FOR_EDIT', lastReturnNote: dto.note!.trim() } });
        return 'returned' as const;
      }
      const pending = await tx.corrLetterReview.count({ where: { letterId: id, status: { not: 'APPROVED' } } });
      if (pending === 0) {
        await tx.corrLetter.update({ where: { id }, data: { status: 'PENDING_SIGNATURE' } });
        return 'to_signature' as const;
      }
      return 'waiting' as const;
    });
    if (res === 'returned') await this.core.notify(ctx, [letter.createdByUserId], 'نامه‌ی شما برای اصلاح برگشت خورد', 'correspondence.returned', letter, actor.userId);
    if (res === 'to_signature') await this.core.notify(ctx, [letter.signerUserId], 'نامه‌ای برای امضای شما آماده است', 'correspondence.sign', letter, actor.userId);
    return { result: res };
  }

  private assertSigner(actor: CorrActor, letter: { signerUserId: string | null }) {
    if (!actor.userId) throw new ForbiddenException('امضا فقط برای کاربر سامانه ممکن است');
    if (!(actor.isOwner || letter.signerUserId === actor.userId)) throw new ForbiddenException('فقط امضاکننده‌ی تعیین‌شده می‌تواند این نامه را امضا یا برگشت دهد');
  }

  async returnForEdit(ctx: TenantRequestContext, actor: CorrActor, id: string, note: string) {
    const letter = await this.core.findVisible(ctx, actor, id);
    this.assertSigner(actor, letter);
    if (!canTransition(letter.type as LetterType, letter.status as LetterStatus, 'return')) throw new ConflictException('در این وضعیت امکان برگشت نیست');
    const u = await ctx.tenantDb.$transaction(async (tx) => {
      const r = await tx.corrLetter.updateMany({ where: { id, status: { in: ['PENDING_SIGNATURE', 'PENDING_REVIEW'] } }, data: { status: 'RETURNED_FOR_EDIT', lastReturnNote: note.trim() } });
      if (r.count !== 1) throw new ConflictException('وضعیت نامه در همین فاصله تغییر کرد');
      await this.core.logEvent(tx, id, 'RETURNED', actor, note.trim());
      return tx.corrLetter.findUniqueOrThrow({ where: { id } });
    });
    await this.core.notify(ctx, [letter.createdByUserId], 'نامه‌ی شما برای اصلاح برگشت خورد', 'correspondence.returned', letter, actor.userId);
    return u;
  }

  async reject(ctx: TenantRequestContext, actor: CorrActor, id: string, note: string) {
    const letter = await this.core.findVisible(ctx, actor, id);
    this.assertSigner(actor, letter);
    if (!canTransition(letter.type as LetterType, letter.status as LetterStatus, 'reject')) throw new ConflictException('در این وضعیت امکان رد نیست');
    const u = await ctx.tenantDb.$transaction(async (tx) => {
      const r = await tx.corrLetter.updateMany({ where: { id, status: { in: ['PENDING_SIGNATURE', 'PENDING_REVIEW'] } }, data: { status: 'REJECTED', lastReturnNote: note.trim() } });
      if (r.count !== 1) throw new ConflictException('وضعیت نامه در همین فاصله تغییر کرد');
      await this.core.logEvent(tx, id, 'REJECTED', actor, note.trim());
      return tx.corrLetter.findUniqueOrThrow({ where: { id } });
    });
    await this.core.notify(ctx, [letter.createdByUserId], 'نامه‌ی شما رد شد', 'correspondence.rejected', letter, actor.userId);
    return u;
  }

  // ── امضا و صدور ────────────────────────────────────────────────────────
  /**
   * امضا: (۱) تراکنش کوتاه: تخصیص اتمیک شماره؛ (۲) رندر PDF بیرون از تراکنش (قفل شمارنده طولانی نشود)؛
   * (۳) تراکنش نهایی: وضعیت ISSUED + اسنپ‌شات تغییرناپذیر + رویدادها. اگر رندر شکست بخورد شماره روی نامه می‌ماند و
   * تلاش مجدد همان را استفاده می‌کند (فاصله‌ی ناخواسته در دنباله نمی‌افتد). مدرک امضا پس از commit ثبت می‌شود.
   */
  async sign(ctx: TenantRequestContext, actor: CorrActor, id: string, dto: SignDto, req: Request) {
    if (!dto.confirm) throw new BadRequestException('برای امضا باید تأیید صریح بدهید');
    const letter0 = await this.core.findVisible(ctx, actor, id);
    this.assertSigner(actor, letter0);
    const type = letter0.type as LetterType;
    if (!canTransition(type, letter0.status as LetterStatus, 'sign')) throw new ConflictException('این نامه در انتظار امضا نیست');
    if (letter0.archivedAt) throw new ConflictException('نامه‌ی بایگانی‌شده امضا نمی‌شود');
    let useStamp = false;
    if (dto.useStamp) {
      await this.stamps.assertCanUse(ctx); // فقط مالک یا نماینده‌ی مهر
      useStamp = true;
    }
    const brief = await this.core.userBrief(ctx.tenantDb, actor.userId!);
    const now = new Date();

    // فاز ۱
    const letter = await ctx.tenantDb.$transaction(async (tx) => {
      const fresh = await tx.corrLetter.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== 'PENDING_SIGNATURE') throw new ConflictException('این نامه در انتظار امضا نیست');
      if (fresh.revisionNo !== letter0.revisionNo || fresh.bodyHtml !== letter0.bodyHtml || fresh.subject !== letter0.subject) throw new ConflictException(CHANGED_MSG);
      if (!actor.isOwner && fresh.signerUserId !== actor.userId) throw new ForbiddenException('امضاکننده‌ی نامه تغییر کرده است');
      if (fresh.letterNumber) return fresh; // تلاش مجدد پس از شکست رندر
      const num = await this.numbering.issue(tx, type, now, fresh.categoryId);
      const claimed = await tx.corrLetter.updateMany({
        where: { id, status: 'PENDING_SIGNATURE', letterNumber: null, revisionNo: letter0.revisionNo, ...(actor.isOwner ? {} : { signerUserId: actor.userId }) },
        data: { letterNumber: num.number, numberingSchemeId: num.schemeId, numberPeriodKey: num.periodKey, numberSeq: num.seq, issuedAt: now },
      });
      if (claimed.count !== 1) throw new ConflictException('امضای هم‌زمان؛ دوباره تلاش کنید'); // تراکنش رول‌بک → شماره مصرف نمی‌شود
      return tx.corrLetter.findUniqueOrThrow({ where: { id } });
    });
    const issuedAt = letter.issuedAt ?? now;

    // فاز ۲ (بیرون از تراکنش)
    const [paraphs, atts] = await Promise.all([
      ctx.tenantDb.corrParaph.findMany({ where: { letterId: id }, orderBy: { order: 'asc' } }),
      ctx.tenantDb.attachment.findMany({ where: { entityType: 'Letter', entityId: id }, select: { id: true, title: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    // بلوک امضا همین‌جا نهایی و ثابت می‌شود (فیلدها + دو خط متن)؛ پس از امضا از تنظیمات خوانده نمی‌شود
    const frozen = freezeSignatureBlock(await this.signatures.resolve(ctx, actor.userId, letter.signatureBlock, { name: brief.name, title: brief.title }));
    const forRender = { ...letter, letterDate: issuedAt, signatureBlock: frozen };
    const input = await this.render.build(ctx, forRender, {
      paraphs, attachmentTitles: atts.map((a) => a.title), watermark: null, withQr: true, senderTitle: brief.title,
      signature: { signerName: brief.name, signerTitle: brief.title, signedAt: now, useStamp },
    });
    let pdf: Buffer;
    try {
      pdf = await this.render.render(input, ctx, true); // slot رزرو مخصوص امضا
    } catch (e) {
      this.logger.error(`sign render failed for ${id}: ${e instanceof Error ? e.message : e}`);
      // شماره روی نامه می‌ماند و تلاش بعدی همان را استفاده می‌کند
      throw new ServiceUnavailableException(`ساخت PDF امضا ناموفق بود؛ نامه هنوز امضا نشده است و شماره‌ی ${letter.letterNumber} برایش محفوظ مانده است. چند لحظه بعد دوباره «امضا» را بزنید.`);
    }
    const pdfSha = createHash('sha256').update(pdf).digest('hex');
    const token = deriveVerifyToken(ctx.tenantId, id);
    const contentHash = hashContent(
      canonicalLetterContent(forRender, issuedAt, { userId: actor.userId, name: brief.name }, paraphs.map((p) => ({ authorName: p.authorName, text: p.text, order: p.order })), atts),
    );

    // فاز ۳
    const final = await ctx.tenantDb.$transaction(async (tx) => {
      const claimed = await tx.corrLetter.updateMany({
        where: { id, status: 'PENDING_SIGNATURE', revisionNo: letter0.revisionNo, subject: letter0.subject, bodyHtml: letter0.bodyHtml, ...(actor.isOwner ? {} : { signerUserId: actor.userId }) },
        data: { status: 'ISSUED', signedAt: now, signedByUserId: actor.userId, signerName: brief.name, signerTitle: brief.title, letterDate: issuedAt, signatureBlock: frozen as Prisma.InputJsonValue, contentHash, verifyTokenHash: hashVerifyToken(token), pdfSnapshotSha256: pdfSha },
      });
      if (claimed.count !== 1) throw new ConflictException(CHANGED_MSG);
      const att = await tx.attachment.create({
        data: { entityType: SNAPSHOT_ATTACHMENT_ENTITY, entityId: id, title: `نامه ${letter.letterNumber ?? ''} (امضاشده).pdf`.slice(0, 200), fileUrl: PDF_PREFIX + pdf.toString('base64'), createdByUserId: actor.userId },
      });
      await tx.corrLetter.update({ where: { id }, data: { pdfSnapshotAttachmentId: att.id } });
      await this.core.addParticipant(tx, id, actor.userId, 'SIGNER');
      await this.core.logEvent(tx, id, 'SIGNED', { userId: actor.userId, name: brief.name }, null, { useStamp, pdfSha256: pdfSha, contentHash });
      await this.core.logEvent(tx, id, 'ISSUED', { userId: actor.userId, name: brief.name }, null, { number: letter.letterNumber });
      // نامه‌ی داخلی: گیرندگان سامانه‌ای دید می‌گیرند
      if (type === 'INTERNAL') {
        const rs = (Array.isArray(letter.recipients) ? letter.recipients : []) as { userId?: string }[];
        for (const r of rs) if (r.userId) await this.core.addParticipant(tx, id, r.userId, 'CC');
      }
      // پاسخ به وارده → وارده «پاسخ داده شده» می‌شود
      if (letter.replyToLetterId) {
        const src = await tx.corrLetter.findUnique({ where: { id: letter.replyToLetterId }, select: { type: true, status: true, id: true } });
        if (src?.type === 'INCOMING') {
          const to = nextStatus('INCOMING', src.status as LetterStatus, 'answer');
          if (to) {
            await tx.corrLetter.update({ where: { id: src.id }, data: { status: to, answeredAt: now } });
            await this.core.logEvent(tx, src.id, 'ANSWERED', { userId: actor.userId, name: brief.name }, null, { replyLetterId: id, replyNumber: letter.letterNumber });
          }
        }
      }
      return tx.corrLetter.findUniqueOrThrow({ where: { id } });
    });

    const evidenceRow = await this.evidence.tryRecord(ctx, {
      entityType: EVIDENCE_ENTITY, entityId: id, action: 'sign', signerName: brief.name, signerUserId: actor.userId ?? undefined,
      signerRole: actor.isOwner ? 'OWNER' : actor.isAdmin ? 'ADMIN' : 'SIGNER', contentHash, req, clientEvidence: dto.evidence,
      signatureData: input.signature?.imageDataUri ?? undefined,
    });
    if (!evidenceRow) {
      // نامه امضا شد ولی مدرک ثبت نشد → رویداد برای هشدار به مدیر (cron) و پیگیری
      await this.core.logEvent(ctx.tenantDb, id, 'EVIDENCE_PENDING', actor, null, { contentHash }).catch(() => undefined);
    }
    const internalRecipients = type === 'INTERNAL' ? ((Array.isArray(final.recipients) ? final.recipients : []) as { userId?: string }[]).map((r) => r.userId) : [];
    await this.core.notify(ctx, [final.createdByUserId, ...internalRecipients], 'نامه امضا و شماره‌گذاری شد', 'correspondence.issued', final, actor.userId);
    return final;
  }

  // ── ارسال و تحویل ──────────────────────────────────────────────────────
  async markSent(ctx: TenantRequestContext, actor: CorrActor, id: string, dto: MarkSentDto) {
    const letter = await this.core.findVisible(ctx, actor, id);
    if (!canTransition(letter.type as LetterType, letter.status as LetterStatus, 'send')) throw new ConflictException('فقط نامه‌ی صادره‌ی امضاشده ارسال می‌شود');
    if (!this.core.canMutateContent(actor, letter) && !actor.matrix.canEdit) throw new ForbiddenException('اجازه‌ی ثبت ارسال را ندارید');
    const sentAt = dto.sentAt ? new Date(dto.sentAt) : new Date();
    return ctx.tenantDb.$transaction(async (tx) => {
      const r = await tx.corrLetter.updateMany({ where: { id, status: 'ISSUED' }, data: { status: 'SENT' } });
      if (r.count !== 1) throw new ConflictException('وضعیت نامه در همین فاصله تغییر کرد');
      await tx.corrDelivery.create({ data: { letterId: id, method: dto.method, recipientName: dto.recipientName ?? null, sentAt, trackingCode: dto.trackingCode ?? null, note: dto.note ?? null, createdByUserId: actor.userId } });
      await this.core.logEvent(tx, id, 'SENT', actor, dto.note ?? null, { method: dto.method, trackingCode: dto.trackingCode ?? null });
      return tx.corrLetter.findUniqueOrThrow({ where: { id } });
    });
  }

  async markDelivered(ctx: TenantRequestContext, actor: CorrActor, id: string, dto: MarkDeliveredDto) {
    const letter = await this.core.findVisible(ctx, actor, id);
    if (!canTransition(letter.type as LetterType, letter.status as LetterStatus, 'deliver')) throw new ConflictException('در این وضعیت ثبت تحویل ممکن نیست');
    if (!this.core.canMutateContent(actor, letter) && !actor.matrix.canEdit) throw new ForbiddenException('اجازه‌ی ثبت تحویل را ندارید');
    if (dto.receiptAttachmentId) {
      const a = await ctx.tenantDb.attachment.findFirst({ where: { id: dto.receiptAttachmentId, entityType: RECEIPT_ATTACHMENT_ENTITY, entityId: id }, select: { id: true } });
      if (!a) throw new BadRequestException('فایل رسید باید ابتدا به همین نامه پیوست شود');
    }
    const at = dto.deliveredAt ? new Date(dto.deliveredAt) : new Date();
    return ctx.tenantDb.$transaction(async (tx) => {
      const r = await tx.corrLetter.updateMany({ where: { id, status: letter.status }, data: { status: 'DELIVERED' } });
      if (r.count !== 1) throw new ConflictException('وضعیت نامه در همین فاصله تغییر کرد');
      const last = await tx.corrDelivery.findFirst({ where: { letterId: id, deliveredAt: null }, orderBy: { createdAt: 'desc' } });
      const receipt = dto.receiptAttachmentId ? { receiptReceivedAt: at, receiptAttachmentId: dto.receiptAttachmentId } : {};
      if (last) await tx.corrDelivery.update({ where: { id: last.id }, data: { deliveredAt: at, ...receipt, note: dto.note ?? last.note } });
      else await tx.corrDelivery.create({ data: { letterId: id, method: 'SYSTEM', deliveredAt: at, ...receipt, note: dto.note ?? null, createdByUserId: actor.userId } });
      await this.core.logEvent(tx, id, 'DELIVERED', actor, dto.note ?? null);
      if (dto.receiptAttachmentId) await this.core.logEvent(tx, id, 'RECEIPT_RECEIVED', actor, null, { attachmentId: dto.receiptAttachmentId });
      return tx.corrLetter.findUniqueOrThrow({ where: { id } });
    });
  }

  // ── PDF ────────────────────────────────────────────────────────────────
  /** PDF نامه: اسنپ‌شات امضاشده‌ی تغییرناپذیر (پیش‌فرض)، یا بازتولید زنده با پاراف‌های تازه / واترمارک پیش‌نویس و باطل. */
  async pdfFor(ctx: TenantRequestContext, actor: CorrActor, id: string, opts: { withParaphs?: boolean }): Promise<{ buffer: Buffer; filename: string; snapshot: boolean }> {
    const letter = await this.core.findVisible(ctx, actor, id);
    const base = `نامه-${(letter.letterNumber ?? 'پیش‌نویس').replace(/[\\/:*?"<>|]/g, '-')}`;
    if (letter.pdfSnapshotAttachmentId && letter.status !== 'VOID' && !opts.withParaphs) {
      const att = await ctx.tenantDb.attachment.findUnique({ where: { id: letter.pdfSnapshotAttachmentId } });
      if (!att || !att.fileUrl.startsWith(PDF_PREFIX)) throw new NotFoundException('فایل امضاشده یافت نشد');
      const buffer = Buffer.from(att.fileUrl.slice(PDF_PREFIX.length), 'base64');
      if (letter.pdfSnapshotSha256 && createHash('sha256').update(buffer).digest('hex') !== letter.pdfSnapshotSha256) {
        this.logger.error(`snapshot hash mismatch for letter ${id}`);
        throw new ConflictException('یکپارچگی فایل امضاشده تأیید نشد؛ با مدیر سیستم تماس بگیرید');
      }
      return { buffer, filename: `${base}.pdf`, snapshot: true };
    }
    const [paraphs, atts, signedEvent] = await Promise.all([
      ctx.tenantDb.corrParaph.findMany({ where: { letterId: id }, orderBy: { order: 'asc' } }),
      ctx.tenantDb.attachment.findMany({ where: { entityType: 'Letter', entityId: id }, select: { title: true }, orderBy: { createdAt: 'asc' } }),
      ctx.tenantDb.corrEvent.findFirst({ where: { letterId: id, type: 'SIGNED' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const signed = !!letter.signedAt;
    const draftLike = ['DRAFT', 'PENDING_REVIEW', 'PENDING_SIGNATURE', 'RETURNED_FOR_EDIT', 'REJECTED'].includes(letter.status);
    const input = await this.render.build(ctx, letter, {
      paraphs, attachmentTitles: atts.map((a) => a.title), withQr: !!letter.verifyTokenHash,
      watermark: letter.status === 'VOID' ? 'باطل‌شده' : draftLike ? 'پیش‌نویس' : null,
      signature: signed ? { signerName: letter.signerName ?? '', signerTitle: letter.signerTitle, signedAt: letter.signedAt!, useStamp: !!(signedEvent?.meta as { useStamp?: boolean } | null)?.useStamp } : null,
    });
    const cacheKey = `${ctx.tenantId}:${id}:${letter.updatedAt.getTime()}:${letter.status}:${paraphs.length}:${paraphs.at(-1)?.order ?? 0}:${atts.length}:${opts.withParaphs ? 1 : 0}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return { buffer: cached, filename: `${base}.pdf`, snapshot: false };
    const buffer = await this.render.render(input, ctx);
    this.cache.set(cacheKey, buffer);
    return { buffer, filename: `${base}.pdf`, snapshot: false };
  }

  async slipPdf(ctx: TenantRequestContext, actor: CorrActor, id: string, variant: 'slip' | 'label') {
    const letter = await this.core.findVisible(ctx, actor, id);
    if (letter.type !== 'INCOMING' || !letter.letterNumber) throw new BadRequestException('برگ ثبت فقط برای نامه‌ی وارده است');
    const key = `${ctx.tenantId}:slip:${id}:${letter.updatedAt.getTime()}:${variant}`;
    let buffer = this.cache.get(key);
    if (!buffer) {
      buffer = await this.render.renderSlip(ctx, letter, variant);
      this.cache.set(key, buffer);
    }
    return { buffer, filename: `برگ-ثبت-${letter.letterNumber.replace(/[\\/:*?"<>|]/g, '-')}.pdf` };
  }

  /** مدرک‌های امضا (فقط با دسترسی «مشاهده‌ی همه» یا مدیر؛ شامل IP/دستگاه/موقعیت). */
  async evidenceFor(ctx: TenantRequestContext, actor: CorrActor, id: string) {
    await this.core.findVisible(ctx, actor, id);
    if (!(actor.isManager || actor.matrix.canViewAll)) throw new ForbiddenException('مشاهده‌ی مدرک امضا فقط با دسترسی «مشاهده‌ی همه» ممکن است');
    const rows = await this.evidence.listFor(ctx, EVIDENCE_ENTITY, id);
    return rows.map((r) => ({ ...r, integrityOk: this.evidence.verify(r) }));
  }
}
