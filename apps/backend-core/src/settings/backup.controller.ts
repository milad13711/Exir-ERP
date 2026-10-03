import { BadRequestException, Body, ConflictException, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { BackupService, stringifyWithBigInt } from './backup.service.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** رشته‌های تاریخ ISO را به Date تبدیل می‌کند — چون JSON.parse خودش این کار را نمی‌کند. */
function revive(value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) return new Date(value);
  if (Array.isArray(value)) return value.map((v) => revive(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
  }
  return value;
}

/**
 * فیلدهای BigInt در Prisma با یک عدد معمولی JS جایگزین نمی‌شوند — این کدها
 * چند فیلد هم‌نام دارند که بعضی Int و بعضی BigInt‌اند (مثلاً amount روی
 * SalesPayment در برابر BankStatementLine)، پس تبدیل باید دقیقاً روی همان
 * فیلدِ همان جدول اعمال شود، نه بر اساس نام کلید به‌تنهایی.
 */
function toBigInt<T extends Record<string, unknown>>(rows: T[], field: keyof T): T[] {
  return rows.map((row) => ({ ...row, [field]: BigInt(Math.round(Number(row[field]))) }));
}

function withoutKeys<T extends Record<string, unknown>>(rows: T[], keys: string[]): T[] {
  return rows.map((row) => {
    const copy = { ...row };
    for (const key of keys) delete copy[key];
    return copy;
  });
}

/**
 * پشتیبان‌گیری کامل — پیش‌فرض یک فایل SQL فشرده (pg_dump واقعی، همه‌ی جدول‌ها
 * و ماژول‌ها، بازیابی با psql). خروجی JSON (`?format=json`) فقط برای مسیر
 * قدیمی «بازیابی از داخل برنامه» نگه داشته شده — پوشش آن محدود به جدول‌های
 * اصلی است و برای آرشیو کامل توصیه نمی‌شود.
 */
@Controller('settings/backup')
@UseGuards(JwtAuthGuard)
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get('export')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async export(@Query('format') format: string | undefined, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    const day = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const payload = await this.backup.buildExportPayload(ctx.tenantDb, ctx.tenantId);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="exir-backup-${day}.json"`);
      res.send(stringifyWithBigInt(payload, 2));
      return;
    }

    const conn = await this.backup.getTenantConnection(ctx.tenantId);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="exir-backup-${day}.sql.gz"`);
    try {
      await this.backup.streamTenantDump(conn, res);
    } catch (err) {
      // هدرها قبلاً رفته‌اند؛ تنها راه اعلام شکست قطع کردن اتصال است تا کلاینت فایل ناقص را «موفق» ندانَد.
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * بازیابی از فایل خروجی همین ماژول — فقط روی محیط کاری کاملاً خالی مجاز
   * است (چک روی مخاطبین و فاکتورهای فروش)، چون شناسه‌ها همان UUID اصلی‌شان
   * را دوباره می‌گیرند و روی یک محیط پر از داده حتماً با تداخل کلید یکتا
   * برخورد می‌کند. هر جدول با createMany پر می‌شود (نه ساخت تودرتو)، به
   * ترتیبی که وابستگی‌های کلید خارجی را رعایت کند.
   */
  @Post('import')
  @UseGuards(RolesGuard)
  @Roles('OWNER')
  async import(@Body() body: { data?: Record<string, unknown[]> }, @Ctx() ctx: TenantRequestContext) {
    if (!body?.data || typeof body.data !== 'object') {
      throw new BadRequestException('ساختار فایل پشتیبان نامعتبر است');
    }
    const db = ctx.tenantDb;

    const [existingContacts, existingInvoices] = await Promise.all([
      db.crmContact.count(),
      db.salesInvoice.count(),
    ]);
    if (existingContacts > 0 || existingInvoices > 0) {
      throw new ConflictException(
        'بازیابی فقط روی یک محیط کاری کاملاً خالی مجاز است — این محیط از قبل داده دارد',
      );
    }

    const data = revive(body.data) as Record<string, Array<Record<string, unknown>>>;
    const g = (key: string) => data[key] ?? [];

    const journalEntries = g('journalEntries');
    const salesInvoices = g('salesInvoices');
    const salesQuotations = g('salesQuotations');
    const salesReturns = g('salesReturns');
    const purchaseOrders = g('purchaseOrders');
    const purchaseReturns = g('purchaseReturns');
    const budgets = g('budgets');
    const recurringInvoiceTemplates = g('recurringInvoiceTemplates');

    try {
      // ترتیب دقیقاً بر اساس وابستگی کلید خارجی است؛ همه در یک تراکنش
      // واحد اجرا می‌شوند تا یک خطای نیمه‌راه، داده‌ی ناقص به‌جا نگذارد.
      // چند جدول ممکن است حتی روی یک محیط «خالی» طبق تعریف این‌جا (بدون
      // مشتری/فاکتور) از قبل ردیف داشته باشند — warehouses چون خود migration
      // یک ردیف پیش‌فرض seed می‌کند، و users چون فرایند provisioning تننت
      // یک کاربر مالک می‌سازد. این‌ها را پاک می‌کنیم تا خود فایل پشتیبان
      // بدون تصادم کلید یکتا جایگزینشان شود.
      await db.$transaction([
        db.warehouse.deleteMany({}),
        db.userRole.deleteMany({}),
        db.user.deleteMany({}),
        db.role.deleteMany({}),
        db.user.createMany({ data: g('users') as never[] }),
        db.role.createMany({ data: g('roles') as never[] }),
        db.userRole.createMany({ data: g('userRoles') as never[] }),
        db.modulePermission.createMany({ data: g('modulePermissions') as never[] }),
        db.moduleSetting.createMany({ data: g('moduleSettings') as never[] }),
        db.account.createMany({ data: g('accounts') as never[] }),
        db.currency.createMany({ data: g('currencies') as never[] }),
        db.warehouse.createMany({ data: g('warehouses') as never[] }),
        db.product.createMany({ data: g('products') as never[] }),
        db.crmContact.createMany({ data: g('crmContacts') as never[] }),
        db.crmDeal.createMany({ data: toBigInt(g('crmDeals'), 'value') as never[] }),
        db.crmActivity.createMany({ data: g('crmActivities') as never[] }),
        db.employee.createMany({ data: g('employees') as never[] }),
        db.journalEntry.createMany({ data: withoutKeys(journalEntries, ['lines']) as never[] }),
        db.journalLine.createMany({
          data: toBigInt(toBigInt(journalEntries.flatMap((e) => e.lines as Record<string, unknown>[]), 'debit'), 'credit') as never[],
        }),
        db.salesInvoice.createMany({ data: withoutKeys(salesInvoices, ['lines', 'payments']) as never[] }),
        db.salesInvoiceLine.createMany({ data: salesInvoices.flatMap((i) => i.lines as never[]) }),
        db.salesPayment.createMany({ data: salesInvoices.flatMap((i) => i.payments as never[]) }),
        db.salesQuotation.createMany({ data: withoutKeys(salesQuotations, ['lines']) as never[] }),
        db.salesQuotationLine.createMany({ data: salesQuotations.flatMap((q) => q.lines as never[]) }),
        db.salesReturn.createMany({ data: withoutKeys(salesReturns, ['lines']) as never[] }),
        db.salesReturnLine.createMany({ data: salesReturns.flatMap((r) => r.lines as never[]) }),
        db.purchaseOrder.createMany({ data: withoutKeys(purchaseOrders, ['lines', 'payments']) as never[] }),
        db.purchaseOrderLine.createMany({ data: purchaseOrders.flatMap((o) => o.lines as never[]) }),
        db.purchasePayment.createMany({ data: purchaseOrders.flatMap((o) => o.payments as never[]) }),
        db.purchaseReturn.createMany({ data: withoutKeys(purchaseReturns, ['lines']) as never[] }),
        db.purchaseReturnLine.createMany({ data: purchaseReturns.flatMap((r) => r.lines as never[]) }),
        db.check.createMany({ data: g('checks') as never[] }),
        db.stockMovement.createMany({ data: g('stockMovements') as never[] }),
        db.budget.createMany({ data: withoutKeys(budgets, ['lines']) as never[] }),
        db.budgetLine.createMany({ data: budgets.flatMap((b) => b.lines as never[]) }),
        db.fixedAsset.createMany({ data: g('fixedAssets') as never[] }),
        db.recurringInvoiceTemplate.createMany({ data: withoutKeys(recurringInvoiceTemplates, ['lines']) as never[] }),
        db.recurringInvoiceLine.createMany({ data: recurringInvoiceTemplates.flatMap((t) => t.lines as never[]) }),
        db.bankStatementLine.createMany({ data: toBigInt(g('bankStatementLines'), 'amount') as never[] }),
        db.payrollSlip.createMany({ data: g('payrollSlips') as never[] }),
        db.task.createMany({ data: g('tasks') as never[] }),
        db.attachment.createMany({ data: g('attachments') as never[] }),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`بازیابی ناموفق بود و هیچ داده‌ای ثبت نشد: ${message}`);
    }

    return { success: true };
  }
}
