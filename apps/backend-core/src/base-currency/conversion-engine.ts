import {
  CURRENCY_CODE_COLUMNS,
  MONEY_COLUMNS,
  MONEY_SETTINGS,
  RATE_COLUMNS,
  groupByTable,
  qi,
  type MoneyColumn,
} from './money-columns.js';
import { JSON_MONEY_COLUMNS, scaleJsonDoc } from './json-money.js';
import { INT4_MAX, SAFE_MAX, scaleRounded, scaleValue, type Rational, type RoundingMode } from './rational.js';

/**
 * هسته‌ی تبدیل: فقط SQL خام روی یک «اتصال» (تراکنش یا کلاینت) و هیچ وابستگی Nest/HTTP ندارد، تا
 * هم در تراکنش واقعی اجرا شود و هم در تست با یک پایگاه‌داده‌ی جعلی. همه‌ی مبالغ BigInt/numeric‌اند، نه float.
 */
export type RawDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export type ColumnStat = {
  table: string;
  column: string;
  group: string;
  kind: 'int4' | 'int8';
  /** تعداد خانه‌های غیر‌تهی */
  count: number;
  sumBefore: string;
  maxAbs: string;
  /** تعداد خانه‌هایی که ضرب در نرخ، عدد صحیح نمی‌شود */
  lossy: number;
  /** حداکثر پس از تبدیل از سقف ستون عبور می‌کند؟ */
  overflow: boolean;
  sumExpectedAfter: string;
};

export type RateStat = { table: string; column: string; group: string; count: number; lossy: number; overflow: boolean };

export type JsonStat = { table: string; column: string; group: string; rows: number; cells: number; lossy: number; overflow: boolean; maxAbs: string };

export type TableStat = { table: string; group: string; rows: number; columns: ColumnStat[] };

export type LedgerStat = {
  totalDebit: string;
  totalCredit: string;
  entries: number;
  unbalancedEntries: number;
};

export type Sample = { table: string; column: string; id: string; before: string; after: string; exact: boolean };

export type Issue = { code: string; message: string; detail?: unknown };

export type PreviewReport = {
  tables: TableStat[];
  rates: RateStat[];
  jsonColumns: JsonStat[];
  ledger: LedgerStat;
  samples: Sample[];
  /** مجموع قدرمطلق اختلاف گرد‌کردن (بر حسب واحد جدید، در بدترین حالت)، فقط ستون‌های مبلغی */
  roundingCells: number;
  blocking: Issue[];
  warnings: Issue[];
};

const toN = (v: unknown) => Number(v ?? 0);
const toBig = (v: unknown) => BigInt(String(v ?? '0'));

/** ستون‌/جدول‌هایی که در این دیتابیس نیستند — تننت‌ی که مهاجرت‌هایش عقب است نباید نیمه‌کاره تبدیل شود. */
export async function findMissingColumns(db: RawDb): Promise<string[]> {
  const want = [
    ...MONEY_COLUMNS.map((m) => ({ table: m.table, column: m.column })),
    ...RATE_COLUMNS.map((m) => ({ table: m.table, column: m.column })),
    ...CURRENCY_CODE_COLUMNS,
    ...JSON_MONEY_COLUMNS.map((j) => ({ table: j.table, column: j.column })),
  ];
  const tables = [...new Set(want.map((w) => w.table))];
  const rows = await db.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    tables,
  );
  const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  return want.filter((w) => !have.has(`${w.table}.${w.column}`)).map((w) => `${w.table}.${w.column}`);
}

async function tableStats(db: RawDb, table: string, cols: MoneyColumn[], rate: Rational): Promise<TableStat> {
  const parts = cols.flatMap((c, i) => [
    `COUNT(${qi(c.column)})::text AS "c${i}n"`,
    `COALESCE(SUM(${qi(c.column)}),0)::text AS "c${i}s"`,
    `COALESCE(MAX(ABS(${qi(c.column)})),0)::text AS "c${i}m"`,
    `(COUNT(*) FILTER (WHERE ${qi(c.column)} IS NOT NULL AND (${qi(c.column)}::numeric * $1::numeric) % $2::numeric <> 0))::text AS "c${i}l"`,
  ]);
  const [row] = await db.$queryRawUnsafe<Array<Record<string, string>>>(
    `SELECT COUNT(*)::text AS "rows", ${parts.join(', ')} FROM ${qi(table)}`,
    rate.num.toString(),
    rate.den.toString(),
  );
  const columns: ColumnStat[] = cols.map((c, i) => {
    const sum = toBig(row![`c${i}s`]);
    const maxAbs = toBig(row![`c${i}m`]);
    const limit = c.kind === 'int4' ? INT4_MAX : SAFE_MAX;
    return {
      table,
      column: c.column,
      group: c.group,
      kind: c.kind,
      count: toN(row![`c${i}n`]),
      sumBefore: sum.toString(),
      maxAbs: maxAbs.toString(),
      lossy: toN(row![`c${i}l`]),
      overflow: scaleRounded(maxAbs, rate) > limit,
      sumExpectedAfter: scaleRounded(sum, rate).toString(),
    };
  });
  return { table, group: cols[0]!.group, rows: toN(row!.rows), columns };
}

