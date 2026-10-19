/**
 * قواعد خالصِ ویرایش/ابطال رسید و حواله‌ی انبار (بدون پایگاه داده — تست‌پذیر).
 *
 * اصل: موجودی هر کالا در هر انبار «جمع quantityDelta همه‌ی ردیف‌ها»ست و در همه‌جا همین‌طور خوانده می‌شود؛ پس
 *  - ویرایش = تغییر درجای همان ردیف (با تاریخچه‌ی قبل/بعد)،
 *  - ابطال = علامت voidedAt روی ردیف اصلی + یک ردیف معکوس (reversalOfId) که اثر را خنثی می‌کند؛ ردیف اصلی هرگز حذف نمی‌شود.
 * هر دو فقط وقتی مجازند که «موجودی در هیچ نقطه‌ای از تاریخچه بدتر از قبل منفی نشود» (ر.ک. breaksStockHistory).
 */

export type MovementLike = {
  type: string;
  origin: string | null;
  reference: string | null;
  transferGroupId: string | null;
  voidedAt: Date | null;
  reversalOfId: string | null;
  importBatchId: string | null;
};

/** مرجع‌های ساخته‌شده توسط ماژول‌های دیگر (فروش، خرید، تولید، …) — ردیف‌های قدیمی بدون origin از روی همین‌ها شناسایی می‌شوند. */
const SYSTEM_REFERENCE_PREFIXES: Array<[string, string]> = [
  ['فاکتور فروش', 'فاکتور فروش'],
  ['اصلاح فاکتور', 'فاکتور فروش'],
  ['ابطال فاکتور', 'فاکتور فروش'],
  ['مرجوعی فروش', 'مرجوعی فروش'],
  ['حذف مرجوعی فروش', 'مرجوعی فروش'],
  ['سفارش خرید', 'سفارش خرید'],
  ['مرجوعی خرید', 'مرجوعی خرید'],
  ['حذف مرجوعی خرید', 'مرجوعی خرید'],
  ['دستور تولید', 'دستور تولید'],
  ['سفارش کتاب', 'سفارش کتاب'],
  ['سفارش فروشگاه', 'سفارش فروشگاه آنلاین'],
  ['انتقال', 'انتقال بین انبارها'],
];

const TYPE_DOC: Record<string, string> = {
  SALES_RETURN: 'مرجوعی فروش',
  PURCHASE_RETURN: 'مرجوعی خرید',
  TRANSFER_OUT: 'انتقال بین انبارها',
  TRANSFER_IN: 'انتقال بین انبارها',
  PRODUCTION_CONSUME: 'دستور تولید',
  PRODUCTION_YIELD: 'دستور تولید',
};

export const AMENDABLE_TYPES = ['RECEIPT', 'ISSUE', 'ADJUSTMENT'] as const;

/** null = قابل ویرایش/ابطال؛ وگرنه علت (با پیشنهاد مسیر درست). */
export function movementAmendBlock(m: MovementLike): string | null {
  if (m.reversalOfId) return 'این ردیف خودش معکوس‌کننده‌ی یک رسید/حواله‌ی باطل‌شده است';
  if (m.voidedAt) return 'این رسید/حواله قبلاً باطل شده است';
  if (m.importBatchId || m.origin === 'OPENING_IMPORT') {
    return 'این ردیف بخشی از موجودی اولیه‌ی واردشده از اکسل است؛ کل آن دسته را از «ورود موجودی اولیه» باطل کنید';
  }
  if (!(AMENDABLE_TYPES as readonly string[]).includes(m.type)) {
    return `این حرکت بخشی از «${TYPE_DOC[m.type] ?? 'سند دیگر'}» است و فقط از همان سند قابل اصلاح است`;
  }
  if (m.transferGroupId) return 'این حرکت بخشی از یک انتقال بین انبارهاست و فقط از همان سند قابل اصلاح است';
  if (m.origin === 'MANUAL') return null;
  const ref = m.reference?.trim() ?? '';
  const hit = SYSTEM_REFERENCE_PREFIXES.find(([prefix]) => ref.startsWith(prefix));
  if (hit) return `این رسید/حواله از «${hit[1]}» ساخته شده و فقط از همان سند قابل اصلاح یا ابطال است`;
  return null;
}

export type HistoryRow = { id: string; createdAt: Date; quantityDelta: number };

/** ردیف‌هایی که در موجودی «فعال» به‌حساب می‌آیند: نه ابطال‌شده و نه معکوس‌کننده‌ی ابطال (آن جفت با هم خنثی‌اند). */
export function isActiveMovement(m: { voidedAt: Date | null; reversalOfId: string | null }): boolean {
  return !m.voidedAt && !m.reversalOfId;
}

function minPrefix(rows: HistoryRow[]): { min: number; at: Date | null } {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  let bal = 0;
  let min = 0;
  let at: Date | null = null;
  for (const r of sorted) {
    bal += r.quantityDelta;
    if (bal < min) {
      min = bal;
      at = r.createdAt;
    }
  }
  return { min, at };
}

/**
 * آیا اعمال تغییر روی تاریخچه‌ی (یک کالا × یک انبار) موجودی را در نقطه‌ای «تازه منفی» یا «منفی‌تر» می‌کند؟
 * change.newDelta = null یعنی حذف ردیف (ابطال). ردیف‌های قدیمی که خودشان تاریخچه‌ی منفی داشته‌اند
 * مانع نمی‌شوند مگر وضعیت را بدتر کنیم.
 */
export function breaksStockHistory(
  history: HistoryRow[],
  change: { id: string; newDelta: number | null },
): { broken: boolean; minAfter: number; at: Date | null } {
  const before = minPrefix(history);
  const after = minPrefix(
    change.newDelta === null
      ? history.filter((h) => h.id !== change.id)
      : history.map((h) => (h.id === change.id ? { ...h, quantityDelta: change.newDelta! } : h)),
  );
  return { broken: after.min < 0 && after.min < before.min, minAfter: after.min, at: after.at };
}

/** برای ابطال گروهی (دسته‌ی موجودی اولیه): چند ردیف با هم حذف می‌شوند. */
export function breaksStockHistoryRemovingMany(history: HistoryRow[], removeIds: Set<string>): { broken: boolean; minAfter: number; at: Date | null } {
  const before = minPrefix(history);
  const after = minPrefix(history.filter((h) => !removeIds.has(h.id)));
  return { broken: after.min < 0 && after.min < before.min, minAfter: after.min, at: after.at };
}

export function deltaFor(type: string, quantity: number): number {
  return type === 'RECEIPT' ? quantity : type === 'ISSUE' ? -quantity : quantity;
}
