import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantRequestContext } from '../common/request-context.js';
import { isModuleEnabled } from '../common/module-enabled.util.js';
import { publicRef } from '../common/tenant-public-key.js';
import { SignatureEvidenceService, hashContent, type ClientSignatureEvidence } from '../common/signature-evidence/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { DispatchRulesService } from './dispatch-rules.service.js';
import { DispatchReceiptPdfService, type ReceiptPdfData } from './dispatch-receipt-pdf.service.js';
import { logEvent, shipmentLink, type Actor } from './dispatch-common.js';

export const RECEIPT_STATEMENT = 'بار را صحیح و سالم تحویل گرفتم';
const SIGNABLE_STATUSES = new Set(['READY_TO_DEPART', 'IN_TRANSIT', 'DELIVERED']);

export type PublicReceiptView =
  | { status: 'not_ready'; shipmentNo: number; orgName: string }
  | {
      status: 'pending' | 'signed';
      orgName: string;
      shipmentNo: number;
      cargoType: string;
      quantityText: string;
      customerName: string | null;
      postalAddress: string | null;
      driverName: string | null;
      plateNumber: string | null;
      tareKg: number | null;
      grossKg: number | null;
      netKg: number | null;
      signedAt: string | null;
      statement: string;
    };

@Injectable()
export class DispatchReceiptService {
  private readonly logger = new Logger('DispatchReceiptService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly rules: DispatchRulesService,
    private readonly sms: TenantSmsService,
    private readonly notifications: NotificationsService,
    private readonly evidence: SignatureEvidenceService,
    private readonly pdf: DispatchReceiptPdfService,
  ) {}

  async ensure(ctx: TenantRequestContext, shipmentId: string) {
    const existing = await ctx.tenantDb.dispatchReceipt.findUnique({ where: { shipmentId } });
    if (existing) return existing;
    try {
      return await ctx.tenantDb.dispatchReceipt.create({ data: { shipmentId } });
    } catch {
      return ctx.tenantDb.dispatchReceipt.findUniqueOrThrow({ where: { shipmentId } });
    }
  }

  linkFor(slug: string, token: string): string {
    const base = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    return `${base}/dispatch-receipt/${publicRef(slug)}/${token}`;
  }

