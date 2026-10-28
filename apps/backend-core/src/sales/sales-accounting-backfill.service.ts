import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import { CostingService } from '../warehouse/costing.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { MissingAccountError, buildPaymentJournalLines, buildReturnJournalLines, buildSaleJournalLines, isAccountingActive } from './accounting-link.js';
import { assertPeriodOpen, lockedKeys, periodKeyOfDate } from './period-gate.js';

/**
 * «ثبت اسناد حسابداری فاکتورهای قبلی» — برای تننتی که فروش را بدون حسابداری استفاده کرده و بعداً حسابداری را نصب می‌کند.
 *
 * ایدمپوتنسی: هر ردیف (فاکتور/پرداخت/مرجوعی) پرچم accountingPosted دارد. ثبت = «ادعای اتمیک» (updateMany با شرط
 * accountingPosted=false و نبودن journalEntryId) + ساخت سند + اتصال، همه در یک تراکنش؛ پس اجرای هم‌زمان یا تکراری
 * هرگز سند دوم نمی‌سازد و شکست وسط کار هیچ نیمه‌کاره‌ای باقی نمی‌گذارد. دوره‌ی بسته: ردیف رد می‌شود و دلیلش گزارش می‌شود
 * (یا با dateMode=TODAY_IF_LOCKED با تاریخ امروز ثبت می‌شود).
 */

export type BackfillDateMode = 'ORIGINAL' | 'TODAY_IF_LOCKED';
export type BackfillStage = 'INVOICES' | 'PAYMENTS' | 'RETURNS' | 'DONE';

const POSTABLE_STATUSES = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] as const;
const REPORT_MODULE = 'sales';
const REPORT_KEY = 'accountingBackfillReport';
const MAX_BATCH = 500;
const DEFAULT_BATCH = 100;
const BLOCKED_LIST_CAP = 100;

export type BlockedItem = { type: 'INVOICE' | 'PAYMENT' | 'RETURN'; id: string; no: number | null; reason: string };

export type BackfillPreview = {
  accountingActive: boolean;
  invoices: { count: number; total: number; from: Date | null; to: Date | null };
  payments: { count: number; total: number };
  returns: { count: number; total: number };
  blocked: BlockedItem[];
  blockedCount: number;
  lastReport: BackfillReport | null;
};

export type BackfillReport = {
  runId: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  byUser: string | null;
  dateMode: BackfillDateMode;
  posted: { invoices: number; payments: number; returns: number };
  skipped: number;
  failed: number;
  issues: BlockedItem[];
};

export type BackfillBatchResult = {
  runId: string;
  stage: BackfillStage;
  cursor: string | null;
  done: boolean;
  batch: { posted: number; skipped: number; failed: number };
  report: BackfillReport;
};

type Cursor = { ts: string; id: string };
const encodeCursor = (ts: Date, id: string) => `${ts.toISOString()}|${id}`;
function decodeCursor(c: string | null | undefined): Cursor | null {
  if (!c) return null;
  const [ts, id] = c.split('|');
  return ts && id && !Number.isNaN(new Date(ts).getTime()) ? { ts, id } : null;
}

