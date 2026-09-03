import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import { ensureDefaultWarehouse } from '../warehouse/default-warehouse.js';
import { CostingService } from '../warehouse/costing.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { CreditScoreService } from '../crm/credit-score.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import type { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import type { RecordPaymentDto } from './dto/record-payment.dto.js';
import type { SignInvoiceDto } from './dto/sign-invoice.dto.js';
import type { ConfirmDeliveryDto } from './dto/confirm-delivery.dto.js';

const DELIVERY_CODE_TTL_MS = 30 * 60 * 1000;
const SALES_SETTINGS_MODULE = 'sales';
const DELIVERY_SMS_TEMPLATE_KEY = 'deliveryCodeSmsTemplate';
const DEFAULT_DELIVERY_SMS_TEMPLATE = 'کد تأیید تحویل فاکتور شماره {invoiceNo} اکسیر ERP: {code}';
const PAYMENT_REMINDER_DAYS_KEY = 'paymentReminderDaysBefore';
const DEFAULT_PAYMENT_REMINDER_DAYS = 3;

function generateDeliveryCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function renderDeliverySmsTemplate(template: string, vars: { code: string; invoiceNo: number }): string {
  return template.replace(/\{code\}/g, vars.code).replace(/\{invoiceNo\}/g, String(vars.invoiceNo));
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
};

@Injectable()
export class InvoicesService {
  constructor(
    private readonly sms: ExirSmsService,
    private readonly creditScore: CreditScoreService,
    private readonly costing: CostingService,
    private readonly automation: AutomationEngineService,
  ) {}

  list(ctx: TenantRequestContext, scope: Record<string, unknown>) {
    return ctx.tenantDb.salesInvoice.findMany({
      where: scope,
      include: { contact: { select: { id: true, name: true, company: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string, scope: Record<string, unknown>) {
    const invoice = await ctx.tenantDb.salesInvoice.findFirst({ where: { id, ...scope }, include: INVOICE_INCLUDE });
    if (!invoice) throw new NotFoundException('فاکتور فروش یافت نشد');
    const creditWarning = await this.getCreditWarning(ctx, invoice.contactId, invoice.id);
    return { ...invoice, creditWarning };
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
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        discount,
        subtotal,
        taxRate,
        taxAmount,
        total: subtotal - discount + taxAmount,
        notes: dto.notes,
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
    if (invoice.contact.phone && this.sms.isConfigured()) {
      const template = await this.getDeliverySmsTemplate(ctx);
      const message = renderDeliverySmsTemplate(template, { code, invoiceNo: invoice.invoiceNo });
      const result = await this.sms.sendSms(invoice.contact.phone, message);
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

    return ctx.tenantDb.salesInvoice.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), journalEntryId: entry.id },
      include: INVOICE_INCLUDE,
    });
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
        data: { invoiceId: id, amount: dto.amount, method, note: dto.note },
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
                contactId: invoice.contactId,
                invoiceId: invoice.id,
                createdByUserId: userId,
              },
            }),
          ]
        : []),
      ctx.tenantDb.journalEntry.create({
        data: {
          date: new Date(),
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
    return updatedInvoice;
  }

  private async getAccount(ctx: TenantRequestContext, code: string) {
    const account = await ctx.tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new BadRequestException(`کدینگ حسابداری ${code} یافت نشد — ابتدا از بخش حسابداری بازدید کنید`);
    return account;
  }
}