  /** پیامک لینک رسید به راننده (همان زیرساخت پیامک پیشنهادهای ناوگان). */
  async sendLink(ctx: TenantRequestContext, shipmentId: string, actor: Actor | null): Promise<{ link: string; sent: boolean }> {
    const shipment = await ctx.tenantDb.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { driver: true } });
    const receipt = await this.ensure(ctx, shipmentId);
    const link = this.linkFor(ctx.tenantSlug, receipt.publicToken);
    const settings = await this.rules.getSettings(ctx.tenantDb);
    let sent = false;
    if (settings.receipt.smsEnabled && shipment.driver?.phone) {
      const message = settings.receipt.smsTemplate.replaceAll('{shipmentNo}', String(shipment.shipmentNo)).replaceAll('{link}', link);
      const res = await this.sms.sendSms(ctx, shipment.driver.phone, message).catch(() => ({ success: false }));
      sent = !!res.success;
      if (sent) await ctx.tenantDb.dispatchReceipt.update({ where: { id: receipt.id }, data: { sentAt: new Date() } });
    }
    await logEvent(ctx.tenantDb, shipmentId, { type: 'receipt_link', actor, note: sent ? 'لینک رسید برای راننده پیامک شد' : 'لینک رسید ساخته شد (پیامک ارسال نشد)' });
    return { link, sent };
  }

  async receiptDone(ctx: TenantRequestContext, shipmentId: string): Promise<boolean> {
    const r = await ctx.tenantDb.dispatchReceipt.findUnique({ where: { shipmentId }, select: { status: true } });
    return r?.status === 'SIGNED' || r?.status === 'PAPER';
  }

  // ── مسیر عمومی راننده ───────────────────────────────────────────────
  private async orgName(ctx: TenantRequestContext): Promise<string> {
    const t = await this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
    return t?.name ?? '';
  }

  async publicView(ctx: TenantRequestContext, token: string): Promise<PublicReceiptView> {
    const receipt = await ctx.tenantDb.dispatchReceipt.findUnique({ where: { publicToken: token } });
    if (!receipt) throw new NotFoundException('این لینک معتبر نیست');
    const shipment = await ctx.tenantDb.shipment.findUniqueOrThrow({ where: { id: receipt.shipmentId }, include: { loading: true, driver: true } });
    const orgName = await this.orgName(ctx);
    if (receipt.status === 'PENDING' && !SIGNABLE_STATUSES.has(shipment.status)) return { status: 'not_ready', shipmentNo: shipment.shipmentNo, orgName };
    return {
      status: receipt.status === 'PENDING' ? 'pending' : 'signed',
      orgName,
      shipmentNo: shipment.shipmentNo,
      cargoType: shipment.cargoType,
      quantityText: `${shipment.quantity}${shipment.unit ? ' ' + shipment.unit : ''}`,
      customerName: shipment.loading?.customerName ?? null,
      postalAddress: shipment.loading?.postalAddress ?? shipment.deliveryAddress,
      driverName: shipment.driver?.name ?? null,
      plateNumber: shipment.driver?.plateNumber ?? null,
      tareKg: shipment.loading?.tareKg ?? null,
      grossKg: shipment.loading?.grossKg ?? null,
      netKg: shipment.loading?.netKg ?? null,
      signedAt: receipt.signedAt?.toISOString() ?? null,
      statement: RECEIPT_STATEMENT,
    };
  }

  async publicSign(
    ctx: TenantRequestContext,
    token: string,
    dto: { signatureData: string; confirmed: boolean; evidence?: ClientSignatureEvidence },
    req: Request,
  ) {
    if (!dto.confirmed) throw new BadRequestException('تأیید «بار را صحیح و سالم تحویل گرفتم» الزامی است');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dto.signatureData)) throw new BadRequestException('امضا نامعتبر است');
    const receipt = await ctx.tenantDb.dispatchReceipt.findUnique({ where: { publicToken: token } });
    if (!receipt) throw new NotFoundException('این لینک معتبر نیست');
    if (receipt.status !== 'PENDING') throw new ConflictException('این رسید قبلاً ثبت شده است');
    const shipment = await ctx.tenantDb.shipment.findUniqueOrThrow({ where: { id: receipt.shipmentId }, include: { loading: true, driver: true } });
    if (!SIGNABLE_STATUSES.has(shipment.status)) throw new BadRequestException('هنوز مجوز «آماده حرکت» برای این بار صادر نشده است');

    // قفل خوش‌بینانه: فقط یک امضای همزمان پیروز می‌شود
    const claimed = await ctx.tenantDb.dispatchReceipt.updateMany({ where: { id: receipt.id, status: 'PENDING' }, data: { status: 'SIGNED', signedAt: new Date() } });
    if (claimed.count === 0) throw new ConflictException('این رسید قبلاً ثبت شده است');

    const signerName = shipment.driver?.name ?? 'راننده';
    const signerPhone = shipment.driver?.phone;
    const snapshot = {
      shipmentNo: shipment.shipmentNo,
      cargoType: shipment.cargoType,
      quantity: shipment.quantity,
      customer: shipment.loading?.customerName,
      plate: shipment.driver?.plateNumber,
      tareKg: shipment.loading?.tareKg,
      grossKg: shipment.loading?.grossKg,
      netKg: shipment.loading?.netKg,
      statement: RECEIPT_STATEMENT,
    };
    // مدرک حقوقی امضا (IP، دستگاه، زمان سرور، هش محتوا/امضا) — نسخه‌ی بدون‌پرتاب؛ نبودِ مدرک امضا را باطل نمی‌کند ولی در تایم‌لاین ثبت می‌شود.
    const ev = await this.evidence.tryRecord(ctx, {
      entityType: 'shipment',
      entityId: shipment.id,
      action: 'driver_receipt_signed',
      signerName,
      signerPhone,
      signerRole: 'DRIVER',
      contentHash: hashContent(snapshot),
      signatureData: dto.signatureData,
      req,
      clientEvidence: dto.evidence,
    });
    if (!ev) await logEvent(ctx.tenantDb, shipment.id, { type: 'evidence_failed', actor: null, note: 'ثبت مدرک حقوقی امضا ناموفق بود' });
    const signed = await ctx.tenantDb.dispatchReceipt.update({
      where: { id: receipt.id },
      data: { signerName, signerPhone, signatureData: dto.signatureData, evidenceId: ev?.id ?? null },
    });
    await logEvent(ctx.tenantDb, shipment.id, { type: 'receipt_signed', actor: { userId: null, name: `${signerName} (راننده)` }, note: 'رسید بار با امضای راننده ثبت شد', meta: { evidenceId: ev?.id ?? null } });
    await this.afterReceipt(ctx, shipment.id, 'SIGNED');
    return { status: 'signed' as const, signedAt: signed.signedAt };
  }

  /** رسید کاغذی اسکن‌شده توسط کارمند. */
  async attachPaper(ctx: TenantRequestContext, shipmentId: string, actor: Actor, dto: { title: string; fileUrl: string }) {
    const receipt = await this.ensure(ctx, shipmentId);
    if (receipt.status !== 'PENDING') throw new ConflictException('رسید این بار قبلاً ثبت شده است');
    const shipment = await ctx.tenantDb.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    if (shipment.status === 'CANCELLED') throw new BadRequestException('بار لغو شده است');
    const att = await ctx.tenantDb.attachment.create({
      data: { entityType: 'Shipment', entityId: shipmentId, title: dto.title.trim() || `رسید کاغذی بار ${shipment.shipmentNo}`, fileUrl: dto.fileUrl, createdByUserId: actor.userId },
    });
    await ctx.tenantDb.shipmentDocument.create({ data: { shipmentId, docTypeCode: 'SIGNED_RECEIPT', attachmentId: att.id, createdByUserId: actor.userId, createdByName: actor.name } });
    await ctx.tenantDb.dispatchReceipt.update({
      where: { id: receipt.id },
      data: { status: 'PAPER', signedAt: new Date(), paperAttachmentId: att.id, paperByUserId: actor.userId, paperByName: actor.name },
    });
    await logEvent(ctx.tenantDb, shipmentId, { type: 'receipt_paper', actor, note: 'رسید کاغذیِ امضاشده اسکن و ثبت شد' });
    await this.afterReceipt(ctx, shipmentId, 'PAPER');
    return ctx.tenantDb.dispatchReceipt.findUnique({ where: { id: receipt.id } });
  }

  /** PDF «رسید بار» → پیوست بار + سند «رسید امضاشده» + بایگانی (اسناد محرمانه، اگر نصب و فعال باشد). */
  private async afterReceipt(ctx: TenantRequestContext, shipmentId: string, mode: 'SIGNED' | 'PAPER'): Promise<void> {
    try {
      await this.generateAndArchive(ctx, shipmentId, mode);
    } catch (e) {
      this.logger.error(`ساخت/بایگانی PDF رسید ناموفق بود (${shipmentId}): ${e instanceof Error ? e.message : e}`);
      await logEvent(ctx.tenantDb, shipmentId, { type: 'receipt_pdf_failed', actor: null, note: 'ساخت PDF رسید ناموفق بود؛ از صفحه‌ی بار دوباره بسازید' });
    }
    const s = await ctx.tenantDb.shipment.findUnique({ where: { id: shipmentId }, include: { driver: true } });
    if (s?.createdByUserId) {
      await this.notifications
        .notify(ctx.tenantDb, {
          userId: s.createdByUserId,
          type: 'dispatch.receipt_done',
          title: `رسید بار #${s.shipmentNo} ثبت شد`,
          body: s.driver?.name ? `راننده: ${s.driver.name}` : undefined,
          link: shipmentLink(shipmentId),
        })
        .catch(() => undefined);
    }
  }

  async generateAndArchive(ctx: TenantRequestContext, shipmentId: string, mode: 'SIGNED' | 'PAPER') {
    const receipt = await ctx.tenantDb.dispatchReceipt.findUniqueOrThrow({ where: { shipmentId } });
    const shipment = await ctx.tenantDb.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { loading: true, driver: true } });
    const ev = receipt.evidenceId ? await ctx.tenantDb.signatureEvidence.findUnique({ where: { id: receipt.evidenceId } }) : null;
    const dev = (ev?.device ?? null) as { serverTimeTehran?: string } | null;
    const data: ReceiptPdfData = {
      orgName: await this.orgName(ctx),
      shipmentNo: shipment.shipmentNo,
      cargoType: shipment.cargoType,
      quantityText: `${shipment.quantity}${shipment.unit ? ' ' + shipment.unit : ''}`,
      region: shipment.region,
      customerName: shipment.loading?.customerName ?? null,
      postalAddress: shipment.loading?.postalAddress ?? shipment.deliveryAddress,
      postalCode: shipment.loading?.postalCode ?? null,
      driverName: shipment.driver?.name ?? null,
      plateNumber: shipment.driver?.plateNumber ?? null,
      vehicleType: shipment.driver?.vehicleType ?? null,
      tareKg: shipment.loading?.tareKg ?? null,
      grossKg: shipment.loading?.grossKg ?? null,
      netKg: shipment.loading?.netKg ?? null,
      mode,
      signedAt: receipt.signedAt,
      signerName: receipt.signerName,
      signatureData: receipt.signatureData,
      evidenceId: ev?.id ?? null,
      evidenceIp: ev?.ip ?? null,
      evidenceTimeTehran: dev?.serverTimeTehran ?? null,
      paperByName: receipt.paperByName,
    };
    const buffer = await this.pdf.render(data);
    const fileUrl = `data:application/pdf;base64,${buffer.toString('base64')}`;
    const title = `رسید بار شماره ${shipment.shipmentNo}.pdf`;

    // جایگزینی PDF قبلی (ساخت دوباره)
    if (receipt.pdfAttachmentId) {
      await ctx.tenantDb.attachment.deleteMany({ where: { id: receipt.pdfAttachmentId } });
      await ctx.tenantDb.shipmentDocument.deleteMany({ where: { attachmentId: receipt.pdfAttachmentId } });
    }
    const att = await ctx.tenantDb.attachment.create({ data: { entityType: 'Shipment', entityId: shipmentId, title, fileUrl, createdByUserId: null } });
    await ctx.tenantDb.shipmentDocument.create({ data: { shipmentId, docTypeCode: 'SIGNED_RECEIPT', attachmentId: att.id, createdByName: 'سیستم' } });

    let archivedDocumentId: string | null = receipt.archivedDocumentId;
    const settings = await this.rules.getSettings(ctx.tenantDb);
    if (settings.receipt.archiveEnabled && (await isModuleEnabled(this.controlDb, ctx.tenantId, 'confidential-archive').catch(() => false))) {
      const docTitle = `رسید بار شماره ${shipment.shipmentNo}${shipment.loading?.customerName ? ` — ${shipment.loading.customerName}` : ''}`;
      const content = `سند مربوط به بار شماره ${shipment.shipmentNo} (ماژول اعلام بار) — ${mode === 'SIGNED' ? 'رسید با امضای الکترونیک راننده' : 'رسید کاغذی اسکن‌شده'}`;
      if (archivedDocumentId && (await ctx.tenantDb.confidentialDocument.findUnique({ where: { id: archivedDocumentId }, select: { id: true } }))) {
        await ctx.tenantDb.confidentialDocument.update({ where: { id: archivedDocumentId }, data: { title: docTitle, content, fileName: title, fileData: fileUrl } });
      } else {
        const doc = await ctx.tenantDb.confidentialDocument.create({
          data: { title: docTitle, category: 'OTHER', content, fileName: title, fileData: fileUrl, ownerOnly: false, createdByUserId: null },
          select: { id: true },
        });
        archivedDocumentId = doc.id;
      }
    }
    await ctx.tenantDb.dispatchReceipt.update({ where: { id: receipt.id }, data: { pdfAttachmentId: att.id, archivedDocumentId } });
    await logEvent(ctx.tenantDb, shipmentId, {
      type: 'receipt_pdf',
      actor: null,
      note: archivedDocumentId ? 'PDF رسید ساخته، به بار پیوست و در بایگانی ثبت شد' : 'PDF رسید ساخته و به بار پیوست شد',
    });
    return { attachmentId: att.id, archivedDocumentId };
  }
}
