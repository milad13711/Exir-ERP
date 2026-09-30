import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { InvoicesService } from './invoices.service.js';
import { SalesInvoicePdfService } from './sales-invoice-pdf.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { RecordPaymentDto } from './dto/record-payment.dto.js';
import { SignInvoiceDto } from './dto/sign-invoice.dto.js';
import { ConfirmDeliveryDto } from './dto/confirm-delivery.dto.js';
import { UpdateDeliverySmsTemplateDto } from './dto/update-delivery-sms-template.dto.js';

const GENERAL_SETTINGS_MODULE = 'general';

@Controller('sales/invoices')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('sales')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly permissions: PermissionsService,
    private readonly pdf: SalesInvoicePdfService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  @Get()
  async list(@Query('contactId') contactId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    return this.invoices.list(ctx, contactId ? { ...scope, contactId } : scope);
  }

  @Get('settings/delivery-sms-template')
  async getDeliverySmsTemplate(@Ctx() ctx: TenantRequestContext) {
    return { template: await this.invoices.getDeliverySmsTemplate(ctx) };
  }

  @Put('settings/delivery-sms-template')
  async setDeliverySmsTemplate(@Body() dto: UpdateDeliverySmsTemplateDto, @Ctx() ctx: TenantRequestContext) {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('فقط مالک یا مدیر می‌تواند این تنظیم را تغییر دهد');
    }
    await this.invoices.setDeliverySmsTemplate(ctx, dto.template);
    return { template: await this.invoices.getDeliverySmsTemplate(ctx) };
  }

  /** پیش‌فرض شماره کارت/حساب بانکی — پیشنهاد اولیه در فرم فاکتور جدید وقتی روش پرداخت «بانکی» انتخاب شود. */
  @Get('settings/default-bank-info')
  async getDefaultBankInfo(@Ctx() ctx: TenantRequestContext) {
    return { bankInfo: await this.invoices.getDefaultBankInfo(ctx.tenantDb) };
  }

  @Put('settings/default-bank-info')
  async setDefaultBankInfo(@Body() body: { bankInfo: string }, @Ctx() ctx: TenantRequestContext) {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('فقط مالک یا مدیر می‌تواند این تنظیم را تغییر دهد');
    }
    await this.invoices.setDefaultBankInfo(ctx, body.bankInfo ?? '');
    return { bankInfo: await this.invoices.getDefaultBankInfo(ctx.tenantDb) };
  }

  @Get('settings/payment-reminder-days')
  async getPaymentReminderDays(@Ctx() ctx: TenantRequestContext) {
    return { days: await this.invoices.getPaymentReminderDays(ctx.tenantDb) };
  }

  @Put('settings/payment-reminder-days')
  async setPaymentReminderDays(@Body() body: { days: number }, @Ctx() ctx: TenantRequestContext) {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('فقط مالک یا مدیر می‌تواند این تنظیم را تغییر دهد');
    }
    await this.invoices.setPaymentReminderDays(ctx, body.days);
    return { days: await this.invoices.getPaymentReminderDays(ctx.tenantDb) };
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    return this.invoices.detail(ctx, id, scope);
  }

  @Post()
  async create(@Body() dto: CreateInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'sales');
    return this.invoices.create(ctx, dto);
  }

  @Put(':id')
  async updateDraft(@Param('id') id: string, @Body() dto: CreateInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.invoices.updateDraft(ctx, id, dto);
  }

  @Delete(':id')
  async removeDraft(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'sales');
    return this.invoices.removeDraft(ctx, id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() dto: { reason?: string }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'sales');
    const reason = (dto?.reason ?? '').trim();
    if (reason.length < 3) throw new BadRequestException('دلیل ابطال را بنویسید');
    return this.invoices.cancel(ctx, id, reason);
  }

  @Post(':id/confirm')
  async confirm(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.invoices.confirm(ctx, id);
  }

  @Post(':id/payments')
  async recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.invoices.recordPayment(ctx, id, dto);
  }

  @Post(':id/sign')
  async sign(@Param('id') id: string, @Body() dto: SignInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.invoices.sign(ctx, id, dto);
  }

  /** لینک عمومی مشاهده/پرداخت آنلاین فاکتور را با پیامک برای مشتری می‌فرستد. */
  @Post(':id/send-payment-link')
  async sendPaymentLink(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'sales');
    const publicWebUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    return this.invoices.sendPaymentLinkSms(ctx, id, publicWebUrl);
  }

  /**
   * دکمه‌ی «پرداخت آنلاین» داخل خود پنل (برای فاکتوری که روش پرداختش آنلاین انتخاب شده) —
   * لینک درگاه را مستقیم برمی‌گرداند تا کاربر بدون پیامک هم بتواند باز/کپی کند.
   */
  @Post(':id/online-payment-link')
  async getOnlinePaymentLink(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'sales');
    const invoice = await this.invoices.detail(ctx, id, {});
    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');
    const callbackUrl = `${apiUrl}/public/tenants/${ctx.tenantSlug}/invoices/${invoice.publicToken}/callback`;
    const result = await this.invoices.initiateGatewayPayment(ctx, id, callbackUrl);
    if (!result) throw new BadRequestException('درگاه پرداخت در دسترس نیست — ابتدا آن را در تنظیمات پیکربندی کنید');
    return result;
  }

  @Post(':id/delivery/code')
  @RequireModule('delivery-signature')
  async sendDeliveryCode(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.invoices.sendDeliveryCode(ctx, id);
  }

  @Post(':id/delivery/confirm')
  @RequireModule('delivery-signature')
  async confirmDelivery(@Param('id') id: string, @Body() dto: ConfirmDeliveryDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.invoices.confirmDelivery(ctx, id, dto);
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    const invoice = await this.invoices.detail(ctx, id, {});
    const [settingsRows, tenant] = await Promise.all([
      ctx.tenantDb.moduleSetting.findMany({ where: { moduleCode: GENERAL_SETTINGS_MODULE } }),
      this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
    ]);
    const byKey = Object.fromEntries(settingsRows.map((r) => [r.key, r.value as string]));

    const pdf = await this.pdf.render(
      {
        invoiceNo: invoice.invoiceNo,
        officialInvoiceNo: invoice.officialInvoiceNo,
        status: invoice.status,
        issuedAt: invoice.issuedAt,
        dueAt: invoice.dueAt,
        subtotal: invoice.subtotal,
        discount: invoice.discount,
        taxRate: invoice.taxRate,
        taxAmount: invoice.taxAmount,
        total: invoice.total,
        paidAmount: invoice.paidAmount,
        notes: invoice.notes,
        isOfficial: invoice.isOfficial,
        signedByName: invoice.signedByName,
        signatureDataUrl: invoice.signatureDataUrl,
        signedAt: invoice.signedAt,
        deliveryConfirmedName: invoice.deliveryConfirmedName,
        deliverySignatureDataUrl: invoice.deliverySignatureDataUrl,
        deliveryConfirmedAt: invoice.deliveryConfirmedAt,
        paymentMethod: invoice.paymentMethod,
        paymentBankInfo: invoice.paymentBankInfo,
        checks: invoice.checks,
        contact: invoice.contact,
        lines: invoice.lines,
      },
      {
        orgName: tenant.name,
        address: byKey.address ?? null,
        phone: byKey.phone ?? null,
        economicCode: byKey.economicCode ?? null,
        nationalId: byKey.nationalId ?? null,
        registrationNumber: byKey.registrationNumber ?? null,
      },
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${invoice.invoiceNo}.pdf"`);
    res.send(pdf);
  }
}
