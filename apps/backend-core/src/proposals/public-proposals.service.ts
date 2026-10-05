import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { getManagerUsers } from '../common/manager-users.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import type { PublicAcceptProposalDto, PublicCommentProposalDto, PublicRejectProposalDto } from './dto/proposal-actions.dto.js';
import {
  CUSTOMER_OPEN_STATUSES,
  VIEW_DEDUPE_MS,
  VIEW_NOTIFY_THROTTLE_MS,
  isProposalExpired,
  maskPhone,
  recordProposalEvent,
} from './proposal.util.js';

export type ClientMeta = { ip?: string; userAgent?: string };
/** ctx ناقصِ بدون کاربر: برای مسیرهای عمومی فقط tenantId/slug/db لازم است. */
export type PublicTenantCtx = { tenantId: string; tenantSlug: string; tenantDb: TenantPrismaClient; tenantName: string };

const SIGNATURE_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const MAX_CUSTOMER_COMMENTS_PER_WINDOW = 5;
const COMMENT_WINDOW_MS = 10 * 60 * 1000;
const MAX_CUSTOMER_COMMENTS_TOTAL = 200;

const SAFE_INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;

/** نوع و اندازه‌ی فایل از روی data URI؛ لینک خارجی هم به‌صورت externalUrl برمی‌گردد. */
export function describeAttachment(fileUrl: string): { mimeType: string | null; sizeBytes: number | null; isImage: boolean; externalUrl: string | null } {
  const m = /^data:([^;,]+)(;base64)?,/.exec(fileUrl);
  if (m) {
    const payloadLen = fileUrl.length - m[0].length;
    const sizeBytes = m[2] ? Math.floor((payloadLen * 3) / 4) : payloadLen;
    return { mimeType: m[1], sizeBytes, isImage: SAFE_INLINE_IMAGE.test(m[1]), externalUrl: null };
  }
  if (/^https?:\/\//i.test(fileUrl)) return { mimeType: null, sizeBytes: null, isImage: false, externalUrl: fileUrl };
  return { mimeType: null, sizeBytes: null, isImage: false, externalUrl: null };
}

/**
 * منطق صفحه‌ی عمومی پروپوزال — فقط با publicToken غیرقابل‌حدس؛ هیچ داخلیاتی (یادداشت داخلی، رویدادها،
 * شناسه‌ی کاربران، سایر مشتری‌ها) برنمی‌گردد.
 */
@Injectable()
export class PublicProposalsService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly notifications: NotificationsService,
    private readonly automation: AutomationEngineService,
  ) {}

  /** `allowDraft`: فقط برای مشاهده/فایل — پیش‌نمایش لینک پیش‌نویس برای خودِ تننت؛ پاسخ مشتری (قبول/رد/نظر) هرگز روی پیش‌نویس مجاز نیست. */
  private async findByToken(t: PublicTenantCtx, token: string, allowDraft = false) {
    // توکن باید یک رشته‌ی معقول باشد (UUID)؛ ورودی‌های عجیب هرگز به پایگاه‌داده نمی‌رسند
    if (!/^[0-9a-fA-F-]{20,64}$/.test(token)) throw new NotFoundException('پروپوزال یافت نشد');
    const proposal = await t.tenantDb.proposal.findUnique({ where: { publicToken: token }, include: { contact: { select: { id: true, name: true, company: true, phone: true } } } });
    if (!proposal || (proposal.status === 'DRAFT' && !allowDraft)) throw new NotFoundException('پروپوزال یافت نشد');
    return this.expireIfNeeded(t, proposal);
  }

  private async expireIfNeeded<P extends { id: string; status: string; validUntil: Date | null; contactId: string; proposalNo: number }>(t: PublicTenantCtx, p: P): Promise<P> {
    if ((CUSTOMER_OPEN_STATUSES as readonly string[]).includes(p.status) && isProposalExpired(p.validUntil)) {
      await t.tenantDb.proposal.update({ where: { id: p.id }, data: { status: 'EXPIRED' } });
      await recordProposalEvent(t.tenantDb, { proposalId: p.id, contactId: p.contactId, proposalNo: p.proposalNo, type: 'EXPIRED', body: 'مهلت اعتبار پروپوزال به پایان رسید' });
      return { ...p, status: 'EXPIRED' };
    }
    return p;
  }

  /** گیرندگان اعلان: ارجاع‌شده + سازنده؛ اگر هیچ‌کدام نبود، مدیران (مالک/ادمین). */
  private async recipients(t: PublicTenantCtx, p: { assignedUserId: string | null; createdByUserId: string | null }): Promise<string[]> {
    const ids = new Set<string>();
    if (p.assignedUserId) ids.add(p.assignedUserId);
    if (p.createdByUserId) ids.add(p.createdByUserId);
    if (ids.size === 0) {
      const managers = await getManagerUsers(this.controlDb, t.tenantDb, t.tenantId).catch(() => []);
      for (const m of managers) ids.add(m.tenantUserId);
    }
    return [...ids];
  }

  private async notify(t: PublicTenantCtx, p: { id: string; assignedUserId: string | null; createdByUserId: string | null }, type: string, title: string, body?: string) {
    for (const userId of await this.recipients(t, p)) {
      await this.notifications.notify(t.tenantDb, { userId, type, title, body, link: `/proposals?id=${p.id}` });
    }
  }

  private async emit(t: PublicTenantCtx, code: string, p: { proposalNo: number; title: string; amount: number; contact: { name: string; phone: string | null }; assignedUserId: string | null; createdByUserId: string | null }, extra: Record<string, string | number | null> = {}) {
    const ctx = { tenantId: t.tenantId, tenantSlug: t.tenantSlug, tenantDb: t.tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
    await this.automation
      .emit(ctx, code, {
        proposalNo: p.proposalNo,
        title: p.title,
        customerName: p.contact.name,
        customerPhone: p.contact.phone,
        amount: p.amount,
        ownerUserId: p.assignedUserId ?? p.createdByUserId,
        ...extra,
      })
      .catch(() => undefined);
  }

  // ── مشاهده ────────────────────────────────────────────────────────────

  async view(t: PublicTenantCtx, token: string, meta: ClientMeta) {
    let p = await this.findByToken(t, token, true);
    const now = new Date();
    const isDraft = p.status === 'DRAFT';

    // ثبت مشاهده با حذف تکرارهای سریع (همان IP + مرورگر در بازه‌ی کوتاه)
    const last = await t.tenantDb.proposalView.findFirst({
      where: { proposalId: p.id, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    // پیش‌نویس هنوز برای مشتری ارسال نشده: بازدید ثبت نمی‌شود و اعلانی نمی‌رود (پیش‌نمایش تننت).
    const isNewView = !isDraft && (!last || now.getTime() - last.createdAt.getTime() > VIEW_DEDUPE_MS);
    if (isNewView) {
      const isFirst = !p.firstViewedAt;
      await t.tenantDb.proposalView.create({ data: { proposalId: p.id, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) } });
      const throttleOk = !p.lastViewNotifiedAt || now.getTime() - p.lastViewNotifiedAt.getTime() > VIEW_NOTIFY_THROTTLE_MS;
      const shouldNotify = isFirst || throttleOk;
      const newStatus = p.status === 'SENT' ? 'VIEWED' : p.status;
      await t.tenantDb.proposal.update({
        where: { id: p.id },
        data: {
          viewCount: { increment: 1 },
          lastViewedAt: now,
          ...(isFirst ? { firstViewedAt: now } : {}),
          ...(newStatus !== p.status ? { status: 'VIEWED' } : {}),
          ...(shouldNotify ? { lastViewNotifiedAt: now } : {}),
        },
      });
      p = { ...p, status: newStatus };
      if (isFirst) {
        await recordProposalEvent(t.tenantDb, { proposalId: p.id, contactId: p.contactId, proposalNo: p.proposalNo, type: 'VIEWED_FIRST', body: 'مشتری برای اولین بار پروپوزال را مشاهده کرد' });
      }
      if (shouldNotify) {
        await this.notify(
          t,
          p,
          'proposals.proposal.viewed',
          isFirst ? `مشتری پروپوزال شماره ${p.proposalNo} را برای اولین بار مشاهده کرد` : `مشتری دوباره پروپوزال شماره ${p.proposalNo} را مشاهده کرد`,
          p.contact.company || p.contact.name,
        );
        if (isFirst) await this.emit(t, 'proposals.proposal.viewed', p);
      }
    }

    const [attachments, comments, logoSetting, phoneSetting, addressSetting] = await Promise.all([
      t.tenantDb.attachment.findMany({ where: { entityType: 'Proposal', entityId: p.id }, orderBy: { createdAt: 'asc' } }),
      t.tenantDb.proposalComment.findMany({ where: { proposalId: p.id }, orderBy: { createdAt: 'asc' }, select: { id: true, authorType: true, authorName: true, kind: true, body: true, createdAt: true } }),
      t.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'general', key: 'logoUrl' } }, select: { value: true } }),
      t.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'general', key: 'phone' } }, select: { value: true } }),
      t.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'general', key: 'address' } }, select: { value: true } }),
    ]);
    const str = (v: { value: unknown } | null) => (typeof v?.value === 'string' && v.value ? v.value : null);

    return {
      seller: { name: t.tenantName, logoUrl: str(logoSetting), phone: str(phoneSetting), address: str(addressSetting) },
      proposalNo: p.proposalNo,
      title: p.title,
      status: p.status,
      isDraft,
      content: p.content,
      durationText: p.durationText,
      amount: p.amount,
      paymentMethodText: p.paymentMethodText,
      paymentTerms: p.paymentTerms,
      paymentDeadline: p.paymentDeadline,
      bankInfo: p.bankInfo,
      issuedAt: p.issuedAt,
      validUntil: p.validUntil,
      expired: p.status === 'EXPIRED',
      contact: { name: p.contact.name, company: p.contact.company, phoneMasked: p.contact.phone ? maskPhone(p.contact.phone) : null },
      acceptedByName: p.status === 'ACCEPTED' ? p.acceptedByName : null,
      acceptedAt: p.status === 'ACCEPTED' ? p.acceptedAt : null,
      attachments: attachments.map((a) => ({ id: a.id, title: a.title, ...describeAttachment(a.fileUrl) })),
      comments,
    };
  }

  /** فایل پیوست (با توکن + شناسه‌ی پیوست همان پروپوزال) — لینک خارجی برای رندر به صفحه‌ی عمومی داده می‌شود، نه proxy. */
  async getFile(t: PublicTenantCtx, token: string, attachmentId: string) {
    const p = await this.findByToken(t, token, true);
    const att = await t.tenantDb.attachment.findFirst({ where: { id: attachmentId, entityType: 'Proposal', entityId: p.id } });
    if (!att) throw new NotFoundException('فایل یافت نشد');
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(att.fileUrl);
    if (!m) throw new NotFoundException('فایل یافت نشد');
    const inline = SAFE_INLINE_IMAGE.test(m[1]);
    return { buffer: Buffer.from(m[2], 'base64'), mimeType: inline ? m[1] : 'application/octet-stream', title: att.title, inline };
  }

  // ── پاسخ مشتری ────────────────────────────────────────────────────────

  private assertAnswerable(p: { status: string; validUntil: Date | null }) {
    if (p.status === 'EXPIRED' || isProposalExpired(p.validUntil)) throw new ForbiddenException('مهلت اعتبار این پروپوزال به پایان رسیده است');
    if (p.status === 'ACCEPTED') throw new ConflictException('این پروپوزال قبلاً پذیرفته شده است');
    if (p.status === 'REJECTED') throw new ConflictException('این پروپوزال قبلاً رد شده است؛ برای تغییر، با ما تماس بگیرید');
    if (!(CUSTOMER_OPEN_STATUSES as readonly string[]).includes(p.status)) throw new ForbiddenException('این پروپوزال در حال حاضر قابل پاسخ نیست');
  }

  async accept(t: PublicTenantCtx, token: string, dto: PublicAcceptProposalDto, meta: ClientMeta) {
    const p = await this.findByToken(t, token);
    this.assertAnswerable(p);
    if (dto.confirmed !== true) throw new BadRequestException('برای پذیرش باید «تمام موارد فوق بررسی و تأیید شد» را تأیید کنید');
    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException('نام و نام خانوادگی را وارد کنید');
    if (!SIGNATURE_PATTERN.test(dto.signatureDataUrl) || dto.signatureDataUrl.length < 200) {
      throw new BadRequestException('امضای الکترونیک معتبر ثبت نشده است');
    }

    const now = new Date();
    // به‌روزرسانی مشروط به وضعیت: دو پاسخ هم‌زمان (یا پذیرش هم‌زمان با رد) فقط یکی برنده می‌شود
    const res = await t.tenantDb.proposal.updateMany({
      where: { id: p.id, status: { in: [...CUSTOMER_OPEN_STATUSES] } },
      data: {
        status: 'ACCEPTED',
        respondedAt: now,
        acceptedAt: now,
        acceptedByName: name,
        acceptedSignatureDataUrl: dto.signatureDataUrl,
        acceptedIp: meta.ip,
        acceptedConfirmed: true,
        acceptedManually: false,
      },
    });
    if (res.count === 0) throw new ConflictException('وضعیت پروپوزال تغییر کرده است؛ صفحه را دوباره باز کنید');

    await recordProposalEvent(t.tenantDb, { proposalId: p.id, contactId: p.contactId, proposalNo: p.proposalNo, type: 'ACCEPTED', body: `پذیرفته‌شده توسط ${name}${meta.ip ? ` (IP ${meta.ip})` : ''}` });
    await this.notify(t, p, 'proposals.proposal.accepted', `پروپوزال شماره ${p.proposalNo} توسط مشتری پذیرفته شد`, `پذیرفته‌شده توسط ${name}`);
    await this.emit(t, 'proposals.proposal.accepted', p, { acceptedByName: name });
    return { success: true };
  }

  async reject(t: PublicTenantCtx, token: string, dto: PublicRejectProposalDto, _meta: ClientMeta) {
    const p = await this.findByToken(t, token);
    this.assertAnswerable(p);
    const reason = dto.reason?.trim() || null;
    const res = await t.tenantDb.proposal.updateMany({
      where: { id: p.id, status: { in: [...CUSTOMER_OPEN_STATUSES] } },
      data: { status: 'REJECTED', respondedAt: new Date(), rejectedReason: reason },
    });
    if (res.count === 0) throw new ConflictException('وضعیت پروپوزال تغییر کرده است؛ صفحه را دوباره باز کنید');
    if (reason) {
      await t.tenantDb.proposalComment.create({ data: { proposalId: p.id, authorType: 'CUSTOMER', authorName: dto.name?.trim() || 'مشتری', kind: 'REJECTION', body: reason } });
    }
    await recordProposalEvent(t.tenantDb, { proposalId: p.id, contactId: p.contactId, proposalNo: p.proposalNo, type: 'REJECTED', body: reason ? `ردشده — ${reason}` : 'توسط مشتری رد شد' });
    await this.notify(t, p, 'proposals.proposal.rejected', `پروپوزال شماره ${p.proposalNo} توسط مشتری رد شد`, reason ?? undefined);
    await this.emit(t, 'proposals.proposal.rejected', p);
    return { success: true };
  }

  async comment(t: PublicTenantCtx, token: string, dto: PublicCommentProposalDto, _meta: ClientMeta) {
    const p = await this.findByToken(t, token);
    const wantsRevision = dto.requestRevision === true;
    if (wantsRevision) this.assertAnswerable(p);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('متن نظر خالی است');

    const [recent, total] = await Promise.all([
      t.tenantDb.proposalComment.count({ where: { proposalId: p.id, authorType: 'CUSTOMER', createdAt: { gt: new Date(Date.now() - COMMENT_WINDOW_MS) } } }),
      t.tenantDb.proposalComment.count({ where: { proposalId: p.id, authorType: 'CUSTOMER' } }),
    ]);
    if (recent >= MAX_CUSTOMER_COMMENTS_PER_WINDOW || total >= MAX_CUSTOMER_COMMENTS_TOTAL) {
      throw new HttpException('تعداد پیام‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید', HttpStatus.TOO_MANY_REQUESTS);
    }

    const authorName = dto.name?.trim() || 'مشتری';
    const created = await t.tenantDb.proposalComment.create({
      data: { proposalId: p.id, authorType: 'CUSTOMER', authorName, kind: wantsRevision ? 'REVISION_REQUEST' : 'COMMENT', body },
      select: { id: true, authorType: true, authorName: true, kind: true, body: true, createdAt: true },
    });

    if (wantsRevision) {
      await t.tenantDb.proposal.updateMany({ where: { id: p.id, status: { in: [...CUSTOMER_OPEN_STATUSES] } }, data: { status: 'REVISION_REQUESTED', respondedAt: new Date() } });
      await recordProposalEvent(t.tenantDb, { proposalId: p.id, contactId: p.contactId, proposalNo: p.proposalNo, type: 'REVISION_REQUESTED', body: `درخواست اصلاح: ${body.slice(0, 200)}` });
      await this.notify(t, p, 'proposals.proposal.revision', `مشتری برای پروپوزال شماره ${p.proposalNo} درخواست اصلاح ثبت کرد`, body.slice(0, 160));
      await this.emit(t, 'proposals.proposal.revision_requested', p);
    } else {
      await recordProposalEvent(t.tenantDb, { proposalId: p.id, contactId: p.contactId, proposalNo: p.proposalNo, type: 'COMMENT', body: body.slice(0, 200) });
      await this.notify(t, p, 'proposals.proposal.comment', `نظر جدید مشتری روی پروپوزال شماره ${p.proposalNo}`, body.slice(0, 160));
    }
    return created;
  }
}
