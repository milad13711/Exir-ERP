import { LETTER_STATUSES, LETTER_TYPES, CONFIDENTIALITIES, PRIORITIES } from './correspondence.constants.js';
import { tehranDayEnd, tehranDayStart } from './tehran-date.js';
import type { Where } from './letter-scope.js';

/** پارامترهای جست‌وجوی فهرست (همه اختیاری، همه با whitelist اعتبارسنجی می‌شوند). */
export type LetterFilters = {
  q?: string;
  number?: string;
  type?: string;
  status?: string[];
  categoryIds?: string[];
  priority?: string;
  confidentiality?: string;
  dateField?: 'letterDate' | 'externalDate' | 'receivedAt' | 'createdAt';
  dateFrom?: string;
  dateTo?: string;
  sender?: string;
  recipient?: string;
  mine?: boolean;
  archived?: 'only' | 'exclude' | 'all';
  awaitingReply?: boolean;
  responseOverdue?: boolean;
  tag?: string;
  createdByUserId?: string;
  relatedContactId?: string;
  replyToLetterId?: string;
};

const DATE_FIELDS = ['letterDate', 'externalDate', 'receivedAt', 'createdAt'] as const;
/**
 * ورودی جست‌وجو: Prisma در `contains` نمادهای LIKE (% و _ و \) را معنادار می‌گذارد؛ برای اینکه کاربر الگوی wildcard
 * (مثلاً %_%_%_ برای فشار روی DB) نسازد، این نویسه‌ها به فاصله تبدیل می‌شوند. (جست‌وجوی دقیق شماره‌ای که _ دارد کمی کلی‌تر می‌شود.)
 */
export function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, ' ');
}
const trimmed = (s: string | undefined, max = 200): string | undefined => {
  if (typeof s !== 'string') return undefined;
  const t = escapeLike(s).replace(/\s+/g, ' ').trim().slice(0, max);
  return t ? t : undefined;
};
const contains = (v: string) => ({ contains: v, mode: 'insensitive' });

/**
 * ساخت where از فیلترها. ILIKE روی ستون‌های متنی + ایندکس btree روی ستون‌های فیلتر؛ pg_trgm/tsvector عمداً
 * اضافه نشده (حجم نامه‌ی یک سازمان کوچک تا متوسط است)؛ اگر جست‌وجوی متن‌کامل کند شد، GIN trigram روی subject/bodyHtml افزوده شود.
 * جست‌وجوی «شماره» هم شماره‌ی دبیرخانه (letterNumber) را می‌گیرد و هم شماره‌ی اصلی (externalNumber).
 */
export function buildLetterFilterWhere(f: LetterFilters, meUserId: string | null, now = new Date()): Where {
  const and: Where[] = [];
  const num = trimmed(f.number, 80);
  if (num) and.push({ OR: [{ letterNumber: contains(num) }, { externalNumber: contains(num) }] });
  const q = trimmed(f.q);
  if (q) {
    and.push({
      OR: [
        { subject: contains(q) }, { bodyText: contains(q) }, { letterNumber: contains(q) }, { externalNumber: contains(q) },
        { senderName: contains(q) }, { senderOrgName: contains(q) }, { recipientsText: contains(q) }, { tags: { has: q } },
      ],
    });
  }
  if (f.type && (LETTER_TYPES as readonly string[]).includes(f.type)) and.push({ type: f.type });
  const statuses = (f.status ?? []).filter((s) => (LETTER_STATUSES as readonly string[]).includes(s));
  if (statuses.length) and.push({ status: { in: statuses } });
  if (f.categoryIds?.length) and.push({ categoryId: { in: f.categoryIds.slice(0, 200) } });
  if (f.priority && (PRIORITIES as readonly string[]).includes(f.priority)) and.push({ priority: f.priority });
  if (f.confidentiality && (CONFIDENTIALITIES as readonly string[]).includes(f.confidentiality)) and.push({ confidentiality: f.confidentiality });
  const field = f.dateField && (DATE_FIELDS as readonly string[]).includes(f.dateField) ? f.dateField : 'letterDate';
  const from = tehranDayStart(f.dateFrom);
  const to = tehranDayEnd(f.dateTo);
  if (from || to) and.push({ [field]: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } });
  const sender = trimmed(f.sender);
  if (sender) and.push({ OR: [{ senderName: contains(sender) }, { senderOrgName: contains(sender) }, { createdByName: contains(sender) }] });
  const recipient = trimmed(f.recipient);
  if (recipient) and.push({ recipientsText: contains(recipient) });
  if (f.mine && meUserId) and.push({ OR: [{ createdByUserId: meUserId }, { ownerUserId: meUserId }, { signerUserId: meUserId }, { participants: { some: { userId: meUserId } } }] });
  if (f.archived === 'only') and.push({ archivedAt: { not: null } });
  else if (f.archived !== 'all') and.push({ archivedAt: null });
  if (f.awaitingReply) and.push({ type: 'INCOMING' }, { status: { in: ['REGISTERED', 'REFERRED', 'IN_PROGRESS'] } }, { answeredAt: null });
  if (f.responseOverdue) and.push({ responseDueAt: { lt: now } }, { status: { notIn: ['ANSWERED', 'CLOSED', 'VOID', 'DELIVERED', 'SENT', 'REJECTED'] } });
  const tag = trimmed(f.tag, 60);
  if (tag) and.push({ tags: { has: tag } });
  if (f.createdByUserId) and.push({ createdByUserId: f.createdByUserId });
  if (f.relatedContactId) and.push({ OR: [{ relatedContactId: f.relatedContactId }, { senderContactId: f.relatedContactId }] });
  if (f.replyToLetterId) and.push({ replyToLetterId: f.replyToLetterId });
  return and.length ? { AND: and } : {};
}

/** ترکیب دامنه‌ی دید و فیلتر کاربر؛ دید همیشه با AND می‌آید تا فیلتر کاربر نتواند دامنه را دور بزند. */
export function combineWhere(scope: Where, filter: Where): Where {
  const parts = [scope, filter].filter((p) => Object.keys(p).length > 0);
  return parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { AND: parts };
}

export const LIST_PAGE_DEFAULT = 30;
export const LIST_PAGE_MAX = 100;
export const clampPageSize = (n: number | undefined): number => Math.min(LIST_PAGE_MAX, Math.max(1, Math.floor(n ?? LIST_PAGE_DEFAULT) || LIST_PAGE_DEFAULT));
