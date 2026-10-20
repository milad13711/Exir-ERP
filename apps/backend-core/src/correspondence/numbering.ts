import { randomUUID } from 'node:crypto';
import { LETTER_TYPE_CODES, type LetterType, type NumberResetPolicy } from './correspondence.constants.js';
import { pad2, tehranJalali } from './tehran-date.js';

/**
 * شماره‌گذاری — بخش خالص. توکن‌ها: {YYYY} سال شمسی ۴رقمی، {YY} دو رقمی، {MM} ماه شمسی دو رقمی،
 * {SEQ:n} شماره‌ی ترتیبی با صفر پیشوند تا n رقم، {TYPE} کد نوع (و/ص/د)، {CAT} کد دسته.
 *
 * قواعد: شماره فقط هنگام صدور/ثبت وارده تخصیص می‌یابد (درون همان تراکنش)؛ شمارنده به‌ازای (طرح، دوره) است و هرگز
 * کاهش نمی‌یابد. نامه‌ی باطل‌شده شماره‌اش را می‌سوزاند (فاصله در دنباله عمدی است و در «دفتر ثبت» با وضعیت «باطل» دیده می‌شود).
 * اگر تراکنش صدور رول‌بک شود، افزایش شمارنده هم رول‌بک می‌شود پس فاصله‌ی ناخواسته نمی‌افتد.
 */
export const DEFAULT_PATTERNS: Record<LetterType, string> = {
  INCOMING: 'وارده/{YYYY}/{SEQ:5}',
  OUTGOING: 'صادره/{YYYY}/{SEQ:5}',
  INTERNAL: 'داخلی/{YYYY}/{SEQ:5}',
};

const TOKEN_RE = /\{([A-Z]+)(?::(\d+))?\}/g;
const KNOWN = new Set(['YYYY', 'YY', 'MM', 'SEQ', 'TYPE', 'CAT']);

/** پیام خطا (فارسی) یا null اگر الگو معتبر است. */
export function validatePattern(pattern: string, resetPolicy?: string): string | null {
  const p = pattern.trim();
  if (!p || p.length > 120) return 'الگو باید بین ۱ تا ۱۲۰ نویسه باشد';
  let hasSeq = false;
  let seqCount = 0;
  for (const m of p.matchAll(TOKEN_RE)) {
    if (!KNOWN.has(m[1])) return `توکن ناشناخته: {${m[1]}}`;
    if (m[1] === 'SEQ') {
      hasSeq = true;
      seqCount++;
      const n = Number(m[2] ?? 0);
      if (!Number.isInteger(n) || n < 1 || n > 12) return 'طول {SEQ:n} باید بین ۱ تا ۱۲ باشد';
    } else if (m[2] !== undefined) return `توکن {${m[1]}} پارامتر نمی‌پذیرد`;
  }
  if (!hasSeq) return 'الگو باید شامل {SEQ:n} باشد';
  if (seqCount > 1) return 'فقط یک {SEQ:n} مجاز است';
  const stripped = p.replace(TOKEN_RE, '');
  if (/[{}]/.test(stripped)) return 'آکولاد باز یا بسته‌ی نامتوازن در الگو';
  // بازنشانی دوره‌ای بدون توکن دوره، شماره‌ی تکراری می‌سازد (مثلاً شماره‌ی ۱ هر سال)
  const hasYear = /\{(YYYY|YY)\}/.test(p);
  const hasMonth = /\{MM\}/.test(p);
  if (resetPolicy === 'YEARLY' && !hasYear) return 'برای بازنشانی سالانه، الگو باید {YYYY} یا {YY} داشته باشد وگرنه شماره‌ها هر سال تکرار می‌شوند';
  if (resetPolicy === 'MONTHLY' && !(hasYear && hasMonth)) return 'برای بازنشانی ماهانه، الگو باید هم سال ({YYYY} یا {YY}) و هم ماه ({MM}) داشته باشد';
  return null;
}

export function periodKeyFor(policy: NumberResetPolicy, at: Date): string {
  const j = tehranJalali(at);
  if (policy === 'NEVER') return 'ALL';
  if (policy === 'MONTHLY') return `${j.year}-${pad2(j.month)}`;
  return String(j.year);
}

export function formatLetterNumber(pattern: string, input: { seq: number; at: Date; type: LetterType; categoryCode?: string | null }): string {
  const j = tehranJalali(input.at);
  return pattern.replace(TOKEN_RE, (_all, tok: string, n?: string) => {
    switch (tok) {
      case 'YYYY': return String(j.year);
      case 'YY': return String(j.year).slice(-2);
      case 'MM': return pad2(j.month);
      case 'SEQ': return String(input.seq).padStart(Number(n ?? 1), '0');
      case 'TYPE': return LETTER_TYPE_CODES[input.type];
      case 'CAT': return input.categoryCode ?? '';
      default: return '';
    }
  });
}

export type NumberingSchemeLike = { id: string; type: string; pattern: string; resetPolicy: string; startAt: number };
/** افزایش اتمیک شمارنده؛ مقدار جدید را برمی‌گرداند (اولین بار = startAt). باید داخل همان تراکنش صدور اجرا شود. */
export type CounterIncrement = (schemeId: string, periodKey: string, startAt: number) => Promise<number>;

export type AllocatedNumber = { number: string; schemeId: string; periodKey: string; seq: number };

export async function allocateNumber(
  increment: CounterIncrement,
  scheme: NumberingSchemeLike,
  input: { type: LetterType; at: Date; categoryCode?: string | null },
): Promise<AllocatedNumber> {
  const periodKey = periodKeyFor(scheme.resetPolicy as NumberResetPolicy, input.at);
  const seq = await increment(scheme.id, periodKey, scheme.startAt);
  return { number: formatLetterNumber(scheme.pattern, { seq, at: input.at, type: input.type, categoryCode: input.categoryCode }), schemeId: scheme.id, periodKey, seq };
}

/** SQL اتمیک شمارنده (PostgreSQL). پارامترها: id, schemeId, periodKey, startAt. */
export const COUNTER_UPSERT_SQL = `INSERT INTO "corr_number_counters" ("id","schemeId","periodKey","lastSeq","updatedAt")
VALUES ($1,$2,$3,$4,NOW())
ON CONFLICT ("schemeId","periodKey") DO UPDATE SET "lastSeq" = "corr_number_counters"."lastSeq" + 1, "updatedAt" = NOW()
RETURNING "lastSeq"`;

export function newCounterId(): string {
  return randomUUID();
}