export async function ledgerStats(db: RawDb): Promise<LedgerStat> {
  const [t] = await db.$queryRawUnsafe<Array<{ d: string; c: string; e: string }>>(
    `SELECT COALESCE(SUM("debit"),0)::text AS d, COALESCE(SUM("credit"),0)::text AS c, COUNT(DISTINCT "entryId")::text AS e FROM "accounting_journal_lines"`,
  );
  const [u] = await db.$queryRawUnsafe<Array<{ n: string }>>(
    `SELECT COUNT(*)::text AS n FROM (SELECT "entryId" FROM "accounting_journal_lines" GROUP BY "entryId" HAVING SUM("debit") <> SUM("credit")) x`,
  );
  return { totalDebit: t!.d, totalCredit: t!.c, entries: toN(t!.e), unbalancedEntries: toN(u!.n) };
}

const SAMPLE_COLUMNS: Array<[string, string]> = [
  ['sales_invoices', 'total'],
  ['warehouse_products', 'salePrice'],
  ['accounting_journal_lines', 'debit'],
  ['purchase_orders', 'total'],
  ['hr_employees', 'baseSalary'],
  ['checks', 'amount'],
];

async function samples(db: RawDb, rate: Rational, mode: RoundingMode): Promise<Sample[]> {
  const out: Sample[] = [];
  for (const [table, column] of SAMPLE_COLUMNS) {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; v: string }>>(
      `SELECT "id"::text AS id, ${qi(column)}::text AS v FROM ${qi(table)} WHERE ${qi(column)} IS NOT NULL AND ${qi(column)} <> 0 ORDER BY ABS(${qi(column)}) DESC, "id" LIMIT 3`,
    );
    for (const r of rows) {
      const before = BigInt(r.v);
      try {
        const s = scaleValue(before, rate, mode);
        out.push({ table, column, id: r.id, before: before.toString(), after: s.result.toString(), exact: s.exact });
      } catch {
        out.push({ table, column, id: r.id, before: before.toString(), after: scaleRounded(before, rate).toString(), exact: false });
      }
    }
  }
  return out;
}

/** پویش ستون‌های JSON مبلغی (جدول‌های کوچک) — همان منطق pure اجرا. */
export async function scanJsonColumns(db: RawDb, rate: Rational): Promise<JsonStat[]> {
  const out: JsonStat[] = [];
  for (const j of JSON_MONEY_COLUMNS) {
    const rows = await db.$queryRawUnsafe<Array<{ doc: unknown }>>(`SELECT ${qi(j.column)} AS doc FROM ${qi(j.table)} WHERE ${qi(j.column)} IS NOT NULL`);
    let cells = 0;
    let lossy = 0;
    let skipped = 0;
    let maxAbs = 0n;
    for (const r of rows) {
      const res = scaleJsonDoc(r.doc, j.fields, rate);
      cells += res.cells;
      lossy += res.lossy;
      skipped += res.skipped;
      if (res.maxAbs > maxAbs) maxAbs = res.maxAbs;
    }
    out.push({ table: j.table, column: j.column, group: j.group, rows: rows.length, cells, lossy, overflow: skipped > 0 && scaleRounded(maxAbs, rate) > SAFE_MAX, maxAbs: maxAbs.toString() });
  }
  return out;
}

