import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SignatureEvidenceService } from '../common/signature-evidence/signature-evidence.service.js';
import { hashContent } from '../common/signature-evidence/signature-evidence.util.js';
import { isModuleEnabled } from '../common/module-enabled.util.js';
import { getManagerUsers } from '../common/manager-users.js';
import { clientIp } from '../security/client-ip.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { snapshotInvoice } from './invoice-amendment.js';
import { maskPhone } from './invoice-signing.js';
import { InvoicesService, generateDeliveryCode, renderDeliverySmsTemplate } from './invoices.service.js';
import type { PublicDeliveryConfirmDto } from './dto/public-delivery.dto.js';

export const DELIVERY_MODULE = 'delivery-signature';
export const DELIVERABLE_STATUSES = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] as const;

/** سیاست امنیتی کد تحویل عمومی — اعداد در یک جا تا تست و مرور آسان باشد. */
export const DELIVERY_OTP = {
  ttlMs: 10 * 60_000,
  maxAttempts: 5,
  lockMs: 15 * 60_000,
  cooldownMs: 60_000,
  perInvoiceHour: 5,
  perInvoiceDay: 10,
  perIpHour: 10,
  tenantDailyCapDefault: 300,
} as const;

const tooMany = (message: string) => new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message }, HttpStatus.TOO_MANY_REQUESTS);

function ipFingerprint(ip: string, tenantSlug: string): string {
  return createHash('sha256').update(`delivery-otp|${tenantSlug}|${ip}`).digest('hex').slice(0, 32);
}

/**
 * تأیید تحویل کالا از «صفحه‌ی عمومی فاکتور» (فقط وقتی ماژول delivery-signature برای تننت فعال است):
 * مشتری یا با کد ۶ رقمی پیامک‌شده (هش‌شده، ۱۰ دقیقه، ۵ تلاش، قفل) یا با امضای ترسیمی تأیید می‌کند و همان لحظه مدرک
 * حقوقی (IP/دستگاه/زمان/موقعیت اختیاری/هش محتوای فاکتور) ثبت می‌شود. تأیید ایدمپوتنت است (ادعای اتمیک)؛ دوم رد می‌شود.
 */
