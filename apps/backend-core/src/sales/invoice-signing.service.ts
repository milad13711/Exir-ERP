import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { CompanyStampService } from '../settings/company-stamp.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { TenantRequestContext } from '../common/request-context.js';
import {
  SALES_MODULE,
  SIGNATURE_POLICIES,
  SIGNATURE_POLICY_KEY,
  SIGN_ENTITY_TYPE,
  clearInvoiceSignature,
  invoiceContentHash,
  isSignatureStale,
  readSignaturePolicy,
  type SignatureKind,
  type SignaturePolicy,
} from './invoice-signing.js';

export type SignerOption = { userId: string; name: string; role: 'OWNER' | 'DELEGATE'; isDefault: boolean };

/** مهلت مجاز بین امضای واقعی و ثبت مدرک آن. */
export const SIGN_EVIDENCE_WINDOW_MS = 2 * 60_000;
/** کلید ModuleSetting برای هش محتوای فاکتور در لحظه‌ی درخواست امضا (به ازای requestId). */
export const signRequestHashKey = (requestId: string) => `sign-request-hash:${requestId}`;

const INVOICE_FOR_HASH = { lines: true, contact: { select: { name: true, company: true } } } as const;

/**
 * امضای داخلی فاکتور از مسیر کارتابل مدیر: فروشنده «درخواست امضا» می‌زند، درخواست (SALES_INVOICE_SIGN) روی
 * کارتابل امضاکننده می‌نشیند و او فقط می‌تواند با «امضا» یا «مهر و امضای شرکت» (تصاویر ثبت‌شده در تنظیمات عمومی —
 * نه تصویر دلخواه) تأیید کند یا با دلیل رد کند. مسیر قدیمی امضای مستقیم (InvoicesService.sign) دست‌نخورده است.
 */
