import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSON_MONEY_COLUMNS } from './json-money.js';
import { COLUMN_KEY, CURRENCY_CODE_COLUMNS, MONEY_COLUMNS, NOT_CONVERTED, RATE_COLUMNS, assertIdent } from './money-columns.js';

const schema = readFileSync(join(__dirname, '../../prisma/tenant/schema.prisma'), 'utf8');

type Field = { model: string; table: string; name: string; type: string; line: string };
function parseSchema(): { fields: Field[]; tables: Map<string, Map<string, string>> } {
  const fields: Field[] = [];
  const tables = new Map<string, Map<string, string>>();
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)\n\}/gm)) {
    const model = m[1]!;
    const body = m[2]!;
    const table = /@@map\("(\w+)"\)/.exec(body)?.[1] ?? model;
    const cols = new Map<string, string>();
    for (const line of body.split('\n')) {
      const f = /^\s+(\w+)\s+(\w+)(\?|\[\])?(.*)$/.exec(line);
      if (!f || line.trim().startsWith('//') || line.trim().startsWith('@@')) continue;
      cols.set(f[1]!, f[2]!);
      fields.push({ model, table, name: f[1]!, type: f[2]!, line });
    }
    tables.set(table, cols);
  }
  return { fields, tables };
}
const { fields, tables } = parseSchema();

describe('فهرست ستون‌های مبلغی ↔ اسکیمای پریزما', () => {
  it('هر ستون فهرست در اسکیما هست، با نوع درست (Int→int4، BigInt→int8) و جدول دارای id رشته‌ای', () => {
    for (const c of MONEY_COLUMNS) {
      const cols = tables.get(c.table);
      expect(cols, `جدول ${c.table}`).toBeDefined();
      const type = cols!.get(c.column);
      expect(type, `${c.table}.${c.column}`).toBe(c.kind === 'int4' ? 'Int' : 'BigInt');
      expect(cols!.get('id'), `${c.table}.id`).toBe('String');
    }
    for (const r of RATE_COLUMNS) {
      expect(tables.get(r.table)?.get(r.column), `${r.table}.${r.column}`).toBe('Decimal');
      expect(tables.get(r.table)?.get('id')).toBe('String');
    }
    for (const cc of CURRENCY_CODE_COLUMNS) expect(tables.get(cc.table)?.get(cc.column)).toBe('String');
  });

  it('تکراری ندارد و شناسه‌ها امن‌اند', () => {
    const keys = MONEY_COLUMNS.map(COLUMN_KEY);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of [...MONEY_COLUMNS, ...RATE_COLUMNS]) {
      assertIdent(c.table);
      assertIdent(c.column);
    }
    expect(() => assertIdent('a"; DROP TABLE x;--')).toThrow();
  });

  it('هر ستون Int/BigInt/Decimal/Float با کامنت «تومان» یا نام مبلغی، یا تبدیل می‌شود یا دلیلِ نادیده‌گرفتنش ثبت شده', () => {
    const covered = new Set([...MONEY_COLUMNS, ...RATE_COLUMNS].map((c) => `${c.table}.${c.column}`));
    const moneyName = /(amount|price|cost|total|salary|fee|debit|credit|discount|paid|value|budget|commission|subtotal|revenue|balance|deposit|reward|penalty|allowances|deductions|salvage|depreciation|purchaseCost|rate|snapshot)/i;
    const harmless = new Set(['RationFormulaLine.quantityPerAnimalKg', 'SalesInvoice.officialInvoiceNo', 'ResellerProfile.npsAvgScore']);
    const missing: string[] = [];
    for (const f of fields) {
      if (!['Int', 'BigInt', 'Decimal', 'Float'].includes(f.type)) continue;
      const looksMoney = f.line.includes('تومان') || moneyName.test(f.name);
      if (!looksMoney) continue;
      const key = `${f.model}.${f.name}`;
      if (covered.has(`${f.table}.${f.name}`) || NOT_CONVERTED[key] || harmless.has(key)) continue;
      missing.push(key);
    }
    const knownNonMoney = new Set(['StockImportBatch.totalQuantity']); // تعداد، نه مبلغ
    const unexpected = missing.filter((k) => !knownNonMoney.has(k));
    expect(unexpected, `ستون‌های مبلغی بدون تصمیم (به MONEY_COLUMNS یا NOT_CONVERTED اضافه کنید): ${unexpected.join(', ')}`).toEqual([]);
  });

  it('همه‌ی ستون‌های دارای کامنت «تومان» پوشش داده شده‌اند', () => {
    const covered = new Set(MONEY_COLUMNS.map((c) => `${c.table}.${c.column}`));
    const gaps = fields
      .filter((f) => ['Int', 'BigInt'].includes(f.type) && f.line.includes('تومان'))
      .filter((f) => !covered.has(`${f.table}.${f.name}`) && !NOT_CONVERTED[`${f.model}.${f.name}`])
      .map((f) => `${f.model}.${f.name}`);
    expect(gaps).toEqual([]);
  });

  it('هر ستون Json در اسکیما یا تبدیل می‌شود (JSON_MONEY_COLUMNS) یا با دلیل در NOT_CONVERTED است', () => {
    const converted = new Set(JSON_MONEY_COLUMNS.map((j) => `${j.model}.${j.column}`));
    const unclassified = fields
      .filter((f) => f.type === 'Json')
      .map((f) => `${f.model}.${f.name}`)
      .filter((k) => !converted.has(k) && !NOT_CONVERTED[k]);
    expect(unclassified, `ستون Json بدون تصمیم: ${unclassified.join(', ')}`).toEqual([]);
  });

  it('JSON_MONEY_COLUMNS با اسکیما می‌خواند (جدول، ستون Json، id رشته‌ای) و دوبار هم در NOT_CONVERTED نیست', () => {
    for (const j of JSON_MONEY_COLUMNS) {
      expect(tables.get(j.table)?.get(j.column), `${j.table}.${j.column}`).toBe('Json');
      expect(tables.get(j.table)?.get('id')).toBe('String');
      expect(NOT_CONVERTED[`${j.model}.${j.column}`]).toBeUndefined();
      expect(j.fields.length).toBeGreaterThan(0);
    }
    // مورد خاص مرور مستقل: Proposal.invoiceLines و DispatchInvoiceAdjustment.lineChanges حتماً تبدیل می‌شوند
    const keys = JSON_MONEY_COLUMNS.map((j) => `${j.model}.${j.column}`);
    expect(keys).toContain('Proposal.invoiceLines');
    expect(keys).toContain('DispatchInvoiceAdjustment.lineChanges');
  });
});
