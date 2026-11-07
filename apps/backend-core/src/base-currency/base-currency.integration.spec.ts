import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../generated/tenant-client/index.js';
import { BaseCurrencyService } from './base-currency.service.js';
import { loadBaseCurrency, invalidateBaseCurrency } from './base-unit.js';
import { runConversion, ConversionAbort, type RawDb } from './conversion-engine.js';
import { parseRate } from './rational.js';
import { writeLock } from './write-lock.js';
import type { TenantRequestContext } from '../common/request-context.js';

/**
 * تست یکپارچه روی یک Postgres واقعیِ دورریختنی. فقط وقتی BASE_CURRENCY_TEST_DATABASE_URL ست باشد اجرا می‌شود
 * (دیتابیس باید با مهاجرت‌های تننت ساخته شده باشد؛ هرگز دیتابیس واقعی نباشد — جدول‌ها پاک می‌شوند).
 */
const URL = process.env.BASE_CURRENCY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe.skipIf(!URL)('base currency conversion — real Postgres', () => {
  let db: PrismaClient;
  let svc: BaseCurrencyService;
  let ctx: TenantRequestContext;
  let seq = 0;
  const key = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

  async function wipe() {
    for (const t of [
      'base_currency_rounding_log', 'base_currency_confirmations', 'base_currency_conversions', 'sales_invoice_lines', 'sales_invoices', 'accounting_journal_lines',
      'accounting_journal_entries', 'accounting_accounts', 'warehouse_products', 'checks', 'crm_contacts', 'currencies', 'module_settings', 'accounting_bank_accounts',
      'proposals', 'users',
    ]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE`);
  }

  async function seed(opts: { oddLedger?: boolean; big?: boolean } = {}) {
    await db.user.create({ data: { id: 'u1', globalUserId: 'g1', name: 'مالک', phone: '09120000000' } });
    const a1 = await db.account.create({ data: { code: '1', name: 'صندوق', type: 'ASSET' } });
    const a2 = await db.account.create({ data: { code: '2', name: 'درآمد', type: 'REVENUE' } });
    const entry = async (lines: Array<[string, bigint, bigint]>) => {
      const e = await db.journalEntry.create({ data: { date: new Date(), status: 'POSTED' } });
      for (const [acc, d, c] of lines) await db.journalLine.create({ data: { entryId: e.id, accountId: acc, debit: d, credit: c } });
      return e;
    };
    await entry([[a1.id, 1_000_000n, 0n], [a2.id, 0n, 1_000_000n]]);
    await entry([[a1.id, 2_500_000n, 0n], [a2.id, 0n, 2_500_000n]]);
    if (opts.oddLedger) {
      // سه‌تکه‌ای که با ÷۱۰ هر سه خانه گرد می‌شوند: ۱۰۰۰۵ → ۱۰۰۱ ؛ ۱۰۰۰۵ → ۱۰۰۱ ؛ ۲۰۰۱۰ → ۲۰۰۱ ⇒ ۲۰۰۲ vs ۲۰۰۱
      await entry([[a1.id, 10_005n, 0n], [a1.id, 10_005n, 0n], [a2.id, 0n, 20_010n]]);
    }
    const c = await db.crmContact.create({ data: { name: 'مشتری' } });
    await db.product.create({ data: { sku: 'P1', name: 'کالا', costPrice: 100_000, salePrice: 150_000 } });
    const inv = await db.salesInvoice.create({
      data: { contactId: c.id, subtotal: opts.big ? 300_000_000 : 3_000_000, discount: 0, taxAmount: 0, total: opts.big ? 300_000_000 : 3_000_000, paidAmount: 500_000 },
    });
    await db.salesInvoiceLine.create({ data: { invoiceId: inv.id, description: 'x', quantity: 2, unitPrice: 1_500_000, lineTotal: 3_000_000 } });
    await db.check.create({ data: { direction: 'RECEIVED', sayadId: '1234567890123456', amount: 750_000, dueDate: new Date() } });
    await db.currency.create({ data: { code: 'USD', name: 'دلار', rate: '523450.1234' } });
    await db.proposal.create({ data: { title: 'پروپوزال', amount: 4_000_000, contactId: c.id, invoiceLines: [{ description: 'الف', quantity: 2, unitPrice: 1_500_000 }, { description: 'ب', quantity: 1, unitPrice: 1_000_000 }] } as never });
    await db.moduleSetting.create({ data: { moduleCode: 'purchasing', key: 'approvalThreshold', value: 20_000_000 } });
    await db.bankAccount.create({ data: { name: 'ملی', currency: 'IRT', openingBalance: 5_000_000n, openingDate: new Date(), linkedAccountId: a1.id } });
  }

  const sum = async (sql: string) => BigInt(((await db.$queryRawUnsafe<Array<{ s: string }>>(sql))[0] as { s: string }).s);
  const code = async (toCode: string, roundingMode?: 'STRICT' | 'ROUND') => (await svc.requestConfirmation(ctx, { dto: { toCode, roundingMode } })).devCode!;
  const codeRev = async (id: string, roundingMode?: 'STRICT' | 'ROUND') => (await svc.requestConfirmation(ctx, { reverseOfId: id, roundingMode })).devCode!;

  beforeAll(async () => {
    process.env.BASE_CURRENCY_SKIP_BACKUP = 'true';
    process.env.OTP_DEV_ECHO = 'true';
    db = new PrismaClient({ datasources: { db: { url: URL! } } });
    svc = new BaseCurrencyService({} as never);
    ctx = {
      auth: { sub: 'g1', role: 'OWNER', type: 'user' } as never,
      tenantId: 't1',
      tenantSlug: 't1',
      tenantDb: db,
    };
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await wipe();
    writeLock._reset();
    invalidateBaseCurrency(db);
  });

  it('تومان → ریال: همه‌ی مبالغ دقیقاً ×۱۰، تراز دفتر کل حفظ، برچسب و کد ارز عوض می‌شود', async () => {
    await seed();
    const prev = await svc.preview(ctx, { toCode: 'IRR' });
    expect(prev.blocking).toEqual([]);
    expect(prev.rate).toBe('10');

    const res = await svc.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به ریال', otp: await code('IRR') }, { awaitRun: true });
    expect(res.status).toBe('DONE');

    expect(await sum(`SELECT SUM("total")::text s FROM sales_invoices`)).toBe(30_000_000n);
    expect(await sum(`SELECT "unitPrice"::text s FROM sales_invoice_lines`)).toBe(15_000_000n);
    expect(await sum(`SELECT "salePrice"::text s FROM warehouse_products`)).toBe(1_500_000n);
    expect(await sum(`SELECT SUM("amount")::text s FROM checks`)).toBe(7_500_000n);
    expect(await sum(`SELECT SUM("debit")::text s FROM accounting_journal_lines`)).toBe(35_000_000n);
    expect(await sum(`SELECT SUM("credit")::text s FROM accounting_journal_lines`)).toBe(35_000_000n);
    expect(await sum(`SELECT "openingBalance"::text s FROM accounting_bank_accounts`)).toBe(50_000_000n);
    expect((await db.$queryRawUnsafe<Array<{ r: string }>>(`SELECT "rate"::text r FROM currencies`))[0]!.r).toBe('5234501.2340');
    expect((await db.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'purchasing', key: 'approvalThreshold' } } }))!.value).toBe(200_000_000);
    expect((await db.bankAccount.findFirst())!.currency).toBe('IRR');
    const prop = await db.proposal.findFirst();
    expect(prop!.invoiceLines).toEqual([{ description: 'الف', quantity: 2, unitPrice: 15_000_000 }, { description: 'ب', quantity: 1, unitPrice: 10_000_000 }]);

    const st = await loadBaseCurrency(db, { fresh: true });
    expect(st.code).toBe('IRR');
    expect(st.label).toBe('ریال');
    expect(st.tomanPerUnit).toEqual({ num: 1n, den: 10n });
    const rec = await db.baseCurrencyConversion.findUnique({ where: { id: res.id } });
    expect(rec!.status).toBe('DONE');
    expect((rec!.report as { ledgerAfter: { unbalancedEntries: number } }).ledgerAfter.unbalancedEntries).toBe(0);
    expect(writeLock.isLocked('t1')).toBe(false);
  });

  it('ایمپوتنت: همان idempotencyKey دوباره اجرا نمی‌شود', async () => {
    await seed();
    const k = key();
    const a = await svc.execute(ctx, { toCode: 'IRR', idempotencyKey: k, confirmPhrase: 'تغییر ارز پایه به ریال', otp: await code('IRR') }, { awaitRun: true });
    const b = await svc.execute(ctx, { toCode: 'IRR', idempotencyKey: k, confirmPhrase: 'x', otp: '000000' });
    expect(b.id).toBe(a.id);
    expect((b as { replayed?: boolean }).replayed).toBe(true);
    expect(await sum(`SELECT SUM("total")::text s FROM sales_invoices`)).toBe(30_000_000n);
  });

  it('سرریز INT4: مبلغ ۳۰۰ میلیون تومانی با ×۱۰ مسدود می‌شود و هیچ‌چیز تغییر نمی‌کند', async () => {
    await seed({ big: true });
    const prev = await svc.preview(ctx, { toCode: 'IRR' });
    expect(prev.canExecute).toBe(false);
    expect(prev.blocking.some((b) => b.code === 'OVERFLOW')).toBe(true);
    await expect(svc.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به ریال', otp: await code('IRR') })).rejects.toThrow();
    expect(await sum(`SELECT SUM("total")::text s FROM sales_invoices`)).toBe(300_000_000n);
  });

  it('عبارت تأیید یا کد نادرست → رد، و داده دست‌نخورده', async () => {
    await seed();
    await expect(svc.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'اشتباه', otp: await code('IRR') })).rejects.toThrow(/عبارت/);
    await expect(svc.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به ریال', otp: '999999' })).rejects.toThrow();
    expect(await sum(`SELECT SUM("total")::text s FROM sales_invoices`)).toBe(3_000_000n);
  });

  it('رول‌بک کامل: خطا وسط تراکنش هیچ ردیفی را تغییر نمی‌دهد', async () => {
    await seed();
    const before = await sum(`SELECT SUM("debit")::text s FROM accounting_journal_lines`);
    await expect(
      db.$transaction(async (tx) => {
        await runConversion(tx as unknown as RawDb, { conversionId: 'c-x', rate: parseRate('10'), mode: 'STRICT', fromCode: 'IRT', toCode: 'IRR' }, {
          convert: async () => {
            throw new ConversionAbort('boom');
          },
        });
      }),
    ).rejects.toThrow('boom');
    expect(await sum(`SELECT SUM("debit")::text s FROM accounting_journal_lines`)).toBe(before);
    expect(await sum(`SELECT COUNT(*)::text s FROM base_currency_rounding_log`)).toBe(0n);
  });

  it('ریال → تومان: حالت دقیق مقدار غیرمضرب را رد می‌کند؛ ROUND با تعدیل تراز اجرا و بازگشت دقیقاً اصل را برمی‌گرداند', async () => {
    await seed({ oddLedger: true });
    // به ریال می‌رویم (همه ×۱۰)، سپس سند «۱۰۰۰۵+۱۰۰۰۵ | ۲۰۰۱۰» (تومان) → ریال ۱۰۰۰۵۰… ولی برای تست گرد‌کردن مقدار نامضرب دستی می‌گذاریم
    await svc.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به ریال', otp: await code('IRR') }, { awaitRun: true });
    // اکنون دو خانه‌ی نامضرب‌ده وارد می‌کنیم (ورودی کاربر در ریال): ۱۰۰۰۵ و ۱۰۰۰۵ در برابر ۲۰۰۱۰ (تراز) → ÷۱۰ = ۱۰۰۱ (گرد ↑) ×۲ و ۲۰۰۱
    const e = await db.journalEntry.create({ data: { date: new Date(), status: 'POSTED' } });
    const acc = await db.account.findFirst();
    await db.journalLine.createMany({ data: [
      { entryId: e.id, accountId: acc!.id, debit: 15n, credit: 0n },
      { entryId: e.id, accountId: acc!.id, debit: 15n, credit: 0n },
      { entryId: e.id, accountId: acc!.id, debit: 0n, credit: 30n },
    ] });
    const origLines = await db.$queryRawUnsafe<Array<{ id: string; debit: string; credit: string }>>(`SELECT id, debit::text, credit::text FROM accounting_journal_lines ORDER BY id`);

    const strict = await svc.preview(ctx, { toCode: 'IRT' });
    expect(strict.canExecute).toBe(false);
    expect(strict.blocking.some((b) => b.code === 'INEXACT')).toBe(true);

    const rounded = await svc.preview(ctx, { toCode: 'IRT', roundingMode: 'ROUND' });
    expect(rounded.canExecute).toBe(true);
    const res = await svc.execute(ctx, { toCode: 'IRT', roundingMode: 'ROUND', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به تومان', otp: await code('IRT', 'ROUND') }, { awaitRun: true });
    expect(res.status).toBe('DONE');

    // تراز: هر سند جدا
    const unbalanced = await db.$queryRawUnsafe<Array<{ n: string }>>(`SELECT COUNT(*)::text n FROM (SELECT "entryId" FROM accounting_journal_lines GROUP BY 1 HAVING SUM(debit)<>SUM(credit)) x`);
    expect(unbalanced[0]!.n).toBe('0');
    expect((await db.baseCurrencyRoundingLog.count({ where: { conversionId: res.id } })) > 0).toBe(true);

    // بازگشت → ریال، اصل را دقیق برمی‌گرداند (گرد‌شده‌ها از لاگ)
    const back = await svc.reverse(ctx, res.id, { idempotencyKey: key(), confirmPhrase: 'بازگشت تغییر ارز پایه', otp: await codeRev(res.id) }, { awaitRun: true });
    expect(back.status).toBe('DONE');
    const now = await db.$queryRawUnsafe<Array<{ id: string; debit: string; credit: string }>>(`SELECT id, debit::text, credit::text FROM accounting_journal_lines ORDER BY id`);
    expect(now).toEqual(origLines);
    expect((await loadBaseCurrency(db, { fresh: true })).code).toBe('IRR');
    expect((await db.baseCurrencyConversion.findUnique({ where: { id: res.id } }))!.reversedById).toBe(back.id);
  });

  it('بازگشت تومان→ریال: ÷۱۰ دقیق، مبالغ اصلی برمی‌گردد', async () => {
    await seed();
    const snap = async () => db.$queryRawUnsafe<unknown[]>(`SELECT (SELECT SUM("total") FROM sales_invoices)::text a, (SELECT SUM("debit") FROM accounting_journal_lines)::text b, (SELECT "rate"::text FROM currencies) c, (SELECT "invoiceLines"::text FROM proposals) d`);
    const orig = await snap();
    const r = await svc.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به ریال', otp: await code('IRR') }, { awaitRun: true });
    await svc.reverse(ctx, r.id, { idempotencyKey: key(), confirmPhrase: 'بازگشت تغییر ارز پایه', otp: await codeRev(r.id) }, { awaitRun: true });
    expect(await snap()).toEqual(orig);
    expect((await loadBaseCurrency(db, { fresh: true })).code).toBe('IRT');
    // بازگشتِ دوباره‌ی همان عملیات ممکن نیست
    await expect(codeRev(r.id)).rejects.toThrow(/بازگردانده|یافت/);
  });

  it('دو عملیات هم‌زمان: ایندکس یکتای RUNNING مانع دومی می‌شود', async () => {
    await seed();
    await db.baseCurrencyConversion.create({
      data: { status: 'RUNNING', fromCode: 'IRT', toCode: 'IRR', fromLabel: 'تومان', toLabel: 'ریال', rateNum: '10', rateDen: '1', idempotencyKey: key(), heartbeatAt: new Date() },
    });
    await expect(svc.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به ریال', otp: await code('IRR') })).rejects.toThrow(/در حال اجرا/);
    await expect(
      db.baseCurrencyConversion.create({
        data: { status: 'RUNNING', fromCode: 'IRT', toCode: 'IRR', fromLabel: 'تومان', toLabel: 'ریال', rateNum: '10', rateDen: '1', idempotencyKey: key() },
      }),
    ).rejects.toThrow();
  });

  it('عملیات RUNNING با ضربان قطع‌شده FAILED علامت می‌خورد و دوباره قابل اجراست (resume)', async () => {
    await seed();
    await db.baseCurrencyConversion.create({
      data: { status: 'RUNNING', fromCode: 'IRT', toCode: 'IRR', fromLabel: 'تومان', toLabel: 'ریال', rateNum: '10', rateDen: '1', idempotencyKey: key(), heartbeatAt: new Date(Date.now() - 10 * 60_000) },
    });
    const r = await svc.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به ریال', otp: await code('IRR') }, { awaitRun: true });
    expect(r.status).toBe('DONE');
    expect(await db.baseCurrencyConversion.count({ where: { status: 'FAILED' } })).toBe(1);
  });

  it('کد پیامکی به طرح بسته است: کد طرح دیگر پذیرفته نمی‌شود و داده دست‌نخورده می‌ماند', async () => {
    await seed();
    const wrong = await code('IRR', 'ROUND'); // طرح ROUND
    await expect(svc.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به ریال', otp: wrong })).rejects.toThrow(/صادر نشده/);
    expect(await sum(`SELECT SUM("total")::text s FROM sales_invoices`)).toBe(3_000_000n);
  });

  it('تلاش‌های موازی با کد غلط از سقف ۵ تلاش عبور نمی‌کنند (شمارش اتمیک)', async () => {
    await seed();
    await code('IRR');
    const tries = Array.from({ length: 12 }, () => svc.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به ریال', otp: '000000' }).catch((e: Error) => e.message));
    await Promise.all(tries);
    const row = await db.baseCurrencyConfirmation.findFirst({ orderBy: { createdAt: 'desc' } });
    expect(row!.attempts).toBe(5);
  });

  it('شکست پشتیبان: هیچ تغییری، ردیف FAILED، کد همچنان معتبر؛ تلاش مجدد با کلید جدید موفق', async () => {
    await seed();
    process.env.BASE_CURRENCY_SKIP_BACKUP = 'false';
    const failing = { isRunning: () => null, backupTenantForOperation: async () => { throw new Error('pg_dump failed'); } };
    const svc2 = new BaseCurrencyService({} as never, failing as never);
    const c = (await svc2.requestConfirmation(ctx, { dto: { toCode: 'IRR' } })).devCode!;
    const k = key();
    await expect(svc2.execute(ctx, { toCode: 'IRR', idempotencyKey: k, confirmPhrase: 'تغییر ارز پایه به ریال', otp: c })).rejects.toThrow(/پشتیبان/);
    expect(await sum(`SELECT SUM("total")::text s FROM sales_invoices`)).toBe(3_000_000n);
    expect((await db.baseCurrencyConfirmation.findFirst({ orderBy: { createdAt: 'desc' } }))!.consumedAt).toBeNull();
    const row = await db.baseCurrencyConversion.findUnique({ where: { idempotencyKey: k } });
    expect(row!.status).toBe('FAILED');
    expect(writeLock.isLocked('t1')).toBe(false);
    // تلاش مجدد با همان کلید = همان ردیف، بدون پشتیبان دوم
    const replay = await svc2.execute(ctx, { toCode: 'IRR', idempotencyKey: k, confirmPhrase: 'x', otp: '000000' });
    expect(replay.id).toBe(row!.id);
    // موفقیت پشتیبان: sha256/نام ثبت می‌شود، کد پس از پشتیبان مصرف می‌شود
    let calls = 0;
    const ok = { isRunning: () => null, backupTenantForOperation: async () => { calls += 1; return { dir: 'x', file: 't1__preconv-1/2026-11-07.sql.gz', size: 123, sha256: 'ab'.repeat(32), encrypted: false }; } };
    const svc3 = new BaseCurrencyService({} as never, ok as never);
    const r = await svc3.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به ریال', otp: c }, { awaitRun: true });
    expect(r.status).toBe('DONE');
    expect(calls).toBe(1);
    const done = await db.baseCurrencyConversion.findUnique({ where: { id: r.id } });
    expect(done!.backupSha256).toBe('ab'.repeat(32));
    expect(done!.backupFile).toContain('preconv');
    process.env.BASE_CURRENCY_SKIP_BACKUP = 'true';
  });

  it('درخواست مالیِ در جریان تخلیه می‌شود؛ اگر تمام نشود عملیات شروع نمی‌شود و هیچ تغییری نیست', async () => {
    await seed();
    process.env.BASE_CURRENCY_DRAIN_MS = '300';
    const leave = writeLock.enter('t1'); // یک درخواست مالیِ هنوز تمام‌نشده
    const svcSlow = new BaseCurrencyService({} as never);
    await expect(svcSlow.execute(ctx, { toCode: 'IRR', idempotencyKey: key(), confirmPhrase: 'تغییر ارز پایه به ریال', otp: await code('IRR') })).rejects.toThrow(/به‌موقع/);
    expect(await sum(`SELECT SUM("total")::text s FROM sales_invoices`)).toBe(3_000_000n);
    expect(writeLock.isLocked('t1')).toBe(false);
    leave();
    delete process.env.BASE_CURRENCY_DRAIN_MS;
  });
});