/** پیش‌نمایش فقط‌خواندنی — همان آمارهایی که اجرای واقعی هم می‌گیرد. */
export async function buildPreview(db: RawDb, rate: Rational, mode: RoundingMode): Promise<PreviewReport> {
  const blocking: Issue[] = [];
  const warnings: Issue[] = [];

  const missing = await findMissingColumns(db);
  if (missing.length) {
    blocking.push({ code: 'SCHEMA_OUTDATED', message: 'ساختار دیتابیس این محیط کاری به‌روز نیست؛ ابتدا مهاجرت‌ها اعمال شود', detail: missing });
    return { tables: [], rates: [], jsonColumns: [], ledger: { totalDebit: '0', totalCredit: '0', entries: 0, unbalancedEntries: 0 }, samples: [], roundingCells: 0, blocking, warnings };
  }

  const tables: TableStat[] = [];
  for (const [table, cols] of groupByTable()) tables.push(await tableStats(db, table, cols, rate));

  const rates: RateStat[] = [];
  for (const r of RATE_COLUMNS) {
    const [row] = await db.$queryRawUnsafe<Array<{ n: string; l: string; m: string }>>(
      `SELECT COUNT(${qi(r.column)})::text AS n,
              (COUNT(*) FILTER (WHERE ${qi(r.column)} IS NOT NULL AND ROUND(${qi(r.column)}::numeric * $1::numeric / $2::numeric, 4) <> (${qi(r.column)}::numeric * $1::numeric / $2::numeric)))::text AS l,
              (COUNT(*) FILTER (WHERE ABS(${qi(r.column)}::numeric * $1::numeric / $2::numeric) >= 100000000000000))::text AS m
       FROM ${qi(r.table)}`,
      rate.num.toString(),
      rate.den.toString(),
    );
    rates.push({ table: r.table, column: r.column, group: r.group, count: toN(row!.n), lossy: toN(row!.l), overflow: toN(row!.m) > 0 });
  }

  const jsonColumns = await scanJsonColumns(db, rate);
  const ledger = await ledgerStats(db);
  let roundingCells = 0;
  for (const t of tables) {
    for (const c of t.columns) {
      roundingCells += c.lossy;
      if (c.overflow) {
        blocking.push({
          code: 'OVERFLOW',
          message: `سرریز: بزرگ‌ترین مقدار ستون ${c.table}.${c.column} برابر ${c.maxAbs} است و پس از تبدیل از سقف ${c.kind === 'int4' ? 'عدد صحیح ۳۲ بیتی (۲٬۱۴۷٬۴۸۳٬۶۴۷)' : 'عدد امن (۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۱)'} عبور می‌کند`,
          detail: { table: c.table, column: c.column, maxAbs: c.maxAbs },
        });
      }
      if (c.lossy > 0 && mode === 'STRICT') {
        blocking.push({ code: 'INEXACT', message: `${c.lossy} خانه در ${c.table}.${c.column} بر نرخ تبدیل بخش‌پذیر نیست و حالت «دقیق» اجازه‌ی گرد‌کردن نمی‌دهد`, detail: { table: c.table, column: c.column, lossy: c.lossy } });
      }
    }
  }
  for (const j of jsonColumns) {
    roundingCells += j.lossy;
    if (j.overflow) blocking.push({ code: 'OVERFLOW', message: `مقدار JSON در ${j.table}.${j.column} پس از تبدیل از عدد امن عبور می‌کند (بیشینه: ${j.maxAbs})`, detail: { table: j.table, column: j.column, maxAbs: j.maxAbs } });
    if (j.lossy > 0 && mode === 'STRICT') blocking.push({ code: 'INEXACT', message: `${j.lossy} مقدار داخل JSON در ${j.table}.${j.column} بر نرخ تبدیل بخش‌پذیر نیست و حالت «دقیق» اجازه‌ی گرد‌کردن نمی‌دهد`, detail: { table: j.table, column: j.column, lossy: j.lossy } });
  }
  for (const r of rates) {
    if (r.overflow) blocking.push({ code: 'RATE_OVERFLOW', message: `نرخ‌های ${r.table}.${r.column} پس از تبدیل از محدوده‌ی ستون عبور می‌کنند` });
    if (r.lossy > 0) warnings.push({ code: 'RATE_ROUNDING', message: `${r.lossy} نرخ در ${r.table}.${r.column} به ۴ رقم اعشار گرد می‌شود (اثر ناچیز؛ قابل برگشت)` });
  }
  if (ledger.unbalancedEntries > 0) {
    warnings.push({ code: 'LEDGER_ALREADY_UNBALANCED', message: `${ledger.unbalancedEntries} سند دفتر کل از قبل تراز نیست؛ این اسناد دست‌نخورده با همان اختلافِ مقیاس‌شده می‌مانند` });
  }
  if (roundingCells > 0 && mode === 'ROUND') {
    warnings.push({ code: 'ROUNDING', message: `${roundingCells} خانه گرد می‌شود؛ اسناد دفتر کل با تعدیل یک سطر تراز می‌مانند و همه‌ی تغییرات در لاگ گرد‌کردن ثبت می‌شود` });
  }
  return { tables, rates, jsonColumns, ledger, samples: await samples(db, rate, mode), roundingCells, blocking, warnings };
}

