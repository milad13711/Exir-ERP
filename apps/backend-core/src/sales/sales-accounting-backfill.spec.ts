import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { SalesAccountingBackfillService } from './sales-accounting-backfill.service.js';
import { CostingService } from '../warehouse/costing.service.js';
import { periodKeyOfDate } from './period-gate.js';
import type { TenantRequestContext } from '../common/request-context.js';

/** یک دیتابیس درون‌حافظه‌ای کوچک که فقط همان عملیاتی را که سرویس ثبت دسته‌ای می‌زند پشتیبانی می‌کند (با rollback واقعی تراکنش). */

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(v);
      if ('not' in cond) return cond.not === null ? v != null : v !== cond.not;
      if ('gt' in cond) return v > cond.gt;
      if ('gte' in cond) return v >= cond.gte;
      if ('lt' in cond) return typeof cond.lt === 'number' ? v < cond.lt : v < cond.lt;
      if (v && typeof v === 'object' && !(v instanceof Date)) return matches(v, cond);
      return false;
    }
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    return v === cond || (cond === null && v == null);
  });
}

const ACCOUNTS: Record<string, { id: string }> = { '1010': { id: 'cash' }, '1020': { id: 'bank' }, '1030': { id: 'ar' }, '1040': { id: 'inv' }, '2020': { id: 'tax' }, '4010': { id: 'rev' }, '5010': { id: 'cogs' } };

