import { randomInt } from 'node:crypto';
import { assertNotTaxLocked } from './tax-lock.util.js';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { CompanyStampService } from '../settings/company-stamp.service.js';
import * as bcrypt from 'bcryptjs';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import { ensureDefaultWarehouse } from '../warehouse/default-warehouse.js';
import { CostingService } from '../warehouse/costing.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { CreditScoreService } from '../crm/credit-score.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { FunnelService } from '../crm/funnel.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { PaymentGatewayService } from '../payment-gateway/payment-gateway.service.js';
import { WarrantyService } from '../warranty/warranty.service.js';
import { ReferralCommissionService } from '../referral-marketing/referral-commission.service.js';
import type { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import type { RecordPaymentDto } from './dto/record-payment.dto.js';
import type { SignInvoiceDto } from './dto/sign-invoice.dto.js';
import type { ConfirmDeliveryDto } from './dto/confirm-delivery.dto.js';
import { publicRef } from '../common/tenant-public-key.js';
import { normalizeSearchTerm, searchTermAsInt } from '../common/search.js';

const DELIVERY_CODE_TTL_MS = 30 * 60 * 1000;
const SALES_SETTINGS_MODULE = 'sales';
const DELIVERY_SMS_TEMPLATE_KEY = 'deliveryCodeSmsTemplate';
const DEFAULT_DELIVERY_SMS_TEMPLATE = 'کد تأیید تحویل فاکتور شماره {invoiceNo} اکسیر ERP: {code}';
const PAYMENT_REMINDER_DAYS_KEY = 'paymentReminderDaysBefore';
const DEFAULT_PAYMENT_REMINDER_DAYS = 3;

function generateDeliveryCode(): string {
  return String(randomInt(100000, 1000000));
}

function renderDeliverySmsTemplate(template: string, vars: { code: string; invoiceNo: number }): string {
  return template.replace(/\{code\}/g, vars.code).replace(/\{invoiceNo\}/g, String(vars.invoiceNo));
}

/**
 * جمله‌ی راهنمای پرداخت مخصوص روش انتخاب‌شده‌ی فاکتور — به‌جای پیام یک‌شکل «لینک
 * پرداخت» روی هر فاکتور. هم پیامک «ارسال لینک فاکتور» و هم یادآور سررسید
 * (payment-reminder.service.ts) از همین یک منبع استفاده می‌کنند تا متن ثابت بماند.
 * برای CASH مقدار خالی برمی‌گرداند — یعنی پیام پرداختی لازم نیست فرستاده شود.
 */
export function buildPaymentInstructionLine(
  invoice: { paymentMethod: string; paymentBankInfo: string | null },
  onlinePaymentUrl: string,
): string {
  switch (invoice.paymentMethod) {
    case 'BANK_TRANSFER':
      return invoice.paymentBankInfo
        ? `لطفاً مبلغ فاکتور را به شماره کارت/حساب ${invoice.paymentBankInfo} واریز کنید.`
        : 'لطفاً مبلغ فاکتور را طبق هماهنگی با ما به‌صورت بانکی واریز کنید.';
    case 'ONLINE_GATEWAY':
      return `برای پرداخت آنلاین: ${onlinePaymentUrl}`;
    case 'CHECK':
      return 'لطفاً چک را به همراه شماره صیادی آن نزد ما ارسال یا تحویل دهید.';
    case 'CASH':
    default:
      return '';
  }
}

// Standard account codes from the default chart of accounts — see
// src/accounting/default-chart-of-accounts.ts. Confirming an invoice or
// recording a payment posts against these directly rather than asking the
// user to pick accounts each time, matching how a small-business ERP's
// sales cycle usually works (the accountant reconciles the chart once).
const ACCOUNT = {
  CASH: '1010',
  BANK: '1020',
  RECEIVABLE: '1030',
  INVENTORY: '1040',
  TAX_PAYABLE: '2020',
  REVENUE: '4010',
  COGS: '5010',
};

const INVOICE_INCLUDE = {
  contact: {
    select: {
      id: true,
      name: true,
      company: true,
      phone: true,
      email: true,
      type: true,
      address: true,
      nationalId: true,
      economicCode: true,
      legalId: true,
      registrationNumber: true,
    },
  },
  deal: { select: { id: true, title: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      currency: { select: { code: true, symbol: true } },
    },
  },
  payments: { orderBy: { paidAt: 'desc' as const } },
  // برای نمایش «جزئیات چک» وقتی paymentMethod === 'CHECK' — چک واقعی از همان مسیر
  // recordPayment ساخته می‌شود (نه فیلد جدا روی خود فاکتور)، پس باید این‌جا واکشی شود.
  checks: { orderBy: { createdAt: 'desc' as const } },
};

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger('InvoicesService');

  constructor(
    private readonly sms: TenantSmsService,
    private readonly creditScore: CreditScoreService,
    private readonly costing: CostingService,
    private readonly automation: AutomationEngineService,
    private readonly funnel: FunnelService,
    private readonly gateway: PaymentGatewayService,
    private readonly warranty: WarrantyService,
    private readonly controlDb: ControlPrismaService,
    private readonly referralCommission: ReferralCommissionService,
    private readonly approvals: ApprovalsService,
    private readonly stamp: CompanyStampService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler('SALES_INVOICE_CANCEL', {
      approve: async (ctx, id, opts) => {
        await this.cancelConfirmed(ctx, id, opts.requestSummary ?? 'ابطال با تأیید مدیر');
      },
      reject: async () => undefined,
      describe: async (ctx, id) => {
        const inv = await ctx.tenantDb.salesInvoice.findUniqueOrThrow({ where: { id }, include: { contact: true } });
        return {
          fields: [
            { label: 'فاکتور', value: String(inv.invoiceNo) },
            { label: 'مشتری', value: inv.contact.name },
            { label: 'مبلغ', value: `${inv.total.toLocaleString('en-US')} تومان` },
            { label: 'دلیل ابطال', value: 'در توضیح درخواست' },
          ],
        };
      },
    });
    // فاکتور رسمی: امضا/مهر فقط با تأیید مدیر (کارتابل تأیید).
    this.approvals.registerHandler('SALES_INVOICE', {
      approve: (ctx, id, opts) => this.signByApproval(ctx, id, opts.stampApplied),
      reject: async () => undefined, // رد = بدون امضا می‌ماند؛ درخواست با دلیل بسته می‌شود
      describe: async (ctx, id) => {
        const inv = await ctx.tenantDb.salesInvoice.findUniqueOrThrow({ where: { id }, include: { contact: true, lines: true } });
        return {
          fields: [
            { label: 'شماره فاکتور', value: String(inv.invoiceNo) },
            { label: 'مشتری', value: `${inv.contact.name}${inv.contact.phone ? ` — ${inv.contact.phone}` : ''}` },
            { label: 'اقلام', value: inv.lines.map((l) => `${l.description} × ${l.quantity} @ ${l.unitPrice.toLocaleString('en-US')}`).join('\n') },
            { label: 'تخفیف', value: `${inv.discount.toLocaleString('en-US')} تومان` },
            { label: 'مالیات', value: `${inv.taxAmount.toLocaleString('en-US')} تومان` },
            { label: 'مبلغ نهایی', value: `${inv.total.toLocaleString('en-US')} تومان` },
            { label: 'سررسید', value: inv.dueAt ? inv.dueAt.toLocaleDateString('fa-IR') : '—' },
            { label: 'یادداشت', value: inv.notes ?? '—' },
          ],
        };
      },
    });
  }

  /** امضای فاکتور رسمی از مسیر کارتابل مدیر — با «مهر و امضا» تصویر امضای شرکت درج می‌شود. */
  private async signByApproval(ctx: TenantRequestContext, id: string, withStamp: boolean): Promise<void> {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.signedAt) return;
    let signatureDataUrl: string | null = null;
    if (withStamp) {
      signatureDataUrl = (await this.stamp.getStamp(ctx)).signatureImage ?? null;
      if (!signatureDataUrl) throw new BadRequestException('امضای شرکت در تنظیمات عمومی ثبت نشده است');
    }
    const userId = await resolveTenantUserId(ctx).catch(() => undefined);
    const user = userId ? await ctx.tenantDb.user.findUnique({ where: { id: userId } }) : null;
    await ctx.tenantDb.salesInvoice.update({
      where: { id },
      data: { signedByUserId: userId, signedByName: user?.name ?? null, signatureDataUrl, signedAt: new Date() },
    });
  }

  async list(ctx: TenantRequestContext, scope: Record<string, unknown>, q?: string) {
    const term = normalizeSearchTerm(q);
    const no = term ? searchTermAsInt(term) : undefined;
    const invoices = await ctx.tenantDb.salesInvoice.findMany({
      where: {
        ...scope,
        ...(term
          ? {
              OR: [
                ...(no !== undefined ? [{ invoiceNo: no }, { officialInvoiceNo: no }] : []),
                { contact: { name: { contains: term, mode: 'insensitive' as const } } },
                { contact: { company: { contains: term, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      include: {
        contact: { select: { id: true, name: true, company: true } },
        _count: { select: { returns: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // hasReturn: فقط برای نمایش درست‌تر وضعیت در فهرست — فاکتوری که مرجوعی دارد
    // نباید همچنان «پرداخت‌شده» نشان داده شود (وضعیت واقعی status دست‌نخورده می‌ماند).
    return invoices.map(({ _count, ...inv }) => ({ ...inv, hasReturn: _count.returns > 0 }));
  }

  async detail(ctx: TenantRequestContext, id: string, scope: Record<string, unknown>) {
    const invoice = await ctx.tenantDb.salesInvoice.findFirst({
      where: { id, ...scope },
      include: { ...INVOICE_INCLUDE, _count: { select: { returns: true } } },
    });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    const { _count, ...rest } = invoice;
    const creditWarning = await this.getCreditWarning(ctx, invoice.contactId, invoice.id);
    return { ...rest, hasReturn: _count.returns > 0, creditWarning };
  }

  async create(ctx: TenantRequestContext, dto: CreateInvoiceDto) {
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.contactId } });
    const createdByUserId = await resolveTenantUserId(ctx);

    const lines = dto.lines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitPrice }));
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const discount = dto.discount ?? 0;
    if (discount > subtotal) throw new BadRequestException('تخفیف نمی‌تواند از جمع اقلام بیشتر باشد');

    const isOfficial = dto.isOfficial ?? false;
    const taxRate = isOfficial ? (dto.taxRate ?? 0) : undefined;
    const taxAmount = isOfficial && dto.taxRate ? Math.round(((subtotal - discount) * dto.taxRate) / 100) : 0;

    const paymentMethod = dto.paymentMethod ?? 'CASH';
    if (paymentMethod === 'ONLINE_GATEWAY' && !(await this.gateway.isConfigured(ctx))) {
      throw new BadRequestException('برای پرداخت آنلاین ابتدا درگاه پرداخت را در تنظیمات ← درگاه پرداخت وصل و فعال کنید');
    }
    if (paymentMethod === 'BANK_TRANSFER' && !dto.paymentBankInfo?.trim()) {
      throw new BadRequestException('برای روش پرداخت بانکی، شماره کارت/حساب برای نمایش به مشتری الزامی است');
    }

    // فاکتورهای رسمی توالی شماره‌گذاری مستقل خودشان را دارند (پشت‌سرهم و جدا از فاکتورهای عادی).
    let officialInvoiceNo: number | undefined;
    if (isOfficial) {
      const [{ nextval }] = await ctx.tenantDb.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('official_invoice_no_seq')`;
      officialInvoiceNo = Number(nextval);
    }

    const invoice = await ctx.tenantDb.salesInvoice.create({
      data: {
        contactId: dto.contactId,
        dealId: dto.dealId,
        projectId: dto.projectId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        discount,
        subtotal,
        taxRate,
        taxAmount,
        total: subtotal - discount + taxAmount,
        notes: dto.notes,
        paymentMethod,
        paymentBankInfo: paymentMethod === 'BANK_TRANSFER' ? dto.paymentBankInfo?.trim() : undefined,
        isOfficial,
        officialInvoiceNo,
        createdByUserId,
        lines: { create: lines },
      },
      include: INVOICE_INCLUDE,
    });
    const creditWarning = await this.getCreditWarning(ctx, invoice.contactId, invoice.id);
    return { ...invoice, creditWarning };
  }

  /**
   * Internal-only risk flag — never rendered on the customer-facing PDF,
   * only surfaced in the staff UI. Compares the customer's currently
   * outstanding balance plus this invoice against their computed (or
   * manually overridden) credit limit.
   */
  private async getCreditWarning(ctx: TenantRequestContext, contactId: string, invoiceId: string): Promise<string | null> {
    if (!(await this.isCreditModuleEnabled(ctx.tenantId))) return null;

    const invoice = await ctx.tenantDb.salesInvoice.findUnique({
      where: { id: invoiceId },
      select: { total: true, status: true },
    });
    if (!invoice) return null;

    // assess() only sums outstanding balance across non-DRAFT invoices, so a
    // still-DRAFT invoice (the common case: warning shown before it's even
    // confirmed) needs its total added in by hand to reflect what the
    // customer's balance WOULD be if this invoice goes through.
    const assessment = await this.creditScore.assess(ctx, contactId);
    const projectedOutstanding =
      invoice.status === 'DRAFT' ? assessment.totalOutstanding + invoice.total : assessment.totalOutstanding;

    if (projectedOutstanding > assessment.creditLimit) {
      return `مانده‌ی بدهی مشتری با احتساب این فاکتور (${projectedOutstanding.toLocaleString('en-US')} تومان) از سقف اعتبار محاسبه‌شده (${assessment.creditLimit.toLocaleString('en-US')} تومان) بیشتر است — امتیاز اعتباری: ${assessment.score}`;
    }
    return null;
  }

  /** همان سوییچ ماژول «اعتبارسنجی مشتری و تأمین‌کننده» (کد supplier-risk) که در فروشگاه ماژول فعال/غیرفعال می‌شود. */
  private async isCreditModuleEnabled(tenantId: string): Promise<boolean> {
    const module = await this.controlDb.moduleDefinition.findUnique({ where: { code: 'supplier-risk' } });
    if (!module) return false;
    const install = await this.controlDb.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId: module.id } },
    });
    return install ? install.status === 'INSTALLED' || install.status === 'TRIAL' : module.isCore;
  }

  /**
   * Records the sales rep's/manager's electronic signature on a finalized
   * invoice — an official invoice may only be signed by the tenant
   * owner/admin, an unofficial one by anyone with sales edit rights (the
   * controller already asserted that baseline before calling this).
   */
  async sign(ctx: TenantRequestContext, id: string, dto: SignInvoiceDto) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.status === 'DRAFT') throw new BadRequestException('ابتدا باید فاکتور تأیید (نهایی) شود');
    if (invoice.isOfficial && ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('فاکتور رسمی فقط توسط مالک یا مدیر سیستم قابل امضا است');
    }

    const userId = await resolveTenantUserId(ctx);
    const user = userId ? await ctx.tenantDb.user.findUnique({ where: { id: userId } }) : null;

    await this.approvals.closeForEntity(ctx, 'SALES_INVOICE', id, 'APPROVED', !!dto.signatureDataUrl);
    return ctx.tenantDb.salesInvoice.update({
      where: { id },
      data: {
        signedByUserId: userId,
        signedByName: user?.name ?? null,
        signatureDataUrl: dto.signatureDataUrl,
        signedAt: new Date(),
      },
      include: INVOICE_INCLUDE,
    });
  }

  async getDeliverySmsTemplate(ctx: TenantRequestContext): Promise<string> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: SALES_SETTINGS_MODULE, key: DELIVERY_SMS_TEMPLATE_KEY } },
    });
    const value = row?.value;
    return typeof value === 'string' && value.trim() ? value : DEFAULT_DELIVERY_SMS_TEMPLATE;
  }

  async setDeliverySmsTemplate(ctx: TenantRequestContext, template: string): Promise<void> {
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: SALES_SETTINGS_MODULE, key: DELIVERY_SMS_TEMPLATE_KEY } },
      create: { moduleCode: SALES_SETTINGS_MODULE, key: DELIVERY_SMS_TEMPLATE_KEY, value: template },
      update: { value: template },
    });
  }

  /**
   * پیش‌فرض شماره کارت/حساب بانکی شرکت که هنگام انتخاب روش پرداخت «بانکی» در فرم
   * فاکتور جدید به‌عنوان پیشنهاد نمایش داده می‌شود — صادرکننده می‌تواند آن را برای هر
   * فاکتور تغییر دهد. تنظیمات → عمومی فیلد «حساب بانکی شرکت» جداگانه‌ای ندارد، پس این
   * مقدار مثل الگوی الگوی پیامک تحویل بالا، زیر تنظیمات همین ماژول (فروش) نگه‌داری می‌شود.
   */
  private static readonly DEFAULT_BANK_INFO_KEY = 'defaultBankInfo';

  async getDefaultBankInfo(tenantDb: TenantRequestContext['tenantDb']): Promise<string> {
    const row = await tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: SALES_SETTINGS_MODULE, key: InvoicesService.DEFAULT_BANK_INFO_KEY } },
    });
    const value = row?.value;
    return typeof value === 'string' ? value : '';
  }

  async setDefaultBankInfo(ctx: TenantRequestContext, value: string): Promise<void> {
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: SALES_SETTINGS_MODULE, key: InvoicesService.DEFAULT_BANK_INFO_KEY } },
      create: { moduleCode: SALES_SETTINGS_MODULE, key: InvoicesService.DEFAULT_BANK_INFO_KEY, value },
      update: { value },
    });
  }

  /** چند روز پیش از سررسید فاکتور (یا چند روز پس از آن اگر معوق شود)، یادآور تکمیل وجه برای مشتری و مدیر ارسال شود. */
  async getPaymentReminderDays(tenantDb: TenantRequestContext['tenantDb']): Promise<number> {
    const row = await tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: SALES_SETTINGS_MODULE, key: PAYMENT_REMINDER_DAYS_KEY } },
    });
    const value = row ? Number(row.value) : NaN;
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_PAYMENT_REMINDER_DAYS;
  }

  async setPaymentReminderDays(ctx: TenantRequestContext, days: number): Promise<void> {
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: SALES_SETTINGS_MODULE, key: PAYMENT_REMINDER_DAYS_KEY } },
      create: { moduleCode: SALES_SETTINGS_MODULE, key: PAYMENT_REMINDER_DAYS_KEY, value: days },
      update: { value: days },
    });
  }

  /**
   * Sends a one-time confirmation code to the customer's phone (falls back
   * to returning the code directly when SMS isn't configured, same rule as
   * OTP login — never echo a code that was actually delivered by SMS).
   */
  async sendDeliveryCode(ctx: TenantRequestContext, id: string) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({
      where: { id },
      include: { contact: { select: { phone: true } } },
    });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.status === 'DRAFT') throw new BadRequestException('ابتدا باید فاکتور تأیید (نهایی) شود');
    if (invoice.deliveryConfirmedAt) throw new BadRequestException('تحویل این فاکتور قبلاً تأیید شده است');

    const code = generateDeliveryCode();
    const codeHash = await bcrypt.hash(code, 10);
    await ctx.tenantDb.salesInvoice.update({
      where: { id },
      data: {
        deliveryCodeHash: codeHash,
        deliveryCodeExpiresAt: new Date(Date.now() + DELIVERY_CODE_TTL_MS),
        deliveryCodeSentAt: new Date(),
      },
    });

    let smsSent = false;
    if (invoice.contact.phone) {
      const template = await this.getDeliverySmsTemplate(ctx);
      const message = renderDeliverySmsTemplate(template, { code, invoiceNo: invoice.invoiceNo });
      const result = await this.sms.sendSms(ctx, invoice.contact.phone, message);
      smsSent = result.success;
    }

    return {
      expiresInSeconds: DELIVERY_CODE_TTL_MS / 1000,
      smsSent,
      ...(!smsSent ? { devCode: code } : {}),
    };
  }

  /** Records the customer's delivery confirmation — either the SMS code they read back, or a signature drawn on the delivery person's device. */
  async confirmDelivery(ctx: TenantRequestContext, id: string, dto: ConfirmDeliveryDto) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.status === 'DRAFT') throw new BadRequestException('ابتدا باید فاکتور تأیید (نهایی) شود');
    if (invoice.deliveryConfirmedAt) throw new BadRequestException('تحویل این فاکتور قبلاً تأیید شده است');

    if (dto.method === 'CODE') {
      if (!dto.code) throw new BadRequestException('کد تأیید الزامی است');
      if (!invoice.deliveryCodeHash || !invoice.deliveryCodeExpiresAt) {
        throw new BadRequestException('ابتدا باید کد تأیید برای مشتری ارسال شود');
      }
      if (invoice.deliveryCodeExpiresAt < new Date()) throw new BadRequestException('کد تأیید منقضی شده است');
      const valid = await bcrypt.compare(dto.code, invoice.deliveryCodeHash);
      if (!valid) throw new BadRequestException('کد تأیید نادرست است');
    } else {
      if (!dto.signatureDataUrl) throw new BadRequestException('امضا الزامی است');
    }

    return ctx.tenantDb.salesInvoice.update({
      where: { id },
      data: {
        deliveryConfirmedAt: new Date(),
        deliveryConfirmedName: dto.confirmerName,
        deliverySignatureDataUrl: dto.method === 'SIGNATURE' ? dto.signatureDataUrl : null,
        deliveryCodeHash: null,
        deliveryCodeExpiresAt: null,
      },
      include: INVOICE_INCLUDE,
    });
  }

  /**
   * The one operation that actually wires sales into warehouse + accounting:
   * issues a stock-out movement per line (so inventory drops for real) and
   * posts a balanced journal entry — Dr Accounts Receivable / Cr Sales
   * Revenue for the sale, plus Dr COGS / Cr Inventory for whatever cost
   * basis the product lines carry. A DRAFT invoice has no effect on either
   * until this runs.
   */
  async confirm(ctx: TenantRequestContext, id: string) {
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({
      where: { id },
      include: { lines: { include: { product: true } } },
    });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.status !== 'DRAFT') throw new BadRequestException('فقط فاکتور پیش‌نویس قابل تأیید است');

    const userId = await resolveTenantUserId(ctx);
    const warehouse = await ensureDefaultWarehouse(ctx.tenantDb);
    const receivable = await this.getAccount(ctx, ACCOUNT.RECEIVABLE);
    const revenue = await this.getAccount(ctx, ACCOUNT.REVENUE);
    const lineCosts = await Promise.all(
      invoice.lines.map((l) => (l.productId ? this.costing.costIssue(ctx, l.productId, l.quantity) : Promise.resolve(0))),
    );
    const cogsAmount = lineCosts.reduce((sum, c) => sum + c, 0);

    // مبلغ فاکتور شامل مالیات است، اما درآمد شناسایی‌شده فقط جمع اقلام پس از
    // تخفیف است — مابه‌التفاوت به‌عنوان بدهی مالیاتی (نه درآمد) ثبت می‌شود.
    const netRevenue = invoice.total - invoice.taxAmount;
    const journalLines = [
      { accountId: receivable.id, debit: BigInt(invoice.total), credit: BigInt(0) },
      { accountId: revenue.id, debit: BigInt(0), credit: BigInt(netRevenue) },
    ];
    if (invoice.taxAmount > 0) {
      const taxPayable = await this.getAccount(ctx, ACCOUNT.TAX_PAYABLE);
      journalLines.push({ accountId: taxPayable.id, debit: BigInt(0), credit: BigInt(invoice.taxAmount) });
    }
    if (cogsAmount > 0) {
      const cogs = await this.getAccount(ctx, ACCOUNT.COGS);
      const inventory = await this.getAccount(ctx, ACCOUNT.INVENTORY);
      journalLines.push(
        { accountId: cogs.id, debit: BigInt(cogsAmount), credit: BigInt(0) },
        { accountId: inventory.id, debit: BigInt(0), credit: BigInt(cogsAmount) },
      );
    }

    const [entry] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.journalEntry.create({
        data: {
          date: new Date(),
          description: `فاکتور فروش شماره ${invoice.invoiceNo}`,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId,
          lines: { create: journalLines },
        },
      }),
      ...invoice.lines
        .filter((l) => l.productId)
        .map((l) =>
          ctx.tenantDb.stockMovement.create({
            data: {
              productId: l.productId!,
              warehouseId: warehouse.id,
              type: 'ISSUE',
              quantityDelta: -l.quantity,
              reference: `فاکتور فروش #${invoice.invoiceNo}`,
              createdByUserId: userId,
            },
          }),
        ),
    ]);

    const confirmed = await ctx.tenantDb.salesInvoice.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), journalEntryId: entry.id },
      include: INVOICE_INCLUDE,
    });
    if (confirmed.isOfficial && !confirmed.signedAt) {
      await this.approvals.request(ctx, {
        moduleCode: 'sales',
        entityType: 'SALES_INVOICE',
        entityId: id,
        title: `امضای فاکتور رسمی ${confirmed.invoiceNo}`,
        summary: `${confirmed.contact?.name ?? ''} — ${confirmed.total.toLocaleString('en-US')} تومان`,
        link: '/sales',
        isOfficial: true,
        requestedByUserId: userId ?? undefined,
      });
    }
    return confirmed;
  }

  async recordPayment(ctx: TenantRequestContext, id: string, dto: RecordPaymentDto) {
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.status !== 'CONFIRMED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new BadRequestException('فقط فاکتور تأییدشده قابل ثبت پرداخت است');
    }
    const remaining = invoice.total - invoice.paidAmount;
    if (dto.amount > remaining) throw new BadRequestException('مبلغ پرداخت از باقی‌مانده‌ی فاکتور بیشتر است');

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw new BadRequestException('تاریخ پرداخت نامعتبر است');
    if (paidAt.getTime() > Date.now() + 24 * 3600 * 1000) throw new BadRequestException('تاریخ پرداخت نمی‌تواند در آینده باشد');
    if (paidAt.getTime() < invoice.issuedAt.getTime() - 24 * 3600 * 1000) {
      throw new BadRequestException('تاریخ پرداخت نمی‌تواند قبل از تاریخ صدور فاکتور باشد');
    }

    const method = dto.method ?? 'CASH';
    if (method === 'CHECK' && (!dto.checkSayadId || !dto.checkDueDate)) {
      throw new BadRequestException('برای پرداخت چکی، شماره صیادی و تاریخ سررسید الزامی است');
    }
    const cashAccountCode = method === 'CASH' || method === 'POS' ? ACCOUNT.CASH : ACCOUNT.BANK;
    const cashAccount = await this.getAccount(ctx, cashAccountCode);
    const receivable = await this.getAccount(ctx, ACCOUNT.RECEIVABLE);
    const userId = await resolveTenantUserId(ctx);

    const newPaidAmount = invoice.paidAmount + dto.amount;
    const newStatus = newPaidAmount >= invoice.total ? 'PAID' : 'PARTIALLY_PAID';

    await ctx.tenantDb.$transaction([
      ctx.tenantDb.salesPayment.create({
        data: { invoiceId: id, amount: dto.amount, method, note: dto.note, paidAt },
      }),
      ...(method === 'CHECK'
        ? [
            ctx.tenantDb.check.create({
              data: {
                direction: 'RECEIVED',
                sayadId: dto.checkSayadId!,
                amount: dto.amount,
                dueDate: new Date(dto.checkDueDate!),
                bankName: dto.checkBankName,
                photoDataUrl: dto.checkPhotoDataUrl,
                contactId: invoice.contactId,
                invoiceId: invoice.id,
                createdByUserId: userId,
              },
            }),
          ]
        : []),
      ctx.tenantDb.journalEntry.create({
        data: {
          date: paidAt,
          description: `دریافت وجه فاکتور فروش شماره ${invoice.invoiceNo}`,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId,
          lines: {
            create: [
              { accountId: cashAccount.id, debit: BigInt(dto.amount), credit: BigInt(0) },
              { accountId: receivable.id, debit: BigInt(0), credit: BigInt(dto.amount) },
            ],
          },
        },
      }),
      ctx.tenantDb.salesInvoice.update({
        where: { id },
        data: { paidAmount: newPaidAmount, status: newStatus },
      }),
    ]);

    const updatedInvoice = await ctx.tenantDb.salesInvoice.findUniqueOrThrow({ where: { id }, include: INVOICE_INCLUDE });
    await this.automation.emit(ctx, 'sales.invoice.payment_recorded', {
      invoiceNo: updatedInvoice.invoiceNo,
      customerName: updatedInvoice.contact.name,
      customerPhone: updatedInvoice.contact.phone,
      amount: dto.amount,
      remaining: updatedInvoice.total - updatedInvoice.paidAmount,
    });
    if (newStatus === 'PAID') {
      await this.funnel.recordPurchase(ctx, updatedInvoice.contactId, updatedInvoice.total, 'خرید مجدد (فاکتور فروش)');
      try {
        await this.warranty.issueForInvoicePaid(ctx, updatedInvoice.id);
      } catch (err) {
        // صدور گارانتی هرگز نباید ثبت پرداخت فاکتور را با شکست مواجه کند
        this.logger.error(`Warranty issuance failed for invoice ${updatedInvoice.id}: ${err instanceof Error ? err.message : err}`);
      }
      try {
        const conversion = await ctx.tenantDb.referralConversion.findUnique({ where: { contactId: updatedInvoice.contactId } });
        if (conversion) {
          const description = `کمیسیون معرفی — فاکتور فروش شماره ${updatedInvoice.invoiceNo}`;
          await this.referralCommission.bookCommission(ctx.tenantDb, conversion.id, updatedInvoice.total, description);
        }
      } catch (err) {
        // کمیسیون نماینده هرگز نباید ثبت پرداخت فاکتور را با شکست مواجه کند
        this.logger.error(`Referral commission booking failed for invoice ${updatedInvoice.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return updatedInvoice;
  }

  private async getAccount(ctx: TenantRequestContext, code: string) {
    const account = await ctx.tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new BadRequestException(`کدینگ حسابداری ${code} یافت نشد — ابتدا از بخش حسابداری بازدید کنید`);
    return account;
  }

  /** برای صفحه‌ی عمومی مشاهده/پرداخت فاکتور — با publicToken (نه id/شماره‌ی قابل حدس) پیدا می‌شود. */
  async findByPublicToken(ctx: TenantRequestContext, publicToken: string) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { publicToken }, include: INVOICE_INCLUDE });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    return invoice;
  }

  /**
   * لینک عمومی فاکتور را برای مشتری پیامک می‌کند — متن راهنمای پرداخت روی همان روشی
   * است که صادرکننده برای این فاکتور انتخاب کرده (بانکی/آنلاین/چکی)، نه یک لینک
   * پرداخت آنلاین یک‌شکل روی هر فاکتور.
   */
  async sendPaymentLinkSms(ctx: TenantRequestContext, id: string, publicWebUrl: string) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id }, include: { contact: true } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (!invoice.contact.phone) throw new BadRequestException('این مشتری شماره موبایل ثبت‌شده ندارد');

    const url = `${publicWebUrl}/invoice/${publicRef(ctx.tenantSlug)}/${invoice.publicToken}`;
    const remaining = invoice.total - invoice.paidAmount;
    const instruction = remaining > 0 ? buildPaymentInstructionLine(invoice, url) : '';
    const message =
      remaining > 0
        ? `فاکتور شماره ${invoice.invoiceNo} به مبلغ ${remaining.toLocaleString('fa-IR')} تومان صادر شد.\nمشاهده: ${url}${instruction ? `\n${instruction}` : ''}`
        : `فاکتور شماره ${invoice.invoiceNo} برای شما صادر شد.\nمشاهده: ${url}`;
    const result = await this.sms.sendSms(ctx, invoice.contact.phone, message);
    if (!result.success) throw new BadRequestException(result.error ?? 'ارسال پیامک ناموفق بود');
    return { ok: true, url };
  }

  /**
   * شروع پرداخت آنلاین باقی‌مانده‌ی فاکتور از طریق زرین‌پال — فقط برای فاکتوری که
   * صادرکننده در لحظه‌ی صدور خودش «پرداخت آنلاین» را به‌عنوان روش پرداخت انتخاب کرده
   * (paymentMethod === 'ONLINE_GATEWAY')، نه هر فاکتور تأییدشده‌ای.
   *
   * درگاه همیشه درگاهِ اختصاصی خود تننت است (ماژول «درگاه پرداخت»)، نه مرچنت پلتفرم اکسیر.
   */
  async initiateGatewayPayment(ctx: TenantRequestContext, id: string, callbackUrl: string): Promise<{ paymentUrl: string } | null> {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.status !== 'CONFIRMED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new BadRequestException('این فاکتور هنوز تأیید نشده و آماده‌ی پرداخت نیست');
    }
    if (invoice.paymentMethod !== 'ONLINE_GATEWAY') {
      throw new BadRequestException('روش پرداخت این فاکتور آنلاین نیست — پرداخت آنلاین برای آن فعال نشده است');
    }
    const remaining = invoice.total - invoice.paidAmount;
    if (remaining <= 0) throw new BadRequestException('این فاکتور قبلاً تسویه شده است');

    const result = await this.gateway.createPayment({
      ctx,
      amount: remaining,
      description: `فاکتور فروش شماره ${invoice.invoiceNo}`,
      callbackUrl,
    });
    if (!result) return null;
    await ctx.tenantDb.salesInvoice.update({ where: { id }, data: { zarinpalAuthority: result.authority } });
    return { paymentUrl: result.redirectUrl };
  }

  /** بازگشت از درگاه — تأیید تراکنش و ثبت پرداخت از همان مسیر دستی recordPayment (سند حسابداری و رهگیری قیف یکسان می‌ماند). */
  async verifyGatewayPayment(ctx: TenantRequestContext, id: string, authority: string, transId?: string): Promise<{ success: boolean }> {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    if (invoice.status === 'PAID') return { success: true }; // قبلاً تسویه شده — idempotent
    if (!invoice.zarinpalAuthority || invoice.zarinpalAuthority !== authority) return { success: false };

    const remaining = invoice.total - invoice.paidAmount;
    const result = await this.gateway.verifyPayment({ ctx, authority, amount: remaining, transId });
    if (!result?.success) return { success: false };

    const refNumber = result.refId && /^\d+$/.test(result.refId) ? Number(result.refId) : null;
    if (refNumber !== null) await ctx.tenantDb.salesInvoice.update({ where: { id }, data: { paymentRefId: refNumber } });
    const gatewayName = result.provider === 'BITPAY' ? 'بیت‌پی' : 'زرین‌پال';
    await this.recordPayment(ctx, id, {
      amount: remaining,
      method: 'ONLINE_GATEWAY',
      note: result.refId ? `کد پیگیری ${gatewayName}: ${result.refId}` : undefined,
    });
    return { success: true };
  }

  /** ویرایش فاکتور پیش‌نویس (اقلام، تخفیف، سررسید، یادداشت). فاکتور تأییدشده ویرایش نمی‌شود؛ ابطال و فاکتور جدید. */
  async updateDraft(ctx: TenantRequestContext, id: string, dto: CreateInvoiceDto) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    await assertNotTaxLocked(ctx.tenantDb, id, 'ویرایش فاکتور');
    if (invoice.status !== 'DRAFT') throw new BadRequestException('فقط فاکتور پیش‌نویس قابل ویرایش است؛ فاکتور تأییدشده را باطل و فاکتور تازه صادر کنید');
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.contactId } });

    const lines = dto.lines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitPrice }));
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const discount = dto.discount ?? 0;
    if (discount > subtotal) throw new BadRequestException('تخفیف نمی‌تواند از جمع اقلام بیشتر باشد');
    const taxRate = invoice.isOfficial ? (dto.taxRate ?? invoice.taxRate ?? 0) : undefined;
    const taxAmount = invoice.isOfficial && taxRate ? Math.round(((subtotal - discount) * taxRate) / 100) : 0;

    const paymentMethod = dto.paymentMethod ?? invoice.paymentMethod;
    if (paymentMethod === 'ONLINE_GATEWAY' && !(await this.gateway.isConfigured(ctx))) {
      throw new BadRequestException('برای پرداخت آنلاین ابتدا درگاه پرداخت را در تنظیمات ← درگاه پرداخت وصل و فعال کنید');
    }
    if (paymentMethod === 'BANK_TRANSFER' && !(dto.paymentBankInfo?.trim() ?? invoice.paymentBankInfo)) {
      throw new BadRequestException('برای روش پرداخت بانکی، شماره کارت/حساب برای نمایش به مشتری الزامی است');
    }

    await ctx.tenantDb.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
    return ctx.tenantDb.salesInvoice.update({
      where: { id },
      data: {
        contactId: dto.contactId,
        dealId: dto.dealId,
        projectId: dto.projectId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        discount,
        subtotal,
        taxRate,
        taxAmount,
        total: subtotal - discount + taxAmount,
        notes: dto.notes,
        paymentMethod,
        paymentBankInfo: paymentMethod === 'BANK_TRANSFER' ? (dto.paymentBankInfo?.trim() ?? invoice.paymentBankInfo) : null,
        lines: { create: lines },
      },
      include: INVOICE_INCLUDE,
    });
  }

  async removeDraft(ctx: TenantRequestContext, id: string) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    await assertNotTaxLocked(ctx.tenantDb, id, 'حذف فاکتور');
    if (invoice.status !== 'DRAFT') throw new BadRequestException('فقط فاکتور پیش‌نویس حذف می‌شود؛ فاکتور تأییدشده را باطل کنید');
    await ctx.tenantDb.salesInvoice.delete({ where: { id } });
    await this.approvals.closeForEntity(ctx, 'SALES_INVOICE', id, 'REJECTED');
    return { success: true };
  }

  /**
   * ابطال فاکتور تأییدشده: سند حسابداری معکوس، برگشت موجودی کالاها و وضعیت CANCELLED. فقط برای فاکتور
   * بدون پرداخت و بدون مرجوعی (وگرنه ابتدا آن‌ها باید برگردانده شوند). غیرمدیر فقط درخواست ثبت می‌کند.
   */
  async cancel(ctx: TenantRequestContext, id: string, reason: string) {
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    await assertNotTaxLocked(ctx.tenantDb, id, 'ابطال فاکتور');
    this.assertCancellable(invoice);
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const outcome = await this.approvals.runOrRequest(
      ctx,
      { moduleCode: 'sales', entityType: 'SALES_INVOICE_CANCEL', entityId: id, title: `ابطال فاکتور فروش ${invoice.invoiceNo}`, summary: reason, link: '/sales', requestedByUserId: userId ?? undefined },
      () => this.cancelConfirmed(ctx, id, reason),
    );
    return { success: true, pendingApproval: !outcome.executed };
  }

  private assertCancellable(invoice: { status: string; paidAmount: number }) {
    if (invoice.status !== 'CONFIRMED') throw new BadRequestException('فقط فاکتور تأییدشده‌ی بدون پرداخت قابل ابطال است');
    if (invoice.paidAmount > 0) throw new BadRequestException('این فاکتور پرداخت دارد؛ ابتدا پرداخت‌ها را برگردانید');
  }

  private async cancelConfirmed(ctx: TenantRequestContext, id: string, reason: string) {
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const invoice = await ctx.tenantDb.salesInvoice.findUnique({ where: { id }, include: { lines: true } });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    await assertNotTaxLocked(ctx.tenantDb, id, 'ابطال فاکتور'); // دوباره: ممکن است پس از ثبت درخواست تأیید، صورتحساب مالیاتی ساخته شده باشد
    this.assertCancellable(invoice);
    const returns = await ctx.tenantDb.salesReturn.count({ where: { invoiceId: id } });
    if (returns > 0) throw new BadRequestException('برای این فاکتور مرجوعی ثبت شده است و ابطال کامل ممکن نیست');

    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const warehouse = await ensureDefaultWarehouse(ctx.tenantDb);
    const original = invoice.journalEntryId
      ? await ctx.tenantDb.journalEntry.findUnique({ where: { id: invoice.journalEntryId }, include: { lines: true } })
      : null;

    await ctx.tenantDb.$transaction([
      ...(original
        ? [
            ctx.tenantDb.journalEntry.create({
              data: {
                date: new Date(),
                description: `ابطال فاکتور فروش شماره ${invoice.invoiceNo}: ${reason}`,
                status: 'POSTED',
                postedAt: new Date(),
                reversalOfId: original.id,
                createdByUserId: userId ?? undefined,
                lines: { create: original.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description })) },
              },
            }),
            ctx.tenantDb.journalEntry.update({ where: { id: original.id }, data: { voidedAt: new Date(), voidReason: reason } }),
          ]
        : []),
      ...invoice.lines
        .filter((l) => l.productId)
        .map((l) =>
          ctx.tenantDb.stockMovement.create({
            data: {
              productId: l.productId!,
              warehouseId: warehouse.id,
              type: 'SALES_RETURN',
              quantityDelta: l.quantity,
              reference: `ابطال فاکتور فروش #${invoice.invoiceNo}`,
              createdByUserId: userId ?? undefined,
            },
          }),
        ),
      ctx.tenantDb.salesInvoice.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } }),
    ]);
    await this.approvals.closeForEntity(ctx, 'SALES_INVOICE_CANCEL', id, 'APPROVED');
    await this.approvals.closeForEntity(ctx, 'SALES_INVOICE', id, 'REJECTED');
    return { success: true };
  }
}