@Injectable()
export class SalesAccountingBackfillService {
  private readonly logger = new Logger('SalesAccountingBackfill');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly costing: CostingService,
  ) {}

  assertManager(ctx: TenantRequestContext): void {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') throw new ForbiddenException('فقط مالک یا مدیر می‌تواند اسناد حسابداری فاکتورهای قبلی را ثبت کند');
  }

  async lastReport(ctx: TenantRequestContext): Promise<BackfillReport | null> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: REPORT_MODULE, key: REPORT_KEY } } });
    return (row?.value as BackfillReport | undefined) ?? null;
  }

  private async saveReport(ctx: TenantRequestContext, report: BackfillReport): Promise<void> {
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: REPORT_MODULE, key: REPORT_KEY } },
      create: { moduleCode: REPORT_MODULE, key: REPORT_KEY, value: report as never },
      update: { value: report as never },
    });
  }

  // ── پیش‌نمایش ───────────────────────────────────────────────────────────
  async preview(ctx: TenantRequestContext): Promise<BackfillPreview> {
    this.assertManager(ctx);
    const db = ctx.tenantDb;
    const active = await isAccountingActive(this.controlDb, ctx.tenantId);
    const lastReport = await this.lastReport(ctx);
    if (!active) {
      return { accountingActive: false, invoices: { count: 0, total: 0, from: null, to: null }, payments: { count: 0, total: 0 }, returns: { count: 0, total: 0 }, blocked: [], blockedCount: 0, lastReport };
    }
    const [invoices, payments, returns] = await Promise.all([
      db.salesInvoice.findMany({
        where: { status: { in: [...POSTABLE_STATUSES] }, accountingPosted: false, journalEntryId: null },
        select: { id: true, invoiceNo: true, total: true, confirmedAt: true, issuedAt: true },
        orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
      }),
      db.salesPayment.findMany({
        where: { accountingPosted: false, invoice: { status: { in: [...POSTABLE_STATUSES] } } },
        select: { id: true, amount: true, paidAt: true, invoice: { select: { invoiceNo: true, accountingPosted: true } } },
      }),
      db.salesReturn.findMany({
        where: { accountingPosted: false, journalEntryId: null, invoice: { status: { in: [...POSTABLE_STATUSES] } } },
        select: { id: true, returnNo: true, total: true, createdAt: true, invoice: { select: { accountingPosted: true, invoiceNo: true } } },
      }),
    ]);

    const dates = invoices.map((i) => i.confirmedAt ?? i.issuedAt);
    const keys = [...new Set([...dates, ...payments.map((p) => p.paidAt), ...returns.map((r) => r.createdAt)].map((d) => periodKeyOfDate(d).key))];
    const locked = await lockedKeys(db, keys).catch(() => new Set<string>());

    const blocked: BlockedItem[] = [];
    let blockedCount = 0;
    const note = (b: BlockedItem) => {
      blockedCount += 1;
      if (blocked.length < BLOCKED_LIST_CAP) blocked.push(b);
    };
    for (const i of invoices) {
      if (i.total <= 0) note({ type: 'INVOICE', id: i.id, no: i.invoiceNo, reason: 'مبلغ فاکتور صفر است و سند نمی‌خورد' });
      else if (locked.has(periodKeyOfDate(i.confirmedAt ?? i.issuedAt).key)) note({ type: 'INVOICE', id: i.id, no: i.invoiceNo, reason: 'تاریخ فاکتور در دوره‌ی مالی بسته است (با گزینه‌ی «ثبت با تاریخ امروز» ثبت می‌شود)' });
    }
    for (const p of payments) {
      if (p.invoice.accountingPosted === false && !invoices.some((i) => i.invoiceNo === p.invoice.invoiceNo)) note({ type: 'PAYMENT', id: p.id, no: p.invoice.invoiceNo, reason: 'سند فاکتور مربوطه ثبت‌شدنی نیست' });
      else if (locked.has(periodKeyOfDate(p.paidAt).key)) note({ type: 'PAYMENT', id: p.id, no: p.invoice.invoiceNo, reason: 'تاریخ پرداخت در دوره‌ی مالی بسته است' });
    }
    for (const r of returns) {
      if (locked.has(periodKeyOfDate(r.createdAt).key)) note({ type: 'RETURN', id: r.id, no: r.returnNo, reason: 'تاریخ مرجوعی در دوره‌ی مالی بسته است' });
    }

    return {
      accountingActive: true,
      invoices: { count: invoices.length, total: invoices.reduce((s, i) => s + i.total, 0), from: dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null, to: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null },
      payments: { count: payments.length, total: payments.reduce((s, p) => s + p.amount, 0) },
      returns: { count: returns.length, total: returns.reduce((s, r) => s + r.total, 0) },
      blocked,
      blockedCount,
      lastReport,
    };
  }

  // ── اجرای دسته‌ای ────────────────────────────────────────────────────────
  /**
   * یک دسته (حداکثر `limit` ردیف) را ثبت می‌کند و `cursor`/`stage` بعدی را برمی‌گرداند؛ کلاینت تا done=true تکرار می‌کند.
   * ترتیب: فاکتورها (قدیمی‌ترین اول) ← پرداخت‌ها ← مرجوعی‌ها (فقط برای فاکتورِ ثبت‌شده).
   */
  async runBatch(
    ctx: TenantRequestContext,
    input: { confirm: boolean; limit?: number; stage?: BackfillStage; cursor?: string | null; runId?: string; dateMode?: BackfillDateMode },
  ): Promise<BackfillBatchResult> {
    this.assertManager(ctx);
    if (!input.confirm) throw new BadRequestException('ثبت اسناد نیازمند تأیید صریح است');
    if (!(await isAccountingActive(this.controlDb, ctx.tenantId))) throw new BadRequestException('ماژول حسابداری نصب/فعال نیست؛ ابتدا آن را نصب کنید');
    const limit = Math.min(Math.max(Math.floor(input.limit ?? DEFAULT_BATCH), 1), MAX_BATCH);
    const dateMode: BackfillDateMode = input.dateMode === 'TODAY_IF_LOCKED' ? 'TODAY_IF_LOCKED' : 'ORIGINAL';
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const user = userId ? await ctx.tenantDb.user.findUnique({ where: { id: userId }, select: { name: true } }) : null;

    await ensureDefaultChartOfAccounts(ctx.tenantDb);

    const existing = await this.lastReport(ctx);
    const continuing = !!input.runId && existing?.runId === input.runId && !existing.finishedAt;
    const now = new Date().toISOString();
    const report: BackfillReport = continuing
      ? (existing as BackfillReport)
      : {
          runId: `bf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          startedAt: now,
          updatedAt: now,
          finishedAt: null,
          byUser: user?.name ?? null,
          dateMode,
          posted: { invoices: 0, payments: 0, returns: 0 },
          skipped: 0,
          failed: 0,
          issues: [],
        };

    let stage: BackfillStage = input.stage && input.stage !== 'DONE' ? input.stage : 'INVOICES';
    let cursor = decodeCursor(input.cursor);
    if (input.stage === 'DONE') stage = 'DONE';
    const batch = { posted: 0, skipped: 0, failed: 0 };
    let budget = limit;

    const addIssue = (b: BlockedItem) => {
      if (report.issues.length < BLOCKED_LIST_CAP) report.issues.push(b);
    };

    while (budget > 0 && stage !== 'DONE') {
      const rows = await this.nextRows(ctx, stage, cursor, budget);
      if (rows.length === 0) {
        stage = stage === 'INVOICES' ? 'PAYMENTS' : stage === 'PAYMENTS' ? 'RETURNS' : 'DONE';
        cursor = null;
        continue;
      }
      for (const row of rows) {
        budget -= 1;
        cursor = { ts: row.ts.toISOString(), id: row.id };
        const outcome = await this.postOne(ctx, stage, row.id, userId, dateMode);
        if (outcome.kind === 'POSTED') {
          batch.posted += 1;
          if (stage === 'INVOICES') report.posted.invoices += 1;
          else if (stage === 'PAYMENTS') report.posted.payments += 1;
          else report.posted.returns += 1;
        } else if (outcome.kind === 'ALREADY') {
          batch.skipped += 1; // رقیب هم‌زمان ثبتش کرده — بی‌خطر
        } else if (outcome.kind === 'SKIPPED') {
          batch.skipped += 1;
          report.skipped += 1;
          addIssue({ type: stage === 'INVOICES' ? 'INVOICE' : stage === 'PAYMENTS' ? 'PAYMENT' : 'RETURN', id: row.id, no: row.no, reason: outcome.reason });
        } else {
          batch.failed += 1;
          report.failed += 1;
          addIssue({ type: stage === 'INVOICES' ? 'INVOICE' : stage === 'PAYMENTS' ? 'PAYMENT' : 'RETURN', id: row.id, no: row.no, reason: outcome.reason });
        }
      }
    }

    // اگر بودجه تمام شد ولی ردیف دیگری نمانده باشد، مرحله‌ی بعد را بدون هزینه چک می‌کنیم تا done درست باشد
    while (stage !== 'DONE') {
      const peek = await this.nextRows(ctx, stage, cursor, 1);
      if (peek.length > 0) break;
      stage = stage === 'INVOICES' ? 'PAYMENTS' : stage === 'PAYMENTS' ? 'RETURNS' : 'DONE';
      cursor = null;
    }

    report.updatedAt = new Date().toISOString();
    if (stage === 'DONE') report.finishedAt = report.updatedAt;
    await this.saveReport(ctx, report);
    await ctx.tenantDb.activityLog
      .create({
        data: {
          userId,
          action: stage === 'DONE' ? 'sales.accounting_backfill.finished' : 'sales.accounting_backfill.batch',
          entityType: 'SalesInvoice',
          entityId: null,
          moduleCode: 'sales',
          actionType: 'other',
          summary: `ثبت اسناد حسابداری فاکتورهای قبلی: ${batch.posted} سند ثبت، ${batch.skipped} ردشده، ${batch.failed} ناموفق`,
          metadata: { runId: report.runId, batch, totals: report.posted, dateMode } as never,
        },
      })
      .catch((e: Error) => this.logger.warn(`activity log failed: ${e.message}`));

    return { runId: report.runId, stage, cursor: cursor ? encodeCursor(new Date(cursor.ts), cursor.id) : null, done: stage === 'DONE', batch, report };
  }

  private async nextRows(ctx: TenantRequestContext, stage: BackfillStage, cursor: Cursor | null, take: number): Promise<Array<{ id: string; ts: Date; no: number | null }>> {
    const db = ctx.tenantDb;
    const after = (field: string) => (cursor ? { OR: [{ [field]: { gt: new Date(cursor.ts) } }, { [field]: new Date(cursor.ts), id: { gt: cursor.id } }] } : {});
    if (stage === 'INVOICES') {
      const rows = await db.salesInvoice.findMany({
        where: { status: { in: [...POSTABLE_STATUSES] }, accountingPosted: false, journalEntryId: null, confirmedAt: { not: null }, ...after('confirmedAt') },
        select: { id: true, invoiceNo: true, confirmedAt: true },
        orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
        take,
      });
      return rows.map((r) => ({ id: r.id, ts: r.confirmedAt!, no: r.invoiceNo }));
    }
    if (stage === 'PAYMENTS') {
      const rows = await db.salesPayment.findMany({
        where: { accountingPosted: false, invoice: { status: { in: [...POSTABLE_STATUSES] }, accountingPosted: true }, ...after('paidAt') },
        select: { id: true, paidAt: true, invoice: { select: { invoiceNo: true } } },
        orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
        take,
      });
      return rows.map((r) => ({ id: r.id, ts: r.paidAt, no: r.invoice.invoiceNo }));
    }
    const rows = await db.salesReturn.findMany({
      where: { accountingPosted: false, journalEntryId: null, invoice: { status: { in: [...POSTABLE_STATUSES] }, accountingPosted: true }, ...after('createdAt') },
      select: { id: true, returnNo: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
    });
    return rows.map((r) => ({ id: r.id, ts: r.createdAt, no: r.returnNo }));
  }

  private async postOne(
    ctx: TenantRequestContext,
    stage: BackfillStage,
    id: string,
    userId: string | null,
    dateMode: BackfillDateMode,
  ): Promise<{ kind: 'POSTED' } | { kind: 'ALREADY' } | { kind: 'SKIPPED'; reason: string } | { kind: 'FAILED'; reason: string }> {
    try {
      if (stage === 'INVOICES') return await this.postInvoice(ctx, id, userId, dateMode);
      if (stage === 'PAYMENTS') return await this.postPayment(ctx, id, userId, dateMode);
      return await this.postReturn(ctx, id, userId, dateMode);
    } catch (e) {
      if (e instanceof ConflictException) return { kind: 'SKIPPED', reason: (e.getResponse() as { message?: string }).message ?? e.message };
      if (e instanceof MissingAccountError) return { kind: 'FAILED', reason: e.message };
      this.logger.error(`backfill ${stage} ${id} failed: ${e instanceof Error ? e.message : e}`);
      return { kind: 'FAILED', reason: e instanceof Error ? e.message : 'خطای ناشناخته' };
    }
  }

  /** تاریخ سند: تاریخ اصلی؛ اگر دوره بسته بود → خطای 409 یا (در حالت TODAY_IF_LOCKED) امروز. */
  private async resolveDate(tx: Parameters<typeof assertPeriodOpen>[0], original: Date, dateMode: BackfillDateMode): Promise<{ date: Date; moved: boolean }> {
    try {
      await assertPeriodOpen(tx, original);
      return { date: original, moved: false };
    } catch (e) {
      if (!(e instanceof ConflictException) || dateMode !== 'TODAY_IF_LOCKED') throw e;
      const today = new Date();
      await assertPeriodOpen(tx, today);
      return { date: today, moved: true };
    }
  }

  private async postInvoice(ctx: TenantRequestContext, id: string, userId: string | null, dateMode: BackfillDateMode) {
    const pre = await ctx.tenantDb.salesInvoice.findUnique({ where: { id }, include: { lines: true } });
    if (!pre || pre.accountingPosted || pre.journalEntryId || !(POSTABLE_STATUSES as readonly string[]).includes(pre.status)) return { kind: 'ALREADY' as const };
    if (pre.total <= 0) return { kind: 'SKIPPED' as const, reason: 'مبلغ فاکتور صفر است' };
    // بهای تمام‌شده: خروج انبار قبلاً ثبت شده؛ برای سند از بهای واحد «فعلی» کالا استفاده می‌شود (تقریب مستند).
    const costs = await Promise.all(pre.lines.map((l) => (l.productId ? this.costing.currentUnitCost(ctx, l.productId).then((c) => c * l.quantity) : Promise.resolve(0))));
    const cogsAmount = costs.reduce((s, c) => s + c, 0);
    const original = pre.confirmedAt ?? pre.issuedAt;
    return ctx.tenantDb.$transaction(async (tx) => {
      const claim = await tx.salesInvoice.updateMany({
        where: { id, accountingPosted: false, journalEntryId: null, status: { in: [...POSTABLE_STATUSES] } },
        data: { accountingPosted: true },
      });
      if (claim.count !== 1) return { kind: 'ALREADY' as const };
      const { date, moved } = await this.resolveDate(tx, original, dateMode);
      const lines = await buildSaleJournalLines(tx, { total: pre.total, taxAmount: pre.taxAmount, cogsAmount });
      const entry = await tx.journalEntry.create({
        data: {
          date,
          description: `فاکتور فروش شماره ${pre.invoiceNo} (ثبت پس از نصب حسابداری${moved ? ' — تاریخ اصلی در دوره‌ی بسته' : ''})`,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId ?? undefined,
          lines: { create: lines },
        },
      });
      await tx.salesInvoice.update({ where: { id }, data: { journalEntryId: entry.id } });
      return { kind: 'POSTED' as const };
    });
  }

  private async postPayment(ctx: TenantRequestContext, id: string, userId: string | null, dateMode: BackfillDateMode) {
    const pre = await ctx.tenantDb.salesPayment.findUnique({ where: { id }, include: { invoice: { select: { invoiceNo: true, accountingPosted: true } } } });
    if (!pre || pre.accountingPosted) return { kind: 'ALREADY' as const };
    if (!pre.invoice.accountingPosted) return { kind: 'SKIPPED' as const, reason: 'سند فاکتور مربوطه هنوز ثبت نشده است' };
    if (pre.amount <= 0) return { kind: 'SKIPPED' as const, reason: 'مبلغ پرداخت صفر است' };
    return ctx.tenantDb.$transaction(async (tx) => {
      const claim = await tx.salesPayment.updateMany({ where: { id, accountingPosted: false }, data: { accountingPosted: true } });
      if (claim.count !== 1) return { kind: 'ALREADY' as const };
      const { date, moved } = await this.resolveDate(tx, pre.paidAt, dateMode);
      const lines = await buildPaymentJournalLines(tx, pre.method, pre.amount);
      const entry = await tx.journalEntry.create({
        data: {
          date,
          description: `دریافت وجه فاکتور فروش شماره ${pre.invoice.invoiceNo} (ثبت پس از نصب حسابداری${moved ? ' — تاریخ اصلی در دوره‌ی بسته' : ''})`,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId ?? undefined,
          lines: { create: lines },
        },
      });
      await tx.salesPayment.update({ where: { id }, data: { journalEntryId: entry.id } });
      return { kind: 'POSTED' as const };
    });
  }

  private async postReturn(ctx: TenantRequestContext, id: string, userId: string | null, dateMode: BackfillDateMode) {
    const pre = await ctx.tenantDb.salesReturn.findUnique({ where: { id }, include: { lines: true, invoice: { select: { invoiceNo: true, accountingPosted: true } } } });
    if (!pre || pre.accountingPosted || pre.journalEntryId) return { kind: 'ALREADY' as const };
    if (!pre.invoice.accountingPosted) return { kind: 'SKIPPED' as const, reason: 'سند فاکتور مربوطه هنوز ثبت نشده است' };
    if (pre.subtotal <= 0) return { kind: 'SKIPPED' as const, reason: 'مبلغ مرجوعی صفر است' };
    const costs = await Promise.all(pre.lines.map((l) => (l.productId ? this.costing.currentUnitCost(ctx, l.productId).then((c) => c * l.quantity) : Promise.resolve(0))));
    const cogsAmount = costs.reduce((s, c) => s + c, 0);
    return ctx.tenantDb.$transaction(async (tx) => {
      const claim = await tx.salesReturn.updateMany({ where: { id, accountingPosted: false, journalEntryId: null }, data: { accountingPosted: true } });
      if (claim.count !== 1) return { kind: 'ALREADY' as const };
      const { date, moved } = await this.resolveDate(tx, pre.createdAt, dateMode);
      const lines = await buildReturnJournalLines(tx, pre.subtotal, cogsAmount);
      const entry = await tx.journalEntry.create({
        data: {
          date,
          description: `مرجوعی فروش برای فاکتور شماره ${pre.invoice.invoiceNo} (ثبت پس از نصب حسابداری${moved ? ' — تاریخ اصلی در دوره‌ی بسته' : ''})`,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId ?? undefined,
          lines: { create: lines },
        },
      });
      await tx.salesReturn.update({ where: { id }, data: { journalEntryId: entry.id } });
      return { kind: 'POSTED' as const };
    });
  }
}