@Injectable()
export class PublicInvoiceDeliveryService {
  private readonly logger = new Logger('PublicInvoiceDelivery');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly sms: TenantSmsService,
    private readonly notifications: NotificationsService,
    private readonly evidence: SignatureEvidenceService,
    private readonly invoices: InvoicesService,
  ) {}

  /** ماژول نصب نیست ⇒ ۴۰۴ (وجود قابلیت لو نمی‌رود). */
  async moduleInstalled(ctx: TenantRequestContext): Promise<boolean> {
    return isModuleEnabled(this.controlDb, ctx.tenantId, DELIVERY_MODULE).catch(() => false);
  }

  private async assertModule(ctx: TenantRequestContext): Promise<void> {
    if (!(await this.moduleInstalled(ctx))) throw new NotFoundException('این قابلیت برای این کسب‌وکار فعال نیست');
  }

  private async loadInvoice(ctx: TenantRequestContext, token: string) {
    const invoice = await ctx.tenantDb.salesInvoice.findFirst({
      where: { publicToken: token },
      include: { contact: { select: { name: true, phone: true } }, lines: true },
    });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    return invoice;
  }

  private assertDeliverable(invoice: { status: string; deliveryConfirmedAt: Date | null }): void {
    if (invoice.deliveryConfirmedAt) throw new ConflictException('تحویل این فاکتور قبلاً تأیید شده است');
    if (invoice.status === 'DRAFT') throw new BadRequestException('این فاکتور هنوز صادر نشده است');
    if (invoice.status === 'CANCELLED') throw new BadRequestException('این فاکتور باطل شده است');
    if (!(DELIVERABLE_STATUSES as readonly string[]).includes(invoice.status)) throw new BadRequestException('این فاکتور قابل تأیید تحویل نیست');
  }

  /** بخش «تأیید تحویل» در پاسخ نمای عمومی — فقط وقتی ماژول نصب است؛ بدون هیچ PII جدید (شماره‌ی مشتری ماسک). */
  async viewSection(ctx: TenantRequestContext, invoice: { status: string; deliveryConfirmedAt: Date | null; deliveryMethod: string | null; contact: { phone: string | null } }) {
    if (!(await this.moduleInstalled(ctx))) return null;
    const deliverable = !invoice.deliveryConfirmedAt && (DELIVERABLE_STATUSES as readonly string[]).includes(invoice.status);
    return {
      available: deliverable,
      confirmed: !!invoice.deliveryConfirmedAt,
      confirmedAt: invoice.deliveryConfirmedAt,
      method: invoice.deliveryMethod,
      codeAvailable: deliverable && !!invoice.contact.phone,
      phoneMasked: maskPhone(invoice.contact.phone),
    };
  }

  // ── ارسال کد ────────────────────────────────────────────────────────────
  async sendCode(ctx: TenantRequestContext, token: string, req: Request): Promise<{ sent: true; expiresInSeconds: number; resendAfterSeconds: number; phoneMasked: string | null }> {
    await this.assertModule(ctx);
    const invoice = await this.loadInvoice(ctx, token);
    this.assertDeliverable(invoice);
    const phone = invoice.contact.phone;
    if (!phone) throw new BadRequestException('شماره‌ی موبایلی برای ارسال کد ثبت نشده است؛ با فروشنده تماس بگیرید یا با امضا تأیید کنید');

    const db = ctx.tenantDb;
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 3600_000);
    const hourAgo = new Date(now - 3600_000);
    const ipHash = ipFingerprint(clientIp(req), ctx.tenantSlug);
    const cap = Number(process.env.INVOICE_DELIVERY_OTP_TENANT_DAILY_CAP) || DELIVERY_OTP.tenantDailyCapDefault;
    const code = generateDeliveryCode();
    const codeHash = await bcrypt.hash(code, 10);

    // بررسی سقف‌ها + درج ردیف در یک تراکنش زیر قفل مشورتی: درخواست‌های موازی نمی‌توانند هم‌زمان از کنترل رد شوند.
    // قفل تننت-محور است (سقف روزانه‌ی تننت و سقف IP هم باید race-safe باشند)؛ بخش داخل تراکنش فقط چند کوئری سبک است.
    const row = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'delivery-otp-send'}))`;
      const recent = await tx.invoiceDeliveryOtp.findMany({ where: { invoiceId: invoice.id, createdAt: { gte: dayAgo } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, lockedUntil: true } });
      if (recent.some((r) => r.lockedUntil && r.lockedUntil.getTime() > now)) throw tooMany('به‌دلیل تلاش‌های ناموفق، دریافت کد موقتاً قفل شده است؛ بعداً دوباره تلاش کنید');
      if (recent[0] && now - recent[0].createdAt.getTime() < DELIVERY_OTP.cooldownMs) throw tooMany('کد به‌تازگی ارسال شده است؛ یک دقیقه بعد دوباره درخواست دهید');
      if (recent.filter((r) => r.createdAt >= hourAgo).length >= DELIVERY_OTP.perInvoiceHour || recent.length >= DELIVERY_OTP.perInvoiceDay) {
        throw tooMany('تعداد درخواست کد برای این فاکتور زیاد است؛ بعداً دوباره تلاش کنید');
      }
      if ((await tx.invoiceDeliveryOtp.count({ where: { ipHash, createdAt: { gte: hourAgo } } })) >= DELIVERY_OTP.perIpHour) throw tooMany('تعداد درخواست‌ها از این دستگاه زیاد است؛ بعداً دوباره تلاش کنید');
      if ((await tx.invoiceDeliveryOtp.count({ where: { createdAt: { gte: dayAgo } } })) >= cap) throw tooMany('سقف روزانه‌ی ارسال کد تحویل پر شده است؛ با فروشنده تماس بگیرید یا با امضا تأیید کنید');
      await tx.invoiceDeliveryOtp.updateMany({ where: { invoiceId: invoice.id, consumedAt: null }, data: { consumedAt: new Date() } });
      return tx.invoiceDeliveryOtp.create({
        data: { invoiceId: invoice.id, codeHash, phoneMasked: maskPhone(phone), ipHash, expiresAt: new Date(now + DELIVERY_OTP.ttlMs) },
      });
    });

    const template = await this.invoices.getDeliverySmsTemplate(ctx);
    const result = await this.sms.sendSms(ctx, phone, renderDeliverySmsTemplate(template, { code, invoiceNo: invoice.invoiceNo }), { purpose: 'public-delivery-code', moduleCode: DELIVERY_MODULE });
    if (!result.success) {
      await db.invoiceDeliveryOtp.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      this.logger.warn(`delivery code SMS failed for invoice ${invoice.id}: ${result.error ?? 'unknown'}`);
      throw new BadRequestException('ارسال پیامک ممکن نشد؛ کمی بعد دوباره تلاش کنید یا با امضا تأیید کنید');
    }
    // هرگز خود کد در پاسخ نیست؛ شماره هم فقط ماسک‌شده
    return { sent: true, expiresInSeconds: DELIVERY_OTP.ttlMs / 1000, resendAfterSeconds: DELIVERY_OTP.cooldownMs / 1000, phoneMasked: maskPhone(phone) };
  }

  // ── تأیید ───────────────────────────────────────────────────────────────
  async confirm(ctx: TenantRequestContext, token: string, dto: PublicDeliveryConfirmDto, req: Request) {
    await this.assertModule(ctx);
    const invoice = await this.loadInvoice(ctx, token);
    this.assertDeliverable(invoice);
    const db = ctx.tenantDb;
    const name = dto.confirmerName.trim();
    if (name.length < 2) throw new BadRequestException('نام تحویل‌گیرنده را وارد کنید');

    if (dto.method === 'CODE') {
      if (!dto.code) throw new BadRequestException('کد تأیید را وارد کنید');
      await this.verifyCode(ctx, invoice.id, dto.code);
    } else {
      if (!dto.signatureDataUrl) throw new BadRequestException('امضا الزامی است');
      if (dto.consent !== true) throw new BadRequestException('برای ثبت امضا باید اعلان ثبت اطلاعات دستگاه و زمان را بپذیرید');
    }

    const now = new Date();
    const claim = await db.salesInvoice.updateMany({
      where: { id: invoice.id, deliveryConfirmedAt: null, status: { in: [...DELIVERABLE_STATUSES] } },
      data: {
        deliveryConfirmedAt: now,
        deliveryConfirmedName: name,
        deliveryMethod: dto.method,
        deliveryChannel: 'PUBLIC_LINK',
        deliverySignatureDataUrl: dto.method === 'SIGNATURE' ? dto.signatureDataUrl : null,
        deliveryCodeHash: null,
        deliveryCodeExpiresAt: null,
      },
    });
    if (claim.count !== 1) throw new ConflictException('تحویل این فاکتور قبلاً تأیید شده یا فاکتور دیگر قابل تأیید نیست');

    // مدرک حقوقی همان لحظه — IP/دستگاه/زمان سرور/موقعیت اختیاری/هش محتوای فاکتور
    await this.evidence.tryRecord(ctx, {
      entityType: 'invoice_delivery',
      entityId: invoice.id,
      action: `delivery_confirm_${dto.method.toLowerCase()}`,
      signerName: name,
      signerPhone: dto.method === 'CODE' ? (invoice.contact.phone ?? undefined) : undefined,
      signerRole: 'customer_public_link',
      // امضای ترسیمی از لینک عمومی: هویت راستی‌آزمایی نشده (هر دارنده‌ی لینک)؛ کد پیامکی به شماره‌ی مشتری وصل است
      verification: dto.method === 'SIGNATURE' ? 'link_only' : undefined,
      contentHash: hashContent({ invoiceNo: invoice.invoiceNo, officialInvoiceNo: invoice.officialInvoiceNo, ...snapshotInvoice({ ...invoice, contact: null }) }),
      signatureData: dto.method === 'SIGNATURE' ? dto.signatureDataUrl : undefined,
      req,
      clientEvidence: dto.evidence,
    });

    await db.activityLog
      .create({
        data: {
          action: 'sales.invoice.delivery_confirmed_public',
          entityType: 'SalesInvoice',
          entityId: invoice.id,
          actorType: 'AUTOMATIC',
          moduleCode: 'sales',
          actionType: 'approve',
          summary: `مشتری تحویل فاکتور ${invoice.invoiceNo} را از لینک عمومی تأیید کرد (${dto.method === 'CODE' ? 'کد پیامکی' : 'امضا'})`,
          metadata: { method: dto.method } as never,
        },
      })
      .catch(() => undefined);

    await this.notifySeller(ctx, invoice, name, dto.method);
    return { confirmed: true, confirmedAt: now, method: dto.method };
  }

  /** کد را با شمارنده‌ی اتمیک تلاش بررسی می‌کند؛ هیچ پاسخی کد یا وضعیت داخلی بیش از لازم لو نمی‌دهد. */
  private async verifyCode(ctx: TenantRequestContext, invoiceId: string, code: string): Promise<void> {
    const db = ctx.tenantDb;
    const now = new Date();
    const locked = await db.invoiceDeliveryOtp.findFirst({ where: { invoiceId, lockedUntil: { gt: now } }, select: { id: true } });
    if (locked) throw tooMany('به‌دلیل تلاش‌های ناموفق، تأیید با کد موقتاً قفل شده است؛ بعداً دوباره تلاش کنید');
    const otp = await db.invoiceDeliveryOtp.findFirst({ where: { invoiceId, consumedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
    if (!otp) throw new BadRequestException('کدی فعال نیست یا منقضی شده؛ «ارسال کد تحویل» را دوباره بزنید');

    // شمارنده پیش از مقایسه و اتمیک افزایش می‌یابد تا حدس‌های موازی از سقف عبور نکنند
    const claim = await db.invoiceDeliveryOtp.updateMany({ where: { id: otp.id, consumedAt: null, attempts: { lt: DELIVERY_OTP.maxAttempts } }, data: { attempts: { increment: 1 } } });
    if (claim.count !== 1) throw tooMany('تعداد تلاش‌های مجاز به پایان رسید؛ کد جدید درخواست دهید');

    const ok = await bcrypt.compare(code, otp.codeHash);
    if (!ok) {
      const attempts = otp.attempts + 1;
      if (attempts >= DELIVERY_OTP.maxAttempts) {
        await db.invoiceDeliveryOtp.updateMany({ where: { id: otp.id }, data: { consumedAt: now, lockedUntil: new Date(now.getTime() + DELIVERY_OTP.lockMs) } });
        throw tooMany('تعداد تلاش‌های مجاز به پایان رسید و تأیید با کد موقتاً قفل شد');
      }
      throw new BadRequestException(`کد تأیید نادرست است (${DELIVERY_OTP.maxAttempts - attempts} تلاش باقی مانده)`);
    }
    const consumed = await db.invoiceDeliveryOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: now } });
    if (consumed.count !== 1) throw new ConflictException('این کد قبلاً استفاده شده است');
  }

  private async notifySeller(ctx: TenantRequestContext, invoice: { id: string; invoiceNo: number; createdByUserId: string | null }, name: string, method: 'CODE' | 'SIGNATURE'): Promise<void> {
    try {
      const managers = await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId).catch(() => []);
      const ids = new Set<string>(managers.map((m) => m.tenantUserId));
      if (invoice.createdByUserId) ids.add(invoice.createdByUserId);
      for (const userId of ids) {
        await this.notifications.notify(ctx.tenantDb, {
          userId,
          type: 'DELIVERY_CONFIRMED',
          title: `تحویل فاکتور ${invoice.invoiceNo} تأیید شد`,
          body: `${name} تحویل کالا را از لینک فاکتور ${method === 'CODE' ? 'با کد پیامکی' : 'با امضای الکترونیکی'} تأیید کرد.`,
          link: `/sales?open=${invoice.id}`,
          entityType: 'SalesInvoice',
          entityId: invoice.id,
          category: 'system',
        });
      }
    } catch (e) {
      this.logger.warn(`seller notification failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