// ── اجرا (باید داخل یک تراکنش صدا زده شود) ──────────────────────────────────────

export type RunParams = {
  conversionId: string;
  rate: Rational;
  mode: RoundingMode;
  fromCode: string;
  toCode: string;
  /** اگر این عملیات بازگشتِ عملیات قبلی است: لاگ گرد‌کردن آن عملیات برای بازیابی دقیق */
  restoreFromConversionId?: string;
  onProgress?: (done: number, total: number, label: string) => void;
};

export type ColumnResult = ColumnStat & { sumAfter: string; roundingAbsDiff: string };

export type RunReport = {
  tables: Array<{ table: string; rows: number; columns: ColumnResult[] }>;
  ratesRounded: number;
  jsonCells: number;
  restoredCells: number;
  ledgerAdjustments: number;
  ledgerBefore: LedgerStat;
  ledgerAfter: LedgerStat;
  settings: Array<{ moduleCode: string; key: string; before: unknown; after: unknown }>;
  currencyCodeRows: number;
  roundingTotals: { cells: number; absDiffInNewUnits: string };
  integrity: { invoiceIdentityBefore: number; invoiceIdentityAfter: number };
};

export class ConversionAbort extends Error {
  constructor(
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message);
  }
}

/** مقدار جدید: نیم‌به‌سمت‌دور‌از‌صفر؛ برای مقادیر دقیق با ضرب/تقسیم ساده یکی است. pn/pd شماره‌ی پارامتر صورت و مخرج. */
const newValueSql = (col: string, pn: number, pd: number) =>
  `(SIGN(${col}::numeric) * div(ABS(${col}::numeric) * $${pn}::numeric * 2 + $${pd}::numeric, $${pd}::numeric * 2))`;

async function invoiceIdentityViolations(db: RawDb): Promise<number> {
  const [r] = await db.$queryRawUnsafe<Array<{ n: string }>>(
    `SELECT COUNT(*)::text AS n FROM "sales_invoices" WHERE "total" <> "subtotal" - "discount" + "taxAmount"`,
  );
  return toN(r!.n);
}

type JsonRestore = Map<string, string>;

async function convertJsonColumns(db: RawDb, p: RunParams): Promise<{ cells: number; lossyRows: number; restored: number }> {
  let cells = 0;
  let lossyRows = 0;
  let restored = 0;
  for (const j of JSON_MONEY_COLUMNS) {
    // بازیابی دقیق (بازگشت): ردیف‌هایی که سند JSON فعلی‌شان همان newValue لاگ است
    const restore: JsonRestore = new Map();
    if (p.restoreFromConversionId) {
      const logged = await db.$queryRawUnsafe<Array<{ row_id: string; old_value: string }>>(
        `SELECT g."rowId" AS row_id, g."oldValue" AS old_value FROM "base_currency_rounding_log" g JOIN ${qi(j.table)} x ON x."id"::text = g."rowId"
         WHERE g."conversionId" = $1 AND g."tableName" = $2 AND g."columnName" = $3 AND x.${qi(j.column)} = g."newValue"::jsonb`,
        p.restoreFromConversionId,
        j.table,
        j.column,
      );
      for (const l of logged) restore.set(l.row_id, l.old_value);
    }
    const rows = await db.$queryRawUnsafe<Array<{ id: string; doc: unknown }>>(`SELECT "id"::text AS id, ${qi(j.column)} AS doc FROM ${qi(j.table)} WHERE ${qi(j.column)} IS NOT NULL`);
    for (const r of rows) {
      const old = restore.get(r.id);
      if (old !== undefined) {
        await db.$executeRawUnsafe(`UPDATE ${qi(j.table)} SET ${qi(j.column)} = $1::jsonb WHERE "id"::text = $2`, old, r.id);
        restored += 1;
        continue;
      }
      const res = scaleJsonDoc(r.doc, j.fields, p.rate, p.mode);
      if (res.cells === 0) continue;
      const next = JSON.stringify(res.doc);
      if (res.lossy > 0) {
        lossyRows += 1;
        await db.$executeRawUnsafe(
          `INSERT INTO "base_currency_rounding_log" ("id","conversionId","tableName","rowId","columnName","oldValue","newValue","kind") VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,'ROUND')`,
          p.conversionId,
          j.table,
          r.id,
          j.column,
          JSON.stringify(r.doc),
          next,
        );
      }
      await db.$executeRawUnsafe(`UPDATE ${qi(j.table)} SET ${qi(j.column)} = $1::jsonb WHERE "id"::text = $2`, next, r.id);
      cells += res.cells;
    }
  }
  return { cells, lossyRows, restored };
}

