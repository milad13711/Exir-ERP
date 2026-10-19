import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { normalizeSearchTerm } from '../common/search.js';

export const CONTACT_SEARCH_DEFAULT_LIMIT = 15;
export const CONTACT_SEARCH_MAX_LIMIT = 30;

const DIGITS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

export function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d] ?? d);
}

/** ی/ک عربی و فارسی یکی گرفته می‌شوند؛ هر دو شکل جستجو می‌شود تا «علي» و «علی» هم‌دیگر را پیدا کنند. */
export function nameVariants(term: string): string[] {
  const persian = term.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  const arabic = term.replace(/ی/g, 'ي').replace(/ک/g, 'ك');
  return [...new Set([term, persian, arabic])];
}

export type ContactKind = 'customer' | 'supplier' | 'all';

/** where برای جستجوی مخاطب: نام، شرکت، موبایل، ایمیل، کد/شناسه ملی، کد اقتصادی، شماره ثبت. */
export function buildContactSearchWhere(rawQ: unknown, kind: ContactKind = 'all'): Record<string, unknown> {
  const q = normalizeSearchTerm(rawQ);
  const kindWhere = kind === 'supplier' ? { isSupplier: true } : kind === 'customer' ? { isCustomer: true } : {};
  if (!q) return kindWhere;
  const latin = toLatinDigits(q);
  const digitsOnly = latin.replace(/[\s-]/g, '');
  const or: Array<Record<string, unknown>> = [];
  for (const v of nameVariants(q)) {
    or.push({ name: { contains: v, mode: 'insensitive' } }, { company: { contains: v, mode: 'insensitive' } });
  }
  or.push({ email: { contains: latin, mode: 'insensitive' } });
  if (/^\d+$/.test(digitsOnly)) {
    // 0912… و 912… هر دو پیدا شوند
    const phoneTail = digitsOnly.replace(/^0+/, '') || digitsOnly;
    or.push(
      { phone: { contains: phoneTail } },
      { nationalId: { contains: digitsOnly } },
      { economicCode: { contains: digitsOnly } },
      { legalId: { contains: digitsOnly } },
      { registrationNumber: { contains: digitsOnly } },
    );
  } else {
    or.push({ registrationNumber: { contains: latin, mode: 'insensitive' } });
  }
  return { ...kindWhere, OR: or };
}

export function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return CONTACT_SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), CONTACT_SEARCH_MAX_LIMIT);
}

const SEARCH_SELECT = {
  id: true,
  type: true,
  name: true,
  company: true,
  phone: true,
  nationalId: true,
  isCustomer: true,
  isSupplier: true,
} as const;

/** جستجوی سبک و محدود برای کومبوباکس‌های انتخاب مشتری/تأمین‌کننده؛ scope همان دامنه‌ی مشاهده‌ی کاربر است. */
export async function searchContacts(
  db: TenantPrismaClient,
  opts: { q?: unknown; kind?: ContactKind; limit?: unknown; scope?: Record<string, unknown> },
) {
  const rows = await db.crmContact.findMany({
    where: { ...(opts.scope ?? {}), ...buildContactSearchWhere(opts.q, opts.kind ?? 'all') } as never,
    select: SEARCH_SELECT,
    orderBy: normalizeSearchTerm(opts.q) ? { name: 'asc' } : { createdAt: 'desc' },
    take: clampLimit(opts.limit),
  });
  return rows;
}
