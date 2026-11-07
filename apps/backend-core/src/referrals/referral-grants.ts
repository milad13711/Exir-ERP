import { ForbiddenException, Logger } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';

/**
 * «دسترسی مشاهده‌ی یک سند مشخص» برای گیرنده‌ی ارجاع یا مسئول وظیفه‌ی پیوندخورده به آن سند.
 *
 * منبع‌ها (فقط همین دو، فقط برای همان entityType/entityId، فقط «مشاهده»):
 *  1) DocumentReferral فعال (PENDING/ACCEPTED) با toUserId = کاربر؛ برای «مشاهده» ارجاع DONE هم دائمی می‌ماند.
 *  2) وظیفه‌ی منتشرشده و غیرپایانی که کاربر ارجاع‌گیرنده‌ی آن است و relatedModule/relatedEntityId آن سند را نشان می‌دهد.
 *
 * سطح‌ها: edit = ارجاع فعال/وظیفه‌ی باز (ویرایش سند طبق قواعد وضعیت خودش؛ نه حذف/ابطال/تأیید/پرداخت)؛ view = edit + ارجاع DONE.
 * با بازگشت/لغو/ارجاع مجدد یا بسته‌شدن وظیفه، دسترسی خودبه‌خود لغو می‌شود (هیچ ردیف دسترسی جداگانه‌ای نیست).
 * این ماژول عمداً به PermissionsService وابسته نیست تا خودِ PermissionsService بتواند از آن استفاده کند.
 */

const logger = new Logger('ReferralGrants');

export const ACTIVE_REFERRAL_STATUSES = ['PENDING', 'ACCEPTED'] as const;
/** مشاهده: ارجاع فعال + انجام‌شده (دائمی، فقط‌خواندنی). ویرایش: فقط ارجاع فعال / وظیفه‌ی باز. */
export const VIEW_REFERRAL_STATUSES = ['PENDING', 'ACCEPTED', 'DONE'] as const;
export type GrantMode = 'view' | 'edit';
const statusesFor = (mode: GrantMode) => [...(mode === 'edit' ? ACTIVE_REFERRAL_STATUSES : VIEW_REFERRAL_STATUSES)];
/** وظیفه‌ای که در این وضعیت‌ها باشد دیگر دسترسی نمی‌دهد. */
export const TERMINAL_TASK_STATUSES = ['APPROVED', 'CANCELLED', 'EXPIRED'] as const;

/** سقف تعداد شناسه‌ی مجاز در یک where — پیشگیری از پرسمان عظیم. */
export const GRANT_ID_CAP = 5000;

/**
 * وظایف به‌جای entityType دقیق، «ماژول» را نگه می‌دارند (relatedModule='sales' هم فاکتور است هم پیش‌فاکتور).
 * شناسه‌ها UUID‌اند؛ ids به where جدول همان entityType داده می‌شود، پس تداخل نوع ممکن نیست.
 */
export const TASK_MODULE_ENTITY_TYPES: Record<string, string[]> = {
  sales: ['SalesInvoice', 'SalesQuotation'],
  purchasing: ['PurchaseOrder'],
  crm: ['CrmDeal', 'CrmContact'],
  proposals: ['Proposal'],
  proposal: ['Proposal'],
  contract: ['Contract'],
  contracts: ['Contract'],
  project: ['Project'],
  projects: ['Project'],
  reports: ['Report'],
  report: ['Report'],
};

/** relatedModule هایی که برای entityType داده‌شده وظیفه‌ی پیوندخورده می‌سازند (شامل خود نام entityType). */
/** نگاشت امنِ module → entityType ها (relatedModule='constructor'/'__proto__' هرگز به prototype نمی‌رسد). */
export function entityTypesForModule(relatedModule: string): string[] {
  return Object.hasOwn(TASK_MODULE_ENTITY_TYPES, relatedModule) ? TASK_MODULE_ENTITY_TYPES[relatedModule] : [];
}

/** آیا این relatedModule می‌تواند دسترسی مشاهده بدهد؟ (نگاشت‌شده یا خودِ نام entityType) */
export function isGrantLinkedModule(relatedModule: string | null | undefined): boolean {
  if (!relatedModule) return false;
  return Object.hasOwn(TASK_MODULE_ENTITY_TYPES, relatedModule) || Object.values(TASK_MODULE_ENTITY_TYPES).some((t) => t.includes(relatedModule));
}