export async function runConversion(db: RawDb, p: RunParams, settingsIo: SettingsIo): Promise<RunReport> {
  const { rate, mode } = p;
  const num = rate.num.toString();
  const den = rate.den.toString();

  await db.$executeRawUnsafe(`SET LOCAL lock_timeout = '15s'`);
  await db.$executeRawUnsafe(`SET LOCAL statement_timeout = '900s'`);

  const missing = await findMissingColumns(db);
  if (missing.length) throw new ConversionAbort('ساختار دیتابیس به‌روز نیست', [{ code: 'SCHEMA_OUTDATED', message: missing.join(', ') }]);

  // قفل نوشتن روی همه‌ی جدول‌های مبلغی تا هیچ نویسنده‌ای وسط تبدیل داده‌ی نیمه‌کاره نبیند (خواندن آزاد می‌ماند).
  const allTables = [...new Set([...MONEY_COLUMNS.map((m) => m.table), ...RATE_COLUMNS.map((m) => m.table), ...CURRENCY_CODE_COLUMNS.map((m) => m.table)])];
  await db.$executeRawUnsafe(`LOCK TABLE ${allTables.map(qi).join(', ')} IN SHARE ROW EXCLUSIVE MODE`);

  const groups = groupByTable();
  const total = groups.size + RATE_COLUMNS.length + 4;
  let done = 0;
  const tick = (label: string) => p.onProgress?.(++done, total, label);

  // پیش‌بررسی دوباره داخل قفل (داده ممکن است بین پیش‌نمایش و اجرا عوض شده باشد)
  const ledgerBefore = await ledgerStats(db);
  const invoiceIdentityBefore = await invoiceIdentityViolations(db);
  const before: TableStat[] = [];
  for (const [table, cols] of groups) before.push(await tableStats(db, table, cols, rate));
  const issues: Issue[] = [];
  for (const t of before)
    for (const c of t.columns) {
      if (c.overflow) issues.push({ code: 'OVERFLOW', message: `${c.table}.${c.column} پس از تبدیل از سقف ستون عبور می‌کند`, detail: { maxAbs: c.maxAbs } });
      if (c.lossy > 0 && mode === 'STRICT') issues.push({ code: 'INEXACT', message: `${c.table}.${c.column}: ${c.lossy} خانه دقیق تبدیل نمی‌شود` });
    }
  for (const j of await scanJsonColumns(db, rate)) {
    if (j.overflow) issues.push({ code: 'OVERFLOW', message: `${j.table}.${j.column} (JSON) پس از تبدیل از عدد امن عبور می‌کند`, detail: { maxAbs: j.maxAbs } });
    if (j.lossy > 0 && mode === 'STRICT') issues.push({ code: 'INEXACT', message: `${j.table}.${j.column} (JSON): ${j.lossy} مقدار دقیق تبدیل نمی‌شود` });
  }
  if (issues.length) throw new ConversionAbort('تبدیل ممکن نیست؛ داده با نرخ و حالت گرد‌کردن انتخابی سازگار نیست', issues);
  tick('بررسی نهایی داده‌ها');

  // تراز قبلی اسناد — بعد از تبدیل فقط همین اسناد باید تراز بمانند
  await db.$executeRawUnsafe(`CREATE TEMP TABLE "_bc_balanced" ON COMMIT DROP AS SELECT "entryId" FROM "accounting_journal_lines" GROUP BY "entryId" HAVING SUM("debit") = SUM("credit")`);

  // بازیابی دقیق برای بازگشت: خانه‌هایی که از زمان تبدیل اصلی دست‌نخورده‌اند (مقدار فعلی == newValue لاگ)
  await db.$executeRawUnsafe(`CREATE TEMP TABLE "_bc_restore" ("tbl" text, "row_id" text, "col" text, "old_value" text) ON COMMIT DROP`);
  if (p.restoreFromConversionId) {
    const logged = await db.$queryRawUnsafe<Array<{ t: string; c: string }>>(
      `SELECT DISTINCT "tableName" AS t, "columnName" AS c FROM "base_currency_rounding_log" WHERE "conversionId" = $1`,
      p.restoreFromConversionId,
    );
    const allowed = new Set([...MONEY_COLUMNS.map((m) => `${m.table}.${m.column}`), ...RATE_COLUMNS.map((m) => `${m.table}.${m.column}`)]);
    for (const l of logged) {
      if (!allowed.has(`${l.t}.${l.c}`)) continue; // لاگ دست‌کاری‌شده نمی‌تواند نام جدول دلخواه تزریق کند
      await db.$executeRawUnsafe(
        `INSERT INTO "_bc_restore" SELECT g."tableName", g."rowId", g."columnName", g."oldValue" FROM "base_currency_rounding_log" g JOIN ${qi(l.t)} x ON x."id"::text = g."rowId" WHERE g."conversionId" = $1 AND g."tableName" = $2 AND g."columnName" = $3 AND x.${qi(l.c)}::text = g."newValue"`,
        p.restoreFromConversionId,
        l.t,
        l.c,
      );
    }
  }

  // ── بازمقیاس ستون‌های مبلغی ───────────────────────────────────────────────
  for (const [table, cols] of groups) {
    for (const c of cols) {
      const colSql = qi(c.column);
      // لاگ خانه‌های غیردقیق پیش از به‌روزرسانی (در حالت STRICT چنین خانه‌ای نیست؛ پیش‌بررسی بالا رد می‌کرد)
      const lossy = before.find((t) => t.table === table)?.columns.find((x) => x.column === c.column)?.lossy ?? 0;
      if (lossy > 0) await db.$executeRawUnsafe(
        `INSERT INTO "base_currency_rounding_log" ("id","conversionId","tableName","rowId","columnName","oldValue","newValue","kind")
         SELECT gen_random_uuid()::text, $1, $4, "id"::text, $5, ${colSql}::text, ${newValueSql(colSql, 2, 3)}::text, 'ROUND'
         FROM ${qi(table)} WHERE ${colSql} IS NOT NULL AND (${colSql}::numeric * $2::numeric) % $3::numeric <> 0`,
        p.conversionId,
        num,
        den,
        table,
        c.column,
      );
      await db.$executeRawUnsafe(
        `UPDATE ${qi(table)} SET ${colSql} = ${newValueSql(colSql, 1, 2)}::${c.kind === 'int4' ? 'integer' : 'bigint'} WHERE ${colSql} IS NOT NULL`,
        num,
        den,
      );
    }
    tick(`جدول ${table}`);
  }

  // ── نرخ‌های DECIMAL ────────────────────────────────────────────────────────
  let ratesRounded = 0;
  for (const r of RATE_COLUMNS) {
    const col = qi(r.column);
    ratesRounded += await db.$executeRawUnsafe(
      `INSERT INTO "base_currency_rounding_log" ("id","conversionId","tableName","rowId","columnName","oldValue","newValue","kind")
       SELECT gen_random_uuid()::text, $1, $4, "id"::text, $5, ${col}::text, ROUND(${col}::numeric * $2::numeric / $3::numeric, 4)::text, 'ROUND'
       FROM ${qi(r.table)} WHERE ${col} IS NOT NULL AND ROUND(${col}::numeric * $2::numeric / $3::numeric, 4) <> (${col}::numeric * $2::numeric / $3::numeric)`,
      p.conversionId,
      num,
      den,
      r.table,
      r.column,
    );
    await db.$executeRawUnsafe(`UPDATE ${qi(r.table)} SET ${col} = ROUND(${col}::numeric * $1::numeric / $2::numeric, 4) WHERE ${col} IS NOT NULL`, num, den);
    tick(`نرخ‌های ${r.table}`);
  }

  // ── ستون‌های JSON مبلغی ───────────────────────────────────────────────────
  const jsonRes = await convertJsonColumns(db, p);
  tick('ستون‌های JSON');

  // ── بازیابی دقیق (فقط بازگشت) ──────────────────────────────────────────────
  let restoredCells = jsonRes.restored;
  if (p.restoreFromConversionId) {
    const cells = await db.$queryRawUnsafe<Array<{ tbl: string; col: string }>>(`SELECT DISTINCT "tbl", "col" FROM "_bc_restore"`);
    for (const k of cells) {
      const isRate = RATE_COLUMNS.some((r) => r.table === k.tbl && r.column === k.col);
      const isMoney = MONEY_COLUMNS.find((m) => m.table === k.tbl && m.column === k.col);
      if (!isRate && !isMoney) continue;
      const castTo = isRate ? 'numeric' : isMoney!.kind === 'int4' ? 'integer' : 'bigint';
      restoredCells += await db.$executeRawUnsafe(
        `UPDATE ${qi(k.tbl)} x SET ${qi(k.col)} = r."old_value"::${castTo} FROM "_bc_restore" r WHERE r."tbl" = $1 AND r."col" = $2 AND x."id"::text = r."row_id"`,
        k.tbl,
        k.col,
      );
    }
  }

  // ── تراز اسناد دفتر کل (فقط اسنادی که پیش از تبدیل تراز بودند) ─────────────
  let ledgerAdjustments = 0;
  const adjusted: Record<string, bigint> = { debit: 0n, credit: 0n };
  const off = await db.$queryRawUnsafe<Array<{ entryId: string; d: string }>>(
    `SELECT l."entryId", (SUM(l."debit") - SUM(l."credit"))::text AS d FROM "accounting_journal_lines" l WHERE l."entryId" IN (SELECT "entryId" FROM "_bc_balanced") GROUP BY l."entryId" HAVING SUM(l."debit") <> SUM(l."credit")`,
  );
  if (off.length && mode === 'STRICT') {
    throw new ConversionAbort('تراز سند دفتر کل پس از تبدیل به‌هم می‌خورد؛ عملیات لغو شد', [{ code: 'LEDGER_UNBALANCED', message: `${off.length} سند`, detail: off.slice(0, 5) }]);
  }
  for (const o of off) {
    const diff = BigInt(o.d);
    const col = diff > 0n ? 'debit' : 'credit'; // سمتِ سنگین‌تر را سبک می‌کنیم
    const amount = diff > 0n ? diff : -diff;
    const [line] = await db.$queryRawUnsafe<Array<{ id: string; v: string }>>(
      `SELECT "id", ${qi(col)}::text AS v FROM "accounting_journal_lines" WHERE "entryId" = $1 AND ${qi(col)} >= $2::bigint ORDER BY ${qi(col)} DESC, "id" LIMIT 1`,
      o.entryId,
      amount.toString(),
    );
    if (!line) throw new ConversionAbort('تعدیل تراز ممکن نیست', [{ code: 'LEDGER_ADJUST_FAILED', message: o.entryId }]);
    const cur = BigInt(line.v);
    const next = cur - amount;
    // اگر این خانه قبلاً در لاگ گرد‌کردن هست، newValue همان ردیف را به‌روز می‌کنیم تا oldValue اصلی حفظ شود
    const updated = await db.$executeRawUnsafe(
      `UPDATE "base_currency_rounding_log" SET "newValue" = $1 WHERE "conversionId" = $2 AND "tableName" = 'accounting_journal_lines' AND "rowId" = $3 AND "columnName" = $4`,
      next.toString(),
      p.conversionId,
      line.id,
      col,
    );
    if (updated === 0) {
      // خانه‌ی دقیق‌تبدیل‌شده: مقدار اصلی = (مقدار فعلی × den / num)، و چون دقیق بوده عدد صحیح است
      const orig = (cur * rate.den) / rate.num;
      await db.$executeRawUnsafe(
        `INSERT INTO "base_currency_rounding_log" ("id","conversionId","tableName","rowId","columnName","oldValue","newValue","kind") VALUES (gen_random_uuid()::text,$1,'accounting_journal_lines',$2,$3,$4,$5,'LEDGER_ADJUST')`,
        p.conversionId,
        line.id,
        col,
        orig.toString(),
        next.toString(),
      );
    }
    await db.$executeRawUnsafe(`UPDATE "accounting_journal_lines" SET ${qi(col)} = $1::bigint WHERE "id" = $2`, next.toString(), line.id);
    adjusted[col] = adjusted[col]! + amount;
    ledgerAdjustments += 1;
  }
  tick('تراز دفتر کل');

  // ── تنظیمات عددی ───────────────────────────────────────────────────────────
  const settings = await settingsIo.convert(MONEY_SETTINGS, rate, mode);
  // ── کد ارز حساب‌های بانکی ──────────────────────────────────────────────────
  let currencyCodeRows = 0;
  for (const cc of CURRENCY_CODE_COLUMNS) {
    currencyCodeRows += await db.$executeRawUnsafe(`UPDATE ${qi(cc.table)} SET ${qi(cc.column)} = $1 WHERE ${qi(cc.column)} = $2`, p.toCode, p.fromCode);
  }
  tick('تنظیمات و کد ارز');

  // ── تأیید نهایی: جمع‌ها، تراز، یکپارچگی ────────────────────────────────────
  const after: TableStat[] = [];
  for (const [table, cols] of groups) after.push(await tableStats(db, table, cols, rate));
  const ledgerAfter = await ledgerStats(db);
  const resTables: RunReport['tables'] = [];
  let roundingCells = 0;
  let absDiff = 0n;
  for (const tb of before) {
    const aft = after.find((a) => a.table === tb.table)!;
    const columns: ColumnResult[] = tb.columns.map((c) => {
      const a = aft.columns.find((x) => x.column === c.column)!;
      const sumAfter = BigInt(a.sumBefore);
      const exp = BigInt(c.sumExpectedAfter);
      const adj = tb.table === 'accounting_journal_lines' ? adjusted[c.column] ?? 0n : 0n;
      // کران: هر خانه‌ی گردشده ≤ نیم‌واحد خطا؛ هر واحد تعدیل تراز ≤ یک واحد؛ هر خانه‌ی بازیابی‌شده ≤ (ceil(den/num)+1) واحد
      const lhs = sumAfter * rate.den - BigInt(c.sumBefore) * rate.num;
      const dev = lhs < 0n ? -lhs : lhs;
      const restoreSlack = BigInt(restoredCells) * rate.den * ((rate.den + rate.num - 1n) / rate.num + 1n);
      if (dev * 2n > (BigInt(c.lossy) + 2n * adj) * rate.den + restoreSlack * 2n) {
        throw new ConversionAbort(`جمع ستون ${c.table}.${c.column} پس از تبدیل با مقدار مورد انتظار نمی‌خواند`, [
          { code: 'CHECKSUM_MISMATCH', message: c.column, detail: { before: c.sumBefore, after: sumAfter.toString(), expected: exp.toString() } },
        ]);
      }
      const devUnits = (dev + rate.den - 1n) / rate.den;
      absDiff += devUnits;
      roundingCells += c.lossy;
      return { ...c, sumAfter: sumAfter.toString(), roundingAbsDiff: devUnits.toString() };
    });
    resTables.push({ table: tb.table, rows: tb.rows, columns });
  }
  // تراز: جمع کل بدهکار/بستانکار و تعداد اسناد نامتراز نباید بدتر شود
  if (ledgerAfter.unbalancedEntries > ledgerBefore.unbalancedEntries) {
    throw new ConversionAbort('پس از تبدیل اسناد نامتراز بیشتر شد؛ عملیات لغو شد', [
      { code: 'LEDGER_UNBALANCED', message: `${ledgerBefore.unbalancedEntries} → ${ledgerAfter.unbalancedEntries}` },
    ]);
  }
  if (BigInt(ledgerBefore.totalDebit) === BigInt(ledgerBefore.totalCredit) && BigInt(ledgerAfter.totalDebit) !== BigInt(ledgerAfter.totalCredit)) {
    throw new ConversionAbort('جمع کل بدهکار و بستانکار دفتر کل پس از تبدیل برابر نیست؛ عملیات لغو شد', [
      { code: 'LEDGER_TOTALS', message: `${ledgerAfter.totalDebit} ≠ ${ledgerAfter.totalCredit}` },
    ]);
  }
  const invoiceIdentityAfter = await invoiceIdentityViolations(db);
  tick('تأیید نهایی');

  return {
    tables: resTables,
    ratesRounded,
    jsonCells: jsonRes.cells,
    restoredCells,
    ledgerAdjustments,
    ledgerBefore,
    ledgerAfter,
    settings,
    currencyCodeRows,
    roundingTotals: { cells: roundingCells, absDiffInNewUnits: absDiff.toString() },
    integrity: { invoiceIdentityBefore, invoiceIdentityAfter },
  };
}

/** خواندن/نوشتن تنظیمات JSON (ModuleSetting)؛ جدا شده تا هسته به Prisma وابسته نباشد. */
export interface SettingsIo {
  convert(specs: typeof MONEY_SETTINGS, rate: Rational, mode: RoundingMode): Promise<RunReport['settings']>;
}
