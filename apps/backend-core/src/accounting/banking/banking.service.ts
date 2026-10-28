import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../../common/request-context.js';
import { resolveTenantUserId } from '../../common/resolve-tenant-user.js';
import { ensureDefaultChartOfAccounts, ensureOpeningBalanceAccount, OPENING_BALANCE_ACCOUNT_CODE } from '../default-chart-of-accounts.js';
import { auditAccounting, postJournalEntry, reverseJournalEntry } from '../journal-posting.js';
import { computeLedger, toNum, type AccountType } from '../period-reports.js';
import { getFiscalStartMonth } from '../periods/accounting-settings.js';
import { resolvePeriod, type PeriodQuery } from '../periods/jalali-periods.js';
import { assertPeriodOpen } from '../periods/period-lock.js';
import type {
  CreateBankAccountDto,
  CreateBankTransactionDto,
  CreateCashBoxDto,
  CreateChequeBookDto,
  SetLeafStatusDto,
  UpdateBankAccountDto,
  UpdateCashBoxDto,
  UpdateChequeBookDto,
} from './banking.dto.js';
import { isValidCardNumber, isValidSheba, normalizeCard, normalizeDigits, normalizeSheba } from './iran-bank-validators.js';
import { refreshBookStatus } from './cheque-leaf.util.js';
import { buildOpeningLines, buildTransactionLines } from './transaction-lines.js';

const PARENT_CODE = { BANK: '1020', CASH: '1010' } as const;
const AR_CODE = '1030';
const AP_CODE = '2010';
const MAX_LEAVES = 500;

type Kind = 'BANK' | 'CASH';
type Db = TenantRequestContext['tenantDb'];

function isUnique(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
}

@Injectable()
export class BankingService {
  // ── کمک‌ها ────────────────────────────────────────────────────────────────

  private async userId(ctx: TenantRequestContext): Promise<string | null> {
    return resolveTenantUserId(ctx).catch(() => null);
  }

  /** مانده‌ی دفتر کل (بدهکار−بستانکار) تا قبل از asOfExclusive؛ اسناد POSTED. */
  async ledgerBalance(db: Db, accountId: string, asOfExclusive?: Date): Promise<number> {
    const agg = await db.journalLine.aggregate({
      where: { accountId, entry: { status: 'POSTED', ...(asOfExclusive ? { date: { lt: asOfExclusive } } : {}) } },
      _sum: { debit: true, credit: true },
    });
    return toNum((agg._sum.debit ?? 0n) - (agg._sum.credit ?? 0n));
  }