export function taskModulesFor(entityType: string): string[] {
  const out = new Set<string>([entityType]);
  for (const [mod, types] of Object.entries(TASK_MODULE_ENTITY_TYPES)) if (types.includes(entityType)) out.add(mod);
  return [...out];
}

type Db = TenantRequestContext['tenantDb'];

function taskGrantWhere(userId: string, entityType: string) {
  return {
    isPublished: true,
    status: { notIn: [...TERMINAL_TASK_STATUSES] },
    relatedModule: { in: taskModulesFor(entityType) },
    relatedEntityId: { not: null },
    OR: [{ assignedUserId: userId }, { assignees: { some: { userId } } }],
  };
}

/** شناسه‌ی سندهایی از این نوع که کاربر برایشان دسترسی مشاهده‌ی صریح دارد. */
export async function grantedEntityIds(db: Db, userId: string, entityType: string, mode: GrantMode = 'view'): Promise<string[]> {
  const [refs, tasks] = await Promise.all([
    db.documentReferral.findMany({
      where: { toUserId: userId, entityType, status: { in: statusesFor(mode) } },
      select: { entityId: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: GRANT_ID_CAP + 1,
    }),
    // وظیفه فقط «مشاهده» می‌دهد؛ ویرایش هرگز از وظیفه نمی‌آید
    mode === 'edit'
      ? Promise.resolve([] as Array<{ relatedEntityId: string | null }>)
      : db.task.findMany({
          where: taskGrantWhere(userId, entityType),
          select: { relatedEntityId: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: GRANT_ID_CAP + 1,
        }),
  ]);
  if (refs.length > GRANT_ID_CAP || tasks.length > GRANT_ID_CAP) logger.warn(`grant ids truncated at ${GRANT_ID_CAP} for user ${userId} (${entityType})`);
  const ids = new Set<string>(refs.slice(0, GRANT_ID_CAP).map((r) => r.entityId));
  for (const t of tasks.slice(0, GRANT_ID_CAP)) if (t.relatedEntityId) ids.add(t.relatedEntityId);
  return [...ids];
}

/** آیا کاربر برای همین یک سند دسترسی مشاهده‌ی صریح دارد؟ */
export async function hasEntityGrant(db: Db, userId: string, entityType: string, entityId: string, mode: GrantMode = 'view'): Promise<boolean> {
  const ref = await db.documentReferral.findFirst({
    where: { toUserId: userId, entityType, entityId, status: { in: statusesFor(mode) } },
    select: { id: true },
  });
  if (ref) return true;
  if (mode === 'edit') return false; // ویرایش فقط از ارجاع فعال
  const task = await db.task.findFirst({
    where: { ...taskGrantWhere(userId, entityType), relatedEntityId: entityId },
    select: { id: true },
  });
  return !!task;
}

/**
 * ادغام «دامنه‌ی دید عادی» با دسترسی صریح سند. فقط برای مسیرهای خواندن (جزئیات/فهرست/PDF/پیوست) —
 * مسیرهای نوشتن همچنان دامنه‌ی سخت‌گیرانه‌ی خودشان را می‌خواهند.
 *  - `strict()` اگر Forbidden بدهد یعنی کاربر هیچ دید عادی ندارد؛ در این حالت فقط سندهای ارجاع‌شده برمی‌گردد.
 *  - خروجی `{}` = همه (مدیر/مشاهده‌ی همه). وگرنه یک where که با spread در query ادغام می‌شود
 *    (از AND استفاده می‌کند تا کلید OR خود فراخواننده را بازنویسی نکند).
 */
export async function scopeWithGrants(
  ctx: TenantRequestContext,
  entityType: string,
  strict: () => Promise<Record<string, unknown>>,
  mode: GrantMode = 'view',
): Promise<Record<string, unknown>> {
  let base: Record<string, unknown> | null = null;
  let denied: unknown = null;
  try {
    base = await strict();
  } catch (e) {
    if (!(e instanceof ForbiddenException)) throw e;
    denied = e;
  }
  if (base && Object.keys(base).length === 0) return {};
  const me = await resolveTenantUserId(ctx).catch(() => null);
  const ids = me ? await grantedEntityIds(ctx.tenantDb, me, entityType, mode) : [];
  if (ids.length === 0) {
    if (base) return base;
    throw denied;
  }
  // همیشه AND-wrapped: اگر فراخواننده `{ id, ...scope }` بپاشد، `id` درخواستی هرگز با `id: {in}` بازنویسی نمی‌شود
  const granted = { id: { in: ids } };
  return base ? { AND: [{ OR: [base, granted] }] } : { AND: [granted] };
}