function makeWorld(opts: { invoices: Row[]; payments?: Row[]; returns?: Row[]; locked?: string[] }) {
  const state = { invoices: opts.invoices, payments: opts.payments ?? [], returns: opts.returns ?? [], journals: [] as Row[], settings: new Map<string, unknown>(), logs: [] as Row[] };
  const snapshot = () => JSON.stringify(state, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
  const table = (rows: () => Row[], extra: Row = {}) => ({
    findMany: vi.fn(async (a: Row = {}) => {
      let r = rows().filter((x) => matches(x, a.where));
      if (a.orderBy) {
        const keys = (Array.isArray(a.orderBy) ? a.orderBy : [a.orderBy]).flatMap((o: Row) => Object.entries(o));
        r = [...r].sort((x, y) => { for (const [k] of keys) { const d = (x[k] instanceof Date ? x[k].getTime() : x[k]) > (y[k] instanceof Date ? y[k].getTime() : y[k]) ? 1 : (x[k] instanceof Date ? x[k].getTime() : x[k]) < (y[k] instanceof Date ? y[k].getTime() : y[k]) ? -1 : 0; if (d) return d; } return 0; });
      }
      return a.take ? r.slice(0, a.take) : r;
    }),
    findUnique: vi.fn(async (a: Row) => rows().find((x) => x.id === a.where.id) ?? null),
    updateMany: vi.fn(async (a: Row) => { const hit = rows().filter((x) => matches(x, a.where)); hit.forEach((x) => Object.assign(x, a.data)); return { count: hit.length }; }),
    update: vi.fn(async (a: Row) => { const x = rows().find((y) => y.id === a.where.id)!; Object.assign(x, a.data); return x; }),
    ...extra,
  });
  const db: any = {
    account: { count: vi.fn(async () => 7), findUnique: vi.fn(async (a: Row) => ACCOUNTS[a.where.code] ?? null) },
    user: { findUnique: vi.fn(async () => ({ name: 'مدیر' })) },
    product: { findUnique: vi.fn(async () => ({ costPrice: 0 })) },
    moduleSetting: {
      findUnique: vi.fn(async (a: Row) => { const v = state.settings.get(a.where.moduleCode_key.key); return v === undefined ? null : { value: v }; }),
      upsert: vi.fn(async (a: Row) => { state.settings.set(a.where.moduleCode_key.key, JSON.parse(JSON.stringify(a.update.value))); return {}; }),
    },
    salesInvoice: table(() => state.invoices),
    salesPayment: table(() => state.payments),
    salesReturn: table(() => state.returns),
    journalEntry: { create: vi.fn(async (a: Row) => { const e = { id: `je-${state.journals.length + 1}`, ...a.data }; state.journals.push(e); return e; }) },
    accountingPeriodLock: {
      findUnique: vi.fn(async (a: Row) => (opts.locked?.includes(a.where.periodKey) ? { isLocked: true } : null)),
      findMany: vi.fn(async (a: Row) => a.where.periodKey.in.filter((k: string) => opts.locked?.includes(k)).map((periodKey: string) => ({ periodKey }))),
    },
    activityLog: { create: vi.fn(async (a: Row) => { state.logs.push(a.data); return a.data; }) },
    $transaction: vi.fn(async (fn: any) => {
      const before = snapshot();
      const raw = JSON.parse(before, (_k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));
      try {
        return await fn(db);
      } catch (e) {
        state.invoices.splice(0, state.invoices.length, ...raw.invoices);
        state.payments.splice(0, state.payments.length, ...raw.payments);
        state.returns.splice(0, state.returns.length, ...raw.returns);
        state.journals.splice(0, state.journals.length, ...raw.journals);
        throw e;
      }
    }),
  };
  return { db, state };
}

const controlDb = (accounting: boolean) => ({
  moduleDefinition: { findMany: async () => [{ id: 'acc', code: 'accounting', dependsOn: [], isCore: false }] },
  tenantModule: { findMany: async () => (accounting ? [{ moduleId: 'acc', status: 'INSTALLED' }] : []) },
});

const ctxOf = (db: unknown, role = 'OWNER') => ({ tenantDb: db, auth: { type: 'user', sub: 'g1', role }, tenantId: 't1', tenantSlug: 'acme' }) as unknown as TenantRequestContext;
const svc = (accounting = true) => new SalesAccountingBackfillService(controlDb(accounting) as never, new CostingService());

function inv(n: number, over: Row = {}): Row {
  return { id: `inv-${n}`, invoiceNo: n, status: 'CONFIRMED', total: 1000 * n, taxAmount: 0, accountingPosted: false, journalEntryId: null, issuedAt: new Date(2026, 0, n), confirmedAt: new Date(2026, 0, n), lines: [{ productId: null, quantity: 1 }], ...over };
}

async function runAll(service: SalesAccountingBackfillService, ctx: TenantRequestContext, limit = 2, extra: Row = {}) {
  let res = await service.runBatch(ctx, { confirm: true, limit, ...extra } as never);
  let guard = 0;
  while (!res.done && guard++ < 50) res = await service.runBatch(ctx, { confirm: true, limit, stage: res.stage, cursor: res.cursor, runId: res.runId, ...extra } as never);
  return res;
}

describe('SalesAccountingBackfillService', () => {
  it('only managers can preview/run; refuses when accounting is not active; requires explicit confirm', async () => {
    const { db } = makeWorld({ invoices: [inv(1)] });
    await expect(svc().preview(ctxOf(db, 'MEMBER'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc(false).runBatch(ctxOf(db), { confirm: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc().runBatch(ctxOf(db), { confirm: false })).rejects.toBeInstanceOf(BadRequestException);
    const pv = await svc(false).preview(ctxOf(db));
    expect(pv.accountingActive).toBe(false);
  });

  it('preview: counts, date range, totals; cancelled/draft/already-posted invoices are excluded', async () => {
    const { db } = makeWorld({
      invoices: [inv(1), inv(2), inv(3, { status: 'DRAFT', confirmedAt: null }), inv(4, { status: 'CANCELLED' }), inv(5, { accountingPosted: true, journalEntryId: 'je-old' })],
    });
    const pv = await svc().preview(ctxOf(db));
    expect(pv.accountingActive).toBe(true);
    expect(pv.invoices.count).toBe(2);
    expect(pv.invoices.total).toBe(3000);
    expect(pv.invoices.from?.getTime()).toBe(new Date(2026, 0, 1).getTime());
    expect(pv.invoices.to?.getTime()).toBe(new Date(2026, 0, 2).getTime());
    expect(pv.blockedCount).toBe(0);
  });

  it('preview flags invoices in a closed period with a reason', async () => {
    const closed = periodKeyOfDate(new Date(2026, 0, 1)).key;
    const { db } = makeWorld({ invoices: [inv(1), inv(2, { confirmedAt: new Date(2026, 5, 1), issuedAt: new Date(2026, 5, 1) })], locked: [closed] });
    const pv = await svc().preview(ctxOf(db));
    expect(pv.blockedCount).toBe(1);
    expect(pv.blocked[0]).toMatchObject({ type: 'INVOICE', no: 1 });
    expect(pv.blocked[0].reason).toContain('بسته');
  });

  it('posts balanced sale journals in batches, links journalEntryId, and is idempotent on re-run (no double posting)', async () => {
    const { db, state } = makeWorld({ invoices: [inv(1), inv(2), inv(3), inv(4, { taxAmount: 100 })] });
    const ctx = ctxOf(db);
    const res = await runAll(svc(), ctx, 2);
    expect(res.done).toBe(true);
    expect(state.journals).toHaveLength(4);
    for (const j of state.journals) {
      const d = j.lines.create.reduce((s: bigint, l: Row) => s + l.debit, 0n);
      const c = j.lines.create.reduce((s: bigint, l: Row) => s + l.credit, 0n);
      expect(d).toBe(c);
    }
    expect(state.invoices.every((i) => i.accountingPosted && i.journalEntryId)).toBe(true);
    expect(res.report.posted.invoices).toBe(4);

    // دوباره اجرا → هیچ سند تازه‌ای
    const again = await runAll(svc(), ctx, 3);
    expect(again.done).toBe(true);
    expect(state.journals).toHaveLength(4);
    expect(again.report.posted.invoices).toBe(0);
  });

  it('concurrent runs never double-post (atomic claim): a lost claim is "already" and writes nothing', async () => {
    const { db, state } = makeWorld({ invoices: [inv(1)] });
    const ctx = ctxOf(db);
    // رقیب همین‌لحظه ثبتش می‌کند: claim ما count=0 می‌گیرد
    const original = db.salesInvoice.updateMany;
    db.salesInvoice.updateMany = vi.fn(async (a: Row) => {
      state.invoices[0].accountingPosted = true;
      state.invoices[0].journalEntryId = 'je-other';
      return original(a);
    });
    const res = await svc().runBatch(ctx, { confirm: true });
    expect(state.journals).toHaveLength(0);
    expect(res.report.posted.invoices).toBe(0);
    expect(res.report.failed).toBe(0);
  });

  it('payments and returns are posted after (and only for) posted invoices; payment journal is Dr cash/bank, Cr AR', async () => {
    const i1 = inv(1);
    const p1 = { id: 'p1', amount: 500, method: 'CASH', paidAt: new Date(2026, 0, 2), accountingPosted: false, journalEntryId: null, invoice: i1, invoiceId: 'inv-1' };
    const p2 = { id: 'p2', amount: 300, method: 'BANK_TRANSFER', paidAt: new Date(2026, 0, 3), accountingPosted: false, journalEntryId: null, invoice: i1, invoiceId: 'inv-1' };
    const r1 = { id: 'r1', returnNo: 1, subtotal: 200, total: 200, accountingPosted: false, journalEntryId: null, createdAt: new Date(2026, 0, 4), lines: [], invoice: i1 };
    const { db, state } = makeWorld({ invoices: [i1], payments: [p1, p2], returns: [r1] });
    const res = await runAll(svc(), ctxOf(db), 10);
    expect(res.done).toBe(true);
    expect(res.report.posted).toEqual({ invoices: 1, payments: 2, returns: 1 });
    const payJ = state.journals.find((j) => j.description.includes('دریافت وجه'))!;
    expect(payJ.lines.create[0]).toMatchObject({ accountId: 'cash', debit: 500n });
    expect(state.journals.filter((j) => j.description.includes('دریافت وجه')).map((j) => j.lines.create[0].accountId)).toEqual(['cash', 'bank']);
    expect(state.journals).toHaveLength(4);
    expect(p1.accountingPosted && p2.accountingPosted && r1.accountingPosted).toBe(true);
  });

  it('a closed period is skipped with a reason (ORIGINAL) and posted dated today with TODAY_IF_LOCKED', async () => {
    const closed = periodKeyOfDate(new Date(2026, 0, 1)).key;
    const mk = () => makeWorld({ invoices: [inv(1)], locked: [closed] });
    const a = mk();
    const r1 = await runAll(svc(), ctxOf(a.db), 5);
    expect(a.state.journals).toHaveLength(0);
    expect(r1.report.skipped).toBe(1);
    expect(r1.report.issues[0].reason).toContain('بسته');
    expect(a.state.invoices[0].accountingPosted).toBe(false); // ادعا با rollback برگشت

    const b = mk();
    const r2 = await runAll(svc(), ctxOf(b.db), 5, { dateMode: 'TODAY_IF_LOCKED' });
    expect(b.state.journals).toHaveLength(1);
    expect(b.state.journals[0].description).toContain('دوره‌ی بسته');
    expect(r2.report.posted.invoices).toBe(1);
  });

  it('a missing account fails that row only, leaves it unposted (rollback) and reports the reason', async () => {
    const { db, state } = makeWorld({ invoices: [inv(1), inv(2)] });
    const orig = db.account.findUnique;
    let n = 0;
    db.account.findUnique = vi.fn(async (a: Row) => (a.where.code === '4010' && n++ === 0 ? null : orig(a)));
    const res = await runAll(svc(), ctxOf(db), 5);
    expect(res.report.failed).toBe(1);
    expect(res.report.posted.invoices).toBe(1);
    expect(state.invoices.filter((i) => i.accountingPosted)).toHaveLength(1);
    expect(res.report.issues[0].reason).toContain('4010');
  });

  it('persists a progress report and writes an audit log row per batch', async () => {
    const { db, state } = makeWorld({ invoices: [inv(1), inv(2), inv(3)] });
    const res = await runAll(svc(), ctxOf(db), 2);
    const saved = await svc().lastReport(ctxOf(db));
    expect(saved?.runId).toBe(res.runId);
    expect(saved?.finishedAt).toBeTruthy();
    expect(state.logs.length).toBeGreaterThanOrEqual(2);
    expect(state.logs.at(-1)?.action).toBe('sales.accounting_backfill.finished');
  });
});