  private async resolveLinkedAccount(db: Db, kind: Kind, name: string, linkedAccountId?: string) {
    await ensureDefaultChartOfAccounts(db);
    if (linkedAccountId) {
      const acc = await db.account.findUnique({ where: { id: linkedAccountId } });
      if (!acc) throw new NotFoundException('حساب دفتر کل یافت نشد');
      if (acc.type !== 'ASSET') throw new BadRequestException('حساب دفتر کل بانک/صندوق باید از نوع دارایی باشد');
      const [b, c] = await Promise.all([
        db.bankAccount.findFirst({ where: { linkedAccountId }, select: { id: true } }),
        db.cashBox.findFirst({ where: { linkedAccountId }, select: { id: true } }),
      ]);
      if (b || c) throw new ConflictException('این حساب دفتر کل قبلاً به بانک یا صندوق دیگری وصل است');
      if (!acc.isCashAccount) await db.account.update({ where: { id: acc.id }, data: { isCashAccount: true } });
      return acc;
    }
    const parent = PARENT_CODE[kind];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const existing = await db.account.findMany({ where: { code: { startsWith: `${parent}-` } }, select: { code: true } });
      const max = existing.reduce((m, a) => Math.max(m, Number(a.code.slice(parent.length + 1)) || 0), 0);
      const code = `${parent}-${String(max + 1 + attempt).padStart(2, '0')}`;
      try {
        return await db.account.create({ data: { code, name, type: 'ASSET', isCashAccount: true } });
      } catch (err) {
        if (!isUnique(err)) throw err;
      }
    }
    throw new ConflictException('ساخت حساب دفتر کل ممکن نشد؛ دوباره تلاش کنید');
  }

  private normalizeBankFields(dto: { sheba?: string; cardNumber?: string; accountNumber?: string }) {
    const out: { sheba?: string | null; cardNumber?: string | null; accountNumber?: string | null } = {};
    if (dto.sheba !== undefined) {
      const s = normalizeSheba(dto.sheba);
      if (s && !isValidSheba(s)) throw new BadRequestException('شماره شبا نامعتبر است (IR و ۲۴ رقم، با کنترل صحت)');
      out.sheba = s || null;
    }
    if (dto.cardNumber !== undefined) {
      const c = normalizeCard(dto.cardNumber);
      if (c && !isValidCardNumber(c)) throw new BadRequestException('شماره کارت نامعتبر است (۱۶ رقم، با کنترل صحت)');
      out.cardNumber = c || null;
    }
    if (dto.accountNumber !== undefined) out.accountNumber = normalizeDigits(dto.accountNumber).trim() || null;
    return out;
  }

  private async postOpening(db: Db, holderAccountId: string, openingBalance: number, openingDate: Date, label: string, userId: string | null) {
    if (openingBalance === 0) return null;
    await ensureOpeningBalanceAccount(db);
    const equity = await db.account.findUniqueOrThrow({ where: { code: OPENING_BALANCE_ACCOUNT_CODE } });
    return postJournalEntry(db, {
      date: openingDate,
      description: `مانده‌ی افتتاحیه — ${label}`,
      lines: buildOpeningLines(openingBalance, holderAccountId, equity.id),
      createdByUserId: userId,
    });
  }

  // ── حساب‌های بانکی ────────────────────────────────────────────────────────

  async listBanks(ctx: TenantRequestContext) {
    const banks = await ctx.tenantDb.bankAccount.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      include: { linkedAccount: { select: { id: true, code: true, name: true } } },
    });
    const out = [];
    for (const b of banks) out.push({ ...b, openingBalance: toNum(b.openingBalance), balance: await this.ledgerBalance(ctx.tenantDb, b.linkedAccountId) });
    return out;
  }

  async createBank(ctx: TenantRequestContext, dto: CreateBankAccountDto) {
    const fields = this.normalizeBankFields(dto);
    const userId = await this.userId(ctx);
    const openingBalance = dto.openingBalance ?? 0;
    const openingDate = dto.openingDate ? new Date(dto.openingDate) : new Date();
    if (Number.isNaN(openingDate.getTime())) throw new BadRequestException('تاریخ افتتاحیه نامعتبر است');
    if (openingBalance !== 0) await assertPeriodOpen(ctx.tenantDb, openingDate);

    const result = await ctx.tenantDb.$transaction(async (tx) => {
      const acc = await this.resolveLinkedAccount(tx as unknown as Db, 'BANK', `${dto.bankName ? `${dto.bankName} — ` : ''}${dto.name}`, dto.linkedAccountId);
      const entry = await this.postOpening(tx as unknown as Db, acc.id, openingBalance, openingDate, dto.name, userId);
      return tx.bankAccount.create({
        data: {
          name: dto.name.trim(),
          bankName: dto.bankName?.trim() || null,
          branch: dto.branch?.trim() || null,
          ...fields,
          currency: dto.currency ?? 'IRT',
          openingBalance: BigInt(openingBalance),
          openingDate,
          openingEntryId: entry?.id ?? null,
          linkedAccountId: acc.id,
          createdByUserId: userId,
        },
      });
    });
    await auditAccounting(ctx, userId, 'accounting.bank.created', 'BankAccount', result.id, { name: result.name, openingBalance }, `حساب بانکی «${result.name}» تعریف شد`);
    return { ...result, openingBalance };
  }

  async updateBank(ctx: TenantRequestContext, id: string, dto: UpdateBankAccountDto) {
    const bank = await ctx.tenantDb.bankAccount.findUnique({ where: { id } });
    if (!bank) throw new NotFoundException('حساب بانکی یافت نشد');
    const fields = this.normalizeBankFields(dto);
    const userId = await this.userId(ctx);
    const updated = await ctx.tenantDb.bankAccount.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.bankName !== undefined ? { bankName: dto.bankName.trim() || null } : {}),
        ...(dto.branch !== undefined ? { branch: dto.branch.trim() || null } : {}),
        ...fields,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await auditAccounting(ctx, userId, 'accounting.bank.updated', 'BankAccount', id, { fields: Object.keys(dto) }, `حساب بانکی «${updated.name}» ویرایش شد`);
    return { ...updated, openingBalance: toNum(updated.openingBalance) };
  }

  // ── صندوق ─────────────────────────────────────────────────────────────────

  async listCashBoxes(ctx: TenantRequestContext) {
    const boxes = await ctx.tenantDb.cashBox.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      include: { linkedAccount: { select: { id: true, code: true, name: true } } },
    });
    const users = await ctx.tenantDb.user.findMany({ where: { id: { in: boxes.map((b) => b.custodianUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    const out = [];
    for (const b of boxes) {
      out.push({ ...b, openingBalance: toNum(b.openingBalance), custodianName: b.custodianUserId ? (name.get(b.custodianUserId) ?? null) : null, balance: await this.ledgerBalance(ctx.tenantDb, b.linkedAccountId) });
    }
    return out;
  }

  private async assertUserExists(db: Db, userId: string) {
    const u = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) throw new BadRequestException('مسئول صندوق یافت نشد');
  }

  async createCashBox(ctx: TenantRequestContext, dto: CreateCashBoxDto) {
    const userId = await this.userId(ctx);
    if (dto.custodianUserId) await this.assertUserExists(ctx.tenantDb, dto.custodianUserId);
    const openingBalance = dto.openingBalance ?? 0;
    const openingDate = dto.openingDate ? new Date(dto.openingDate) : new Date();
    if (Number.isNaN(openingDate.getTime())) throw new BadRequestException('تاریخ افتتاحیه نامعتبر است');
    if (openingBalance !== 0) await assertPeriodOpen(ctx.tenantDb, openingDate);
    const result = await ctx.tenantDb.$transaction(async (tx) => {
      const acc = await this.resolveLinkedAccount(tx as unknown as Db, 'CASH', dto.name, dto.linkedAccountId);
      const entry = await this.postOpening(tx as unknown as Db, acc.id, openingBalance, openingDate, dto.name, userId);
      return tx.cashBox.create({
        data: { name: dto.name.trim(), custodianUserId: dto.custodianUserId ?? null, openingBalance: BigInt(openingBalance), openingDate, openingEntryId: entry?.id ?? null, linkedAccountId: acc.id, createdByUserId: userId },
      });
    });
    await auditAccounting(ctx, userId, 'accounting.cashbox.created', 'CashBox', result.id, { name: result.name, openingBalance }, `صندوق «${result.name}» تعریف شد`);
    return { ...result, openingBalance };
  }

  /** «صندوق اصلی» پیش‌فرض: روی حساب موجود ۱۰۱۰ (صندوق) سوار می‌شود تا گردش‌های قبلی فاکتورها همان‌جا دیده شود. فقط اگر هنوز صندوقی نباشد. */
  async ensureDefaultCashBox(ctx: TenantRequestContext) {
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    const existing = await ctx.tenantDb.cashBox.findFirst();
    if (existing) return { created: false, id: existing.id };
    const acc = await ctx.tenantDb.account.findUnique({ where: { code: PARENT_CODE.CASH } });
    if (!acc) throw new BadRequestException('حساب صندوق (۱۰۱۰) یافت نشد');
    const userId = await this.userId(ctx);
    const box = await ctx.tenantDb.cashBox.create({ data: { name: 'صندوق اصلی', openingDate: new Date(), linkedAccountId: acc.id, createdByUserId: userId } });
    await auditAccounting(ctx, userId, 'accounting.cashbox.created', 'CashBox', box.id, { name: box.name, seeded: true }, 'صندوق اصلی ساخته شد');
    return { created: true, id: box.id };
  }

  async updateCashBox(ctx: TenantRequestContext, id: string, dto: UpdateCashBoxDto) {
    const box = await ctx.tenantDb.cashBox.findUnique({ where: { id } });
    if (!box) throw new NotFoundException('صندوق یافت نشد');
    if (dto.custodianUserId) await this.assertUserExists(ctx.tenantDb, dto.custodianUserId);
    const userId = await this.userId(ctx);
    const updated = await ctx.tenantDb.cashBox.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.custodianUserId !== undefined ? { custodianUserId: dto.custodianUserId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await auditAccounting(ctx, userId, 'accounting.cashbox.updated', 'CashBox', id, { fields: Object.keys(dto) }, `صندوق «${updated.name}» ویرایش شد`);
    return { ...updated, openingBalance: toNum(updated.openingBalance) };
  }

  // ── صورت‌حساب و مانده تا تاریخ ────────────────────────────────────────────

  async holderAccount(ctx: TenantRequestContext, kind: Kind, id: string) {
    const h = kind === 'BANK' ? await ctx.tenantDb.bankAccount.findUnique({ where: { id } }) : await ctx.tenantDb.cashBox.findUnique({ where: { id } });
    if (!h) throw new NotFoundException(kind === 'BANK' ? 'حساب بانکی یافت نشد' : 'صندوق یافت نشد');
    return h;
  }

  /**
   * صورت‌حساب بانک/صندوق از روی دفتر کل حساب وصل‌شده: مانده‌ی ابتدای دوره، ردیف‌ها با مانده‌ی جاری و
   * نشان «مغایرت‌گیری‌شده» (تطبیق با ردیف صورت‌حساب بانکی، همان ماژول مغایرت‌گیری موجود).
   */
  async statement(ctx: TenantRequestContext, kind: Kind, id: string, q: PeriodQuery) {
    const holder = await this.holderAccount(ctx, kind, id);
    const period = resolvePeriod(q, { startMonth: await getFiscalStartMonth(ctx.tenantDb), defaultMode: 'all' });
    const accountId = holder.linkedAccountId;
    const account = await ctx.tenantDb.account.findUniqueOrThrow({ where: { id: accountId } });
    const [before, lines] = await Promise.all([
      ctx.tenantDb.journalLine.aggregate({
        where: { accountId, entry: { status: 'POSTED', date: { lt: period.from } } },
        _sum: { debit: true, credit: true },
      }),
      ctx.tenantDb.journalLine.findMany({
        where: { accountId, entry: { status: 'POSTED', date: { gte: period.from, lt: period.toExclusive } } },
        include: { entry: { select: { id: true, number: true, date: true, description: true } }, bankStatementLine: { select: { id: true } } },
        orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
      }),
    ]);
    const entryIds = [...new Set(lines.map((l) => l.entry.id))];
    const txs = entryIds.length
      ? await ctx.tenantDb.bankTransaction.findMany({
          where: { OR: [{ journalEntryId: { in: entryIds } }, { reversalEntryId: { in: entryIds } }] },
          select: { id: true, number: true, type: true, status: true, referenceNo: true, journalEntryId: true, reversalEntryId: true },
        })
      : [];
    const txByEntry = new Map<string, (typeof txs)[number]>();
    for (const t of txs) {
      if (t.journalEntryId) txByEntry.set(t.journalEntryId, t);
      if (t.reversalEntryId) txByEntry.set(t.reversalEntryId, t);
    }
    const ledger = computeLedger(
      account.type as AccountType,
      (before._sum.debit ?? 0n) - (before._sum.credit ?? 0n),
      lines.map((l) => ({
        id: l.id,
        entryNumber: l.entry.number,
        date: l.entry.date,
        description: l.description ?? l.entry.description,
        debit: toNum(l.debit),
        credit: toNum(l.credit),
      })),
    );
    const reconciledById = new Map(lines.map((l) => [l.id, !!l.bankStatementLine]));
    const txById = new Map(lines.map((l) => [l.id, txByEntry.get(l.entry.id) ?? null]));
    return {
      holder: { kind, id, name: holder.name },
      account: { id: account.id, code: account.code, name: account.name },
      period: { mode: period.mode, key: period.key, label: period.label },
      openingBalance: ledger.opening,
      closingBalance: ledger.closing,
      totalDebit: ledger.totalDebit,
      totalCredit: ledger.totalCredit,
      rows: ledger.rows.map((r) => ({ ...r, reconciled: reconciledById.get(r.id) ?? false, transaction: txById.get(r.id) ?? null })),
    };
  }

  async balanceAsOf(ctx: TenantRequestContext, kind: Kind, id: string, asOf?: string) {
    const holder = await this.holderAccount(ctx, kind, id);
    let cutoff: Date | undefined;
    if (asOf) {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? new Date(new Date(`${asOf}T00:00:00+03:30`).getTime() + 86_400_000) : new Date(new Date(asOf).getTime() + 1);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
      cutoff = d;
    }
    return { id, name: holder.name, asOf: asOf ?? null, balance: await this.ledgerBalance(ctx.tenantDb, holder.linkedAccountId, cutoff) };
  }

  // ── تراکنش‌ها ─────────────────────────────────────────────────────────────

  async listTransactions(ctx: TenantRequestContext, q: PeriodQuery & { bankAccountId?: string; cashBoxId?: string; type?: string; status?: string; limit?: string }) {
    // پارامترهای کوئری ممکن است آرایه/آبجکت باشند (?type[x]=1) و به فیلتر پریزما تزریق شوند؛ فقط رشته پذیرفته می‌شود
    for (const k of ['bankAccountId', 'cashBoxId', 'type', 'status'] as const) {
      if (q[k] !== undefined && typeof q[k] !== 'string') throw new BadRequestException(`پارامتر ${k} نامعتبر است`);
    }
    const period = q.period || q.fiscalYear || q.from || q.to ? resolvePeriod(q, { startMonth: await getFiscalStartMonth(ctx.tenantDb) }) : null;
    const holderOr: Array<Record<string, unknown>> = [];
    if (q.bankAccountId) holderOr.push({ bankAccountId: q.bankAccountId }, { toBankAccountId: q.bankAccountId });
    if (q.cashBoxId) holderOr.push({ cashBoxId: q.cashBoxId }, { toCashBoxId: q.cashBoxId });
    const take = Math.min(500, Math.max(1, Number(q.limit) || 200));
    const rows = await ctx.tenantDb.bankTransaction.findMany({
      where: {
        ...(period ? { date: { gte: period.from, lt: period.toExclusive } } : {}),
        ...(holderOr.length ? { OR: holderOr } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      include: { bankAccount: { select: { name: true } }, cashBox: { select: { name: true } }, toBankAccount: { select: { name: true } }, toCashBox: { select: { name: true } } },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take,
    });
    const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
    const contacts = contactIds.length ? await ctx.tenantDb.crmContact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } }) : [];
    const cname = new Map(contacts.map((c) => [c.id, c.name]));
    return rows.map((r) => ({ ...r, amount: toNum(r.amount), contactName: r.contactId ? (cname.get(r.contactId) ?? null) : null }));
  }

  private async resolveHolder(db: Db, bankId: string | undefined, cashId: string | undefined, role: string) {
    if (!!bankId === !!cashId) throw new BadRequestException(`${role}: دقیقاً یکی از حساب بانکی یا صندوق را انتخاب کنید`);
    if (bankId) {
      const b = await db.bankAccount.findUnique({ where: { id: bankId } });
      if (!b) throw new NotFoundException('حساب بانکی یافت نشد');
      if (!b.isActive) throw new ConflictException(`حساب بانکی «${b.name}» غیرفعال است`);
      return { kind: 'BANK' as const, id: b.id, name: b.name, accountId: b.linkedAccountId };
    }
    const c = await db.cashBox.findUnique({ where: { id: cashId! } });
    if (!c) throw new NotFoundException('صندوق یافت نشد');
    if (!c.isActive) throw new ConflictException(`صندوق «${c.name}» غیرفعال است`);
    return { kind: 'CASH' as const, id: c.id, name: c.name, accountId: c.linkedAccountId };
  }

  async createTransaction(ctx: TenantRequestContext, dto: CreateBankTransactionDto) {
    const db = ctx.tenantDb;
    await ensureDefaultChartOfAccounts(db);
    const date = new Date(dto.date);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
    const userId = await this.userId(ctx);
    const holder = await this.resolveHolder(db, dto.bankAccountId, dto.cashBoxId, dto.type === 'TRANSFER' ? 'مبدأ' : 'بانک/صندوق');

    let otherAccountId: string;
    let contactName: string | null = null;
    if (dto.type === 'TRANSFER') {
      if (dto.contactId || dto.counterAccountId) throw new BadRequestException('انتقال، طرف‌حساب یا حساب مقابل ندارد');
      const dest = await this.resolveHolder(db, dto.toBankAccountId, dto.toCashBoxId, 'مقصد');
      if (dest.accountId === holder.accountId) throw new BadRequestException('مبدأ و مقصد انتقال نمی‌تواند یکی باشد');
      otherAccountId = dest.accountId;
    } else {
      if (dto.toBankAccountId || dto.toCashBoxId) throw new BadRequestException('مقصد فقط برای انتقال است');
      if (!!dto.contactId === !!dto.counterAccountId) throw new BadRequestException('طرف‌حساب (مشتری/تأمین‌کننده) یا حساب مقابل دفتر کل را — فقط یکی — انتخاب کنید');
      if (dto.contactId) {
        const contact = await db.crmContact.findUnique({ where: { id: dto.contactId }, select: { id: true, name: true } });
        if (!contact) throw new NotFoundException('طرف‌حساب یافت نشد');
        if (dto.amount > 2_147_483_647) throw new BadRequestException('مبلغ تراکنش با طرف‌حساب از ۲٬۱۴۷٬۴۸۳٬۶۴۷ تومان بیشتر نمی‌تواند باشد');
        contactName = contact.name;
        const code = dto.type === 'RECEIPT' ? AR_CODE : AP_CODE;
        const acc = await db.account.findUnique({ where: { code } });
        if (!acc) throw new BadRequestException(`کدینگ حسابداری ${code} یافت نشد`);
        otherAccountId = acc.id;
      } else {
        const acc = await db.account.findUnique({ where: { id: dto.counterAccountId! } });
        if (!acc) throw new NotFoundException('حساب مقابل یافت نشد');
        otherAccountId = acc.id;
      }
    }

    if (dto.type !== 'RECEIPT' && holder.kind === 'CASH') {
      const bal = await this.ledgerBalance(db, holder.accountId);
      if (bal < dto.amount) throw new ConflictException(`موجودی صندوق «${holder.name}» برای این برداشت کافی نیست`);
    }

    const lines = buildTransactionLines(dto.type, dto.amount, holder.accountId, otherAccountId);
    const label = { RECEIPT: 'دریافت', PAYMENT: 'پرداخت', TRANSFER: 'انتقال' }[dto.type];
    const description = `${label} ${holder.name}${contactName ? ` — ${contactName}` : ''}${dto.description ? ` (${dto.description})` : ''}`;

    const created = await db.$transaction(async (tx) => {
      const entry = await postJournalEntry(tx, { date, description, lines, createdByUserId: userId });
      const bt = await tx.bankTransaction.create({
        data: {
          type: dto.type,
          date,
          amount: BigInt(dto.amount),
          description: dto.description?.trim() || null,
          referenceNo: dto.referenceNo?.trim() || null,
          bankAccountId: dto.bankAccountId ?? null,
          cashBoxId: dto.cashBoxId ?? null,
          toBankAccountId: dto.toBankAccountId ?? null,
          toCashBoxId: dto.toCashBoxId ?? null,
          counterAccountId: dto.counterAccountId ?? null,
          contactId: dto.contactId ?? null,
          journalEntryId: entry.id,
          createdByUserId: userId,
        },
      });
      if (dto.contactId && dto.type !== 'TRANSFER') {
        const code = (await tx.account.findUniqueOrThrow({ where: { id: holder.accountId } })).code;
        await tx.partyTransaction.create({
          data: {
            partyId: dto.contactId,
            type: dto.type === 'RECEIPT' ? 'RECEIPT' : 'PAYMENT',
            amount: dto.amount,
            accountCode: code,
            note: `${description} — تراکنش بانکی #${bt.number}`,
            journalEntryId: entry.id,
            createdByUserId: userId,
          },
        });
      }
      return { bt, entryNumber: entry.number };
    });
    await auditAccounting(ctx, userId, 'accounting.banktx.created', 'BankTransaction', created.bt.id, { number: created.bt.number, type: dto.type, amount: dto.amount, journalNumber: created.entryNumber }, `${label} بانک/صندوق ثبت شد`);
    return { ...created.bt, amount: dto.amount, journalNumber: created.entryNumber };
  }

  async voidTransaction(ctx: TenantRequestContext, id: string, reason: string) {
    const bt = await ctx.tenantDb.bankTransaction.findUnique({ where: { id } });
    if (!bt) throw new NotFoundException('تراکنش یافت نشد');
    if (bt.status === 'VOIDED') throw new ConflictException('این تراکنش قبلاً باطل شده است');
    if (!bt.journalEntryId) throw new ConflictException('سند این تراکنش یافت نشد');
    const userId = await this.userId(ctx);
    const reversalId = await ctx.tenantDb.$transaction(async (tx) => {
      // ادعای اتمیک تراکنش بانکی: ابطال هم‌زمان دوم ۴۰۹ می‌گیرد و کل تراکنش برمی‌گردد
      const claim = await tx.bankTransaction.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason, voidedByUserId: userId } });
      if (claim.count !== 1) throw new ConflictException('این تراکنش قبلاً باطل شده است');
      const rev = await reverseJournalEntry(tx, bt.journalEntryId!, `ابطال تراکنش بانکی ${bt.number}: ${reason}`, userId);
      // ردیف دفتر طرف‌حساب (مشتق از همین سند) با ابطال سند خنثی می‌شود
      await tx.partyTransaction.deleteMany({ where: { journalEntryId: bt.journalEntryId! } });
      await tx.bankTransaction.update({ where: { id }, data: { reversalEntryId: rev.id } });
      return rev.id;
    });
    await auditAccounting(ctx, userId, 'accounting.banktx.voided', 'BankTransaction', id, { number: bt.number, reason, reversalEntryId: reversalId }, `تراکنش بانکی ${bt.number} باطل شد`);
    return { success: true, reversalEntryId: reversalId };
  }

  // ── دسته‌چک ───────────────────────────────────────────────────────────────

  async listChequeBooks(ctx: TenantRequestContext, bankAccountId?: string) {
    const books = await ctx.tenantDb.chequeBook.findMany({
      where: bankAccountId ? { bankAccountId } : {},
      orderBy: { createdAt: 'desc' },
      include: { bankAccount: { select: { name: true, bankName: true } }, leaves: { select: { status: true } } },
    });
    return books.map(({ leaves, ...b }) => {
      const counts: Record<string, number> = {};
      for (const l of leaves) counts[l.status] = (counts[l.status] ?? 0) + 1;
      return { ...b, counts, unused: counts.UNUSED ?? 0 };
    });
  }

  async getChequeBook(ctx: TenantRequestContext, id: string) {
    const book = await ctx.tenantDb.chequeBook.findUnique({
      where: { id },
      include: {
        bankAccount: { select: { id: true, name: true, bankName: true } },
        leaves: { orderBy: { serial: 'asc' }, include: { linkedCheck: { select: { id: true, sayadId: true, amount: true, dueDate: true, status: true, contact: { select: { name: true } } } } } },
      },
    });
    if (!book) throw new NotFoundException('دسته‌چک یافت نشد');
    return book;
  }

  /** برگ‌های مصرف‌نشده‌ی دسته‌چک‌های فعال (برای انتخاب هنگام صدور چک). */
  async availableLeaves(ctx: TenantRequestContext, bankAccountId?: string) {
    const books = await ctx.tenantDb.chequeBook.findMany({
      where: { status: 'ACTIVE', ...(bankAccountId ? { bankAccountId } : {}), bankAccount: { isActive: true } },
      orderBy: { createdAt: 'asc' },
      include: { bankAccount: { select: { name: true, bankName: true } }, leaves: { where: { status: 'UNUSED' }, orderBy: { serial: 'asc' }, take: 60, select: { id: true, serial: true } } },
    });
    return books.map((b) => ({ id: b.id, name: b.name, series: b.series, bankAccountId: b.bankAccountId, bankAccountName: b.bankAccount.name, bankName: b.bankAccount.bankName, nextSerial: b.leaves[0]?.serial ?? null, leaves: b.leaves }));
  }

  async createChequeBook(ctx: TenantRequestContext, dto: CreateChequeBookDto) {
    const bank = await ctx.tenantDb.bankAccount.findUnique({ where: { id: dto.bankAccountId } });
    if (!bank) throw new NotFoundException('حساب بانکی یافت نشد');
    if (!bank.isActive) throw new ConflictException('حساب بانکی غیرفعال است');
    if (dto.endSerial < dto.startSerial) throw new BadRequestException('سریال پایان نمی‌تواند از شروع کمتر باشد');
    const count = dto.endSerial - dto.startSerial + 1;
    if (count > MAX_LEAVES) throw new BadRequestException(`حداکثر ${MAX_LEAVES} برگ در هر دسته‌چک`);
    if (dto.leafCount !== undefined && dto.leafCount !== count) throw new BadRequestException('تعداد برگ‌ها با بازه‌ی سریال‌ها همخوانی ندارد');
    const series = dto.series?.trim() || null;
    const others = await ctx.tenantDb.chequeBook.findMany({ where: { bankAccountId: dto.bankAccountId, series }, select: { startSerial: true, endSerial: true, name: true } });
    const clash = others.find((o) => dto.startSerial <= o.endSerial && dto.endSerial >= o.startSerial);
    if (clash) throw new ConflictException(`بازه‌ی سریال با دسته‌چک «${clash.name}» همپوشانی دارد`);
    const userId = await this.userId(ctx);
    const book = await ctx.tenantDb.$transaction(async (tx) => {
      const b = await tx.chequeBook.create({ data: { bankAccountId: dto.bankAccountId, name: dto.name.trim(), series, startSerial: dto.startSerial, endSerial: dto.endSerial, leafCount: count, note: dto.note?.trim() || null, createdByUserId: userId } });
      await tx.chequeLeaf.createMany({ data: Array.from({ length: count }, (_, i) => ({ chequeBookId: b.id, serial: dto.startSerial + i })) });
      return b;
    });
    await auditAccounting(ctx, userId, 'accounting.chequebook.created', 'ChequeBook', book.id, { name: book.name, startSerial: dto.startSerial, endSerial: dto.endSerial }, `دسته‌چک «${book.name}» تعریف شد`);
    return book;
  }

  async updateChequeBook(ctx: TenantRequestContext, id: string, dto: UpdateChequeBookDto) {
    const book = await ctx.tenantDb.chequeBook.findUnique({ where: { id } });
    if (!book) throw new NotFoundException('دسته‌چک یافت نشد');
    const userId = await this.userId(ctx);
    await ctx.tenantDb.chequeBook.update({
      where: { id },
      data: { ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}), ...(dto.status !== undefined ? { status: dto.status } : {}) },
    });
    if (dto.status === 'ACTIVE') await refreshBookStatus(ctx.tenantDb, id);
    await auditAccounting(ctx, userId, 'accounting.chequebook.updated', 'ChequeBook', id, { fields: Object.keys(dto) }, `دسته‌چک «${book.name}» ویرایش شد`);
    return this.getChequeBook(ctx, id);
  }

  /** تغییر دستی وضعیت برگ: فقط مصرف‌نشده ↔ باطل/مفقود. وضعیت‌های صادرشده/پاس/برگشتی از روی خودِ چک همگام می‌شوند. */
  async setLeafStatus(ctx: TenantRequestContext, leafId: string, dto: SetLeafStatusDto) {
    const leaf = await ctx.tenantDb.chequeLeaf.findUnique({ where: { id: leafId } });
    if (!leaf) throw new NotFoundException('برگ چک یافت نشد');
    if (leaf.linkedCheckId || ['ISSUED', 'CLEARED', 'BOUNCED'].includes(leaf.status)) throw new ConflictException('این برگ به یک چک وصل است؛ وضعیت آن از روی چک تغییر می‌کند');
    if (leaf.status === dto.status) return leaf;
    const userId = await this.userId(ctx);
    const updated = await ctx.tenantDb.chequeLeaf.update({ where: { id: leafId }, data: { status: dto.status, statusNote: dto.note?.trim() || null, updatedAt: new Date() } });
    await refreshBookStatus(ctx.tenantDb, leaf.chequeBookId);
    await auditAccounting(ctx, userId, 'accounting.chequeleaf.status', 'ChequeLeaf', leafId, { serial: leaf.serial, from: leaf.status, to: dto.status, note: dto.note ?? null }, `وضعیت برگ چک ${leaf.serial} تغییر کرد`);
    return updated;
  }
}