@Injectable()
export class InvoiceSigningService implements OnModuleInit {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly stamp: CompanyStampService,
    private readonly notifications: NotificationsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler(SIGN_ENTITY_TYPE, {
      approve: (ctx, id, opts) => this.signByApproval(ctx, id, opts),
      reject: (ctx, id, opts) => this.rejectSignRequest(ctx, id, opts),
      describe: (ctx, id) => this.describe(ctx, id),
      evidenceFor: async (ctx, id, decision) => {
        const inv = await ctx.tenantDb.salesInvoice.findUnique({ where: { id }, select: { signedByName: true, signedContentHash: true, signatureDataUrl: true, signedByUserId: true, signedAt: true } });
        if (!inv) return null;
        // مدرک فقط وقتی ثبت می‌شود که همین تصمیم‌گیرنده همین الان واقعاً امضا کرده باشد
        // (تأیید ایدمپوتنتِ بی‌اثر یا امضای هم‌زمان دیگری نباید مدرکِ امضا به نام این کاربر بسازد).
        const decider = await resolveTenantUserId(ctx).catch(() => null);
        if (!decider || inv.signedByUserId !== decider || !inv.signedAt || Date.now() - inv.signedAt.getTime() > SIGN_EVIDENCE_WINDOW_MS) return null;
        return {
          entityType: 'invoice',
          entityId: id,
          action: decision.withStamp ? 'invoice_sign_stamp_and_signature' : 'invoice_sign_signature',
          signerName: inv.signedByName ?? undefined,
          contentHash: inv.signedContentHash ?? undefined,
          signatureData: inv.signatureDataUrl ?? undefined,
        };
      },
    });
  }

  // ── تنظیم سیاست ────────────────────────────────────────────────────────
  getPolicy(ctx: TenantRequestContext): Promise<SignaturePolicy> {
    return readSignaturePolicy(ctx.tenantDb);
  }

  async setPolicy(ctx: TenantRequestContext, policy: string): Promise<SignaturePolicy> {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') throw new ForbiddenException('فقط مالک یا مدیر می‌تواند این تنظیم را تغییر دهد');
    if (!(SIGNATURE_POLICIES as readonly string[]).includes(policy)) throw new BadRequestException('مقدار نامعتبر برای سیاست امضای فاکتور');
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: SALES_MODULE, key: SIGNATURE_POLICY_KEY } },
      create: { moduleCode: SALES_MODULE, key: SIGNATURE_POLICY_KEY, value: policy },
      update: { value: policy },
    });
    return policy as SignaturePolicy;
  }

  // ── امضاکنندگان مجاز ────────────────────────────────────────────────────
  /** مالک(ها) + کاربری که مالک دسترسی مهر و امضا را به او ارجاع داده — همان قاعده‌ی CompanyStampService.assertCanUse. */
  async eligibleSigners(ctx: TenantRequestContext): Promise<SignerOption[]> {
    const memberships = await this.controlDb.tenantMembership.findMany({
      where: { tenantId: ctx.tenantId, role: 'OWNER', status: 'ACTIVE' },
      select: { globalUserId: true },
    });
    const owners = memberships.length
      ? await ctx.tenantDb.user.findMany({ where: { globalUserId: { in: memberships.map((m) => m.globalUserId) } }, select: { id: true, name: true } })
      : [];
    const out: SignerOption[] = owners.map((u, i) => ({ userId: u.id, name: u.name, role: 'OWNER', isDefault: i === 0 }));
    const delegateId = await this.stamp.getDelegateUserId(ctx);
    if (delegateId && !out.some((o) => o.userId === delegateId)) {
      const d = await ctx.tenantDb.user.findUnique({ where: { id: delegateId }, select: { id: true, name: true } });
      if (d) out.push({ userId: d.id, name: d.name, role: 'DELEGATE', isDefault: out.length === 0 });
    }
    return out;
  }

  /** وضعیت امضا برای صفحه‌ی جزئیات فاکتور: سیاست، امکان درخواست، امضاکنندگان، درخواست در انتظار و آخرین رد. */
  async state(ctx: TenantRequestContext, invoiceId: string) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id: invoiceId }, include: INVOICE_FOR_HASH });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    const [policy, signers, images, pendingRow, lastDecided] = await Promise.all([
      this.getPolicy(ctx),
      this.eligibleSigners(ctx),
      this.stamp.getStamp(ctx),
      ctx.tenantDb.approvalRequest.findFirst({ where: { entityType: SIGN_ENTITY_TYPE, entityId: invoiceId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } }),
      ctx.tenantDb.approvalRequest.findFirst({ where: { entityType: SIGN_ENTITY_TYPE, entityId: invoiceId, status: 'REJECTED' }, orderBy: { decidedAt: 'desc' } }),
    ]);
    const stale = isSignatureStale(invoice, invoiceContentHash(invoice));
    const assignee = pendingRow?.assigneeUserId ? signers.find((s) => s.userId === pendingRow.assigneeUserId) ?? null : null;
    const me = await resolveTenantUserId(ctx).catch(() => null);
    const alreadySigned = !!invoice.signedAt && !stale;
    const blocked =
      invoice.status === 'CANCELLED' ? 'فاکتور باطل‌شده قابل امضا نیست' : alreadySigned ? 'این فاکتور امضا شده است' : policy === 'off' ? 'درخواست امضا در تنظیمات فروش فعال نیست' : null;
    const canDecide = !!pendingRow && (ctx.auth.role === 'OWNER' || (!!me && signers.some((s) => s.userId === me)));
    return {
      policy,
      requiredBeforeIssue: policy === 'required' && invoice.status === 'DRAFT',
      canRequest: !blocked && !pendingRow,
      blockedReason: blocked,
      hasSignatureImage: !!images.signatureImage,
      hasStampImage: !!images.stampImage,
      signers,
      pending: pendingRow
        ? { requestId: pendingRow.id, assigneeUserId: pendingRow.assigneeUserId, assigneeName: assignee?.name ?? null, createdAt: pendingRow.createdAt, requestedByUserId: pendingRow.requestedByUserId }
        : null,
      canDecide,
      lastRejection: lastDecided && !alreadySigned ? { note: lastDecided.decisionNote ?? null, decidedAt: lastDecided.decidedAt } : null,
      signed: alreadySigned,
      stale,
      signatureKind: invoice.signatureKind as SignatureKind | null,
      signatureInvalidatedAt: invoice.signatureInvalidatedAt,
      signatureInvalidReason: invoice.signatureInvalidReason,
    };
  }

  // ── درخواست امضا ────────────────────────────────────────────────────────
  async requestSignature(ctx: TenantRequestContext, invoiceId: string, dto: { signerUserId?: string; note?: string }) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id: invoiceId }, include: { ...INVOICE_FOR_HASH } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if ((await this.getPolicy(ctx)) === 'off') throw new BadRequestException('درخواست امضای داخلی در تنظیمات فروش فعال نیست');
    if (invoice.status === 'CANCELLED') throw new BadRequestException('فاکتور باطل‌شده قابل امضا نیست');
    if (invoice.signedAt && !isSignatureStale(invoice, invoiceContentHash(invoice))) throw new BadRequestException('این فاکتور قبلاً امضا شده است');
    const images = await this.stamp.getStamp(ctx);
    if (!images.signatureImage) throw new BadRequestException('امضای شرکت در تنظیمات عمومی ثبت نشده است؛ ابتدا مالک آن را بارگذاری کند');

    const signers = await this.eligibleSigners(ctx);
    if (signers.length === 0) throw new BadRequestException('امضاکننده‌ی مجازی (مالک یا دارنده‌ی دسترسی مهر و امضا) یافت نشد');
    const signer = dto.signerUserId ? signers.find((s) => s.userId === dto.signerUserId) : (signers.find((s) => s.isDefault) ?? signers[0]);
    if (!signer) throw new BadRequestException('امضاکننده‌ی انتخاب‌شده مجاز به امضا از طرف شرکت نیست');

    const me = await resolveTenantUserId(ctx).catch(() => null);
    // حلقه‌ی خودتأییدی: غیرمالک نمی‌تواند برای خودش درخواست امضا بزند (مالک مرجع نهایی است و مجاز).
    if (me && signer.userId === me && ctx.auth.role !== 'OWNER') {
      throw new BadRequestException('نمی‌توانید درخواست امضا را برای خودتان ثبت کنید؛ امضاکننده‌ی دیگری انتخاب کنید');
    }
    const existing = await ctx.tenantDb.approvalRequest.findFirst({ where: { entityType: SIGN_ENTITY_TYPE, entityId: invoiceId, status: 'PENDING' } });
    if (existing) throw new ConflictException('برای این فاکتور یک درخواست امضا در انتظار تصمیم است');

    // امضای قدیمیِ بی‌اعتبارشده پاک می‌شود تا وضعیت «امضاشده» کاذب نماند
    if (invoice.signedAt) await this.clearSignature(ctx, invoiceId, 'محتوای فاکتور پس از امضا تغییر کرده بود', me);

    const summaryNote = dto.note?.trim() ? ` — ${dto.note.trim().slice(0, 300)}` : '';
    const request = await this.approvals.request(ctx, {
      moduleCode: SALES_MODULE,
      entityType: SIGN_ENTITY_TYPE,
      entityId: invoiceId,
      title: `درخواست امضای فاکتور ${invoice.invoiceNo}`,
      summary: `${invoice.contact?.company || invoice.contact?.name || ''} — ${invoice.total.toLocaleString('en-US')} تومان${summaryNote}`,
      link: `/sales?open=${invoiceId}`,
      isOfficial: true, // کارتابل گزینه‌ی «تأیید با مهر و امضای شرکت» را نشان می‌دهد
      requestedByUserId: me ?? undefined,
      assigneeUserId: signer.userId,
      notifyAssigneeOnly: true,
    });
    // هش محتوای فاکتور در لحظه‌ی درخواست؛ اگر تا زمان تأیید فاکتور عوض شود، امضا رد می‌شود
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: SALES_MODULE, key: signRequestHashKey(request.id) } },
      create: { moduleCode: SALES_MODULE, key: signRequestHashKey(request.id), value: invoiceContentHash(invoice) },
      update: { value: invoiceContentHash(invoice) },
    });
    return { requestId: request.id, signerUserId: signer.userId, signerName: signer.name };
  }

  /** لغو درخواست در انتظار — فقط درخواست‌دهنده یا مدیر. */
  async cancelRequest(ctx: TenantRequestContext, invoiceId: string) {
    const pending = await ctx.tenantDb.approvalRequest.findFirst({ where: { entityType: SIGN_ENTITY_TYPE, entityId: invoiceId, status: 'PENDING' } });
    if (!pending) throw new NotFoundException('درخواست امضای در انتظار یافت نشد');
    const me = await resolveTenantUserId(ctx).catch(() => null);
    const isManager = ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
    if (!isManager && pending.requestedByUserId !== me) throw new ForbiddenException('فقط درخواست‌دهنده یا مدیر می‌تواند درخواست را لغو کند');
    const res = await ctx.tenantDb.approvalRequest.updateMany({
      where: { id: pending.id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedAt: new Date(), decidedByUserId: me ?? undefined, decisionNote: 'درخواست توسط ثبت‌کننده لغو شد' },
    });
    return { success: res.count === 1 };
  }

  // ── تصمیم امضاکننده (هندلر کارتابل) ──────────────────────────────────────
  private async assertEligibleDecider(ctx: TenantRequestContext): Promise<string | null> {
    await this.stamp.assertCanUse(ctx); // ForbiddenException اگر نه مالک است نه دارنده‌ی ارجاع مهر و امضا
    return resolveTenantUserId(ctx).catch(() => null);
  }

  private async signByApproval(ctx: TenantRequestContext, id: string, opts: { stampApplied: boolean; requestedByUserId?: string | null; requestId?: string }): Promise<void> {
    const deciderId = await this.assertEligibleDecider(ctx);
    if (deciderId && opts.requestedByUserId && deciderId === opts.requestedByUserId && ctx.auth.role !== 'OWNER') {
      throw new ForbiddenException('درخواست‌دهنده نمی‌تواند درخواست امضای خودش را تأیید کند');
    }
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id }, include: INVOICE_FOR_HASH });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.status === 'CANCELLED') throw new BadRequestException('این فاکتور باطل شده است و امضا نمی‌شود');
    const hash = invoiceContentHash(invoice);
    if (invoice.signedAt && !isSignatureStale(invoice, hash)) return; // قبلاً امضا شده — بی‌اثر و بدون خطا (idempotent)

    if (opts.requestId) {
      const requested = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: SALES_MODULE, key: signRequestHashKey(opts.requestId) } } });
      if (requested && requested.value !== hash) {
        throw new ConflictException('محتوای فاکتور پس از ثبت درخواست امضا تغییر کرده است؛ درخواست را رد کنید و درخواست امضای جدید ثبت شود');
      }
    }
    const images = await this.stamp.getStamp(ctx);
    if (!images.signatureImage) throw new BadRequestException('امضای شرکت در تنظیمات عمومی ثبت نشده است');
    if (opts.stampApplied && !images.stampImage) throw new BadRequestException('مهر شرکت در تنظیمات عمومی ثبت نشده است؛ فقط با «امضا» تأیید کنید');
    const user = deciderId ? await ctx.tenantDb.user.findUnique({ where: { id: deciderId }, select: { name: true } }) : null;
    const kind: SignatureKind = opts.stampApplied ? 'STAMP_AND_SIGNATURE' : 'SIGNATURE';

    // ادعای اتمیک: دو تأیید هم‌زمان فقط یکی برنده می‌شود (signedAt هنوز خالی)؛ امضای بی‌اعتبارشده (stale) هم باز بازنویسی می‌شود.
    const claimed = await ctx.tenantDb.salesInvoice.updateMany({
      where: { id, status: { not: 'CANCELLED' }, OR: [{ signedAt: null }, { signedContentHash: invoice.signedContentHash, signedAt: invoice.signedAt }] },
      data: {
        signedAt: new Date(),
        signedByUserId: deciderId,
        signedByName: user?.name ?? null,
        signatureDataUrl: images.signatureImage,
        stampDataUrl: opts.stampApplied ? images.stampImage : null,
        signatureKind: kind,
        signedContentHash: hash,
        signatureInvalidatedAt: null,
        signatureInvalidReason: null,
      },
    });
    if (claimed.count !== 1) return; // دیگری همین لحظه امضا کرد
    // درخواست قدیمی «امضای فاکتور رسمی» (پس از صدور) با همین امضا برآورده شد
    await this.approvals.closeForEntity(ctx, 'SALES_INVOICE', id, 'APPROVED', opts.stampApplied);

    if (opts.requestedByUserId) {
      await this.notifications
        .notify(ctx.tenantDb, {
          userId: opts.requestedByUserId,
          type: 'INVOICE_SIGNED',
          title: `فاکتور ${invoice.invoiceNo} امضا شد`,
          body: `${user?.name ?? 'مدیر'} فاکتور را ${opts.stampApplied ? 'با مهر و امضای شرکت' : 'با امضا'} تأیید کرد.`,
          link: `/sales?open=${id}`,
          entityType: 'SalesInvoice',
          entityId: id,
          category: 'approvals',
          important: true,
        })
        .catch(() => undefined);
    }
  }

  private async rejectSignRequest(ctx: TenantRequestContext, id: string, opts: { note?: string; requestedByUserId?: string | null }): Promise<void> {
    await this.assertEligibleDecider(ctx);
    const reason = opts.note?.trim();
    if (!reason || reason.length < 3) throw new BadRequestException('برای رد درخواست امضا، دلیل را بنویسید');
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id }, select: { invoiceNo: true } });
    if (opts.requestedByUserId) {
      await this.notifications
        .notify(ctx.tenantDb, {
          userId: opts.requestedByUserId,
          type: 'INVOICE_SIGN_REJECTED',
          title: `درخواست امضای فاکتور ${invoice?.invoiceNo ?? ''} رد شد`,
          body: reason,
          link: `/sales?open=${id}`,
          entityType: 'SalesInvoice',
          entityId: id,
          category: 'approvals',
          important: true,
        })
        .catch(() => undefined);
    }
  }

  private async describe(ctx: TenantRequestContext, id: string) {
    const inv = await ctx.tenantDb.salesInvoice.findUniqueOrThrow({ where: { id }, include: { contact: true, lines: true } });
    const images = await this.stamp.getStamp(ctx);
    return {
      fields: [
        { label: 'شماره فاکتور', value: `${inv.invoiceNo}${inv.isOfficial && inv.officialInvoiceNo ? ` (رسمی ${inv.officialInvoiceNo})` : ''}` },
        { label: 'وضعیت فاکتور', value: inv.status === 'DRAFT' ? 'پیش‌نویس — امضا پیش از صدور' : inv.status === 'CANCELLED' ? 'باطل‌شده' : 'صادرشده' },
        { label: 'مشتری', value: `${inv.contact.company || inv.contact.name}${inv.contact.phone ? ` — ${inv.contact.phone}` : ''}` },
        { label: 'اقلام', value: inv.lines.map((l) => `${l.description} × ${l.quantity} @ ${l.unitPrice.toLocaleString('en-US')}`).join('\n') },
        { label: 'تخفیف', value: `${inv.discount.toLocaleString('en-US')} تومان` },
        { label: 'مالیات', value: `${inv.taxAmount.toLocaleString('en-US')} تومان` },
        { label: 'مبلغ نهایی', value: `${inv.total.toLocaleString('en-US')} تومان` },
        { label: 'یادداشت', value: inv.notes ?? '—' },
        { label: 'گزینه‌های تصمیم', value: `فقط «تأیید با امضا»${images.stampImage ? ' یا «تأیید با مهر و امضای شرکت»' : ''} یا «رد با دلیل» — از تصاویر ثبت‌شده در تنظیمات عمومی استفاده می‌شود` },
      ],
    };
  }

  /** ر.ک. clearInvoiceSignature */
  clearSignature(ctx: TenantRequestContext, invoiceId: string, reason: string, userId: string | null): Promise<void> {
    return clearInvoiceSignature(ctx, this.approvals, invoiceId, reason, userId);
  }
}
