import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { PermissionsService } from '../permissions/permissions.service.js';
import { ATTACHMENT_ENTITY, MODULE_CODE, RECEIPT_ATTACHMENT_ENTITY, SCAN_ATTACHMENT_ENTITY, SNAPSHOT_ATTACHMENT_ENTITY, type LetterStatus, type LetterType } from './correspondence.constants.js';
import { letterVisibilityWhere } from './letter-scope.js';
import { combineWhere } from './letter-search.js';

/** نوع‌های پیوست مکاتبات: 'Letter' (پیوست‌ها)، 'LetterScan' (اسکن وارده)، 'LetterReceipt' (رسید تحویل) و 'LetterSnapshot' (PDF امضاشده؛ فقط خواندنی). */
export const CORRESPONDENCE_ATTACHMENT_ENTITIES: ReadonlySet<string> = new Set([ATTACHMENT_ENTITY, SNAPSHOT_ATTACHMENT_ENTITY, SCAN_ATTACHMENT_ENTITY, RECEIPT_ATTACHMENT_ENTITY]);

/**
 * در چه وضعیت‌هایی می‌شود فایل افزود/حذف کرد (خالص؛ تست‌پذیر). «حذف» شامل تغییر نام هم هست.
 *  - Letter: صادره/داخلی فقط در پیش‌نویس/برگشتی (افزودن و حذف)؛ پس از امضا هیچ؛ وارده آزاد تا باطل/بایگانی.
 *  - LetterScan: فقط وارده؛ افزودن مجاز، حذف ممنوع.
 *  - LetterReceipt: فقط صادره/داخلی امضاشده؛ فقط افزودن.
 */
export function canModifyAttachments(type: LetterType, status: LetterStatus, archived: boolean, mode: 'write' | 'delete', entityType: string = ATTACHMENT_ENTITY): boolean {
  if (archived || status === 'VOID') return false;
  if (entityType === SNAPSHOT_ATTACHMENT_ENTITY) return false;
  if (entityType === SCAN_ATTACHMENT_ENTITY) return type === 'INCOMING' && mode === 'write';
  if (entityType === RECEIPT_ATTACHMENT_ENTITY) return type !== 'INCOMING' && mode === 'write' && ['ISSUED', 'SENT', 'DELIVERED'].includes(status);
  if (type === 'INCOMING') return true;
  return status === 'DRAFT' || status === 'RETURNED_FOR_EDIT';
}

/** نامه را در دامنه‌ی دید کاربر (با ماتریس مؤثر) برمی‌گرداند؛ وگرنه ۴۰۳/۴۰۴. برای مسیرهای بیرون از ماژول (پیوست، مدرک امضا). */
export async function loadVisibleLetterFacts(permissions: PermissionsService, ctx: TenantRequestContext, letterId: string) {
  const m = await permissions.getEffective(ctx, MODULE_CODE);
  const me = await resolveTenantUserId(ctx).catch(() => null);
  const isOwner = ctx.auth.role === 'OWNER';
  const isAdmin = ctx.auth.role === 'ADMIN';
  const visible = letterVisibilityWhere({ userId: me, isOwner, isAdmin, viewAll: m.canViewAll, viewOwn: m.canViewOwn });
  if (!visible) throw new ForbiddenException('اجازه‌ی دسترسی به این بخش را ندارید');
  const letter = await ctx.tenantDb.corrLetter.findFirst({
    where: combineWhere({ id: letterId }, visible) as never,
    select: { id: true, type: true, status: true, archivedAt: true, createdByUserId: true, ownerUserId: true },
  });
  if (!letter) throw new NotFoundException('نامه یافت نشد');
  return { letter, matrix: m, me, isOwner, isAdmin };
}

/**
 * دسترسی پیوست = دسترسی به خودِ نامه (همان ACL مکاتبات). حتی مالک/ادمین هم از همین مسیر عبور می‌کنند
 * (نامه‌ی «سری» برای ادمین دیده نمی‌شود). خارج از دامنه ۴۰۴.
 */
export async function assertLetterAttachmentAccess(
  permissions: PermissionsService,
  ctx: TenantRequestContext,
  entityType: string,
  letterId: string,
  mode: 'read' | 'write' | 'delete',
): Promise<void> {
  const { letter, matrix: m, me, isOwner, isAdmin } = await loadVisibleLetterFacts(permissions, ctx, letterId);
  if (mode === 'read') return;
  if (entityType === SNAPSHOT_ATTACHMENT_ENTITY) throw new ForbiddenException('فایل امضاشده تغییرناپذیر است');
  if (!canModifyAttachments(letter.type as LetterType, letter.status as LetterStatus, !!letter.archivedAt, mode, entityType)) {
    throw new ForbiddenException('در وضعیت فعلی نامه، افزودن یا حذف پیوست مجاز نیست');
  }
  if (isOwner || isAdmin) return;
  const mine = !!me && (letter.createdByUserId === me || letter.ownerUserId === me);
  if (!(m.canEdit || (m.canCreate && mine))) throw new ForbiddenException('اجازه‌ی ویرایش پیوست‌های این نامه را ندارید');
}

/** رویداد خط‌زمان برای افزودن/حذف پیوست (فراخوانی از AttachmentsController؛ شکست نباید عملیات را بشکند). */
export async function logLetterAttachmentEvent(
  ctx: TenantRequestContext,
  entityType: string,
  letterId: string,
  kind: 'ATTACHMENT_ADDED' | 'ATTACHMENT_REMOVED',
  title: string,
): Promise<void> {
  if (!CORRESPONDENCE_ATTACHMENT_ENTITIES.has(entityType)) return;
  try {
    const me = await resolveTenantUserId(ctx).catch(() => null);
    const u = me ? await ctx.tenantDb.user.findUnique({ where: { id: me }, select: { name: true } }) : null;
    await ctx.tenantDb.corrEvent.create({ data: { letterId, type: kind, actorUserId: me, actorName: u?.name ?? null, note: title.slice(0, 200), meta: { entityType } } });
  } catch {
    /* ignore */
  }
}
