import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { PermissionsService } from '../permissions/permissions.service.js';
import { dispatchViewWhere } from './dispatch-scope.js';

/**
 * پیوست‌های بار: «Shipment» (اسناد و فایل‌های بار) و «ShipmentLoading» (عکس‌های مراحل بارگیری؛ شناسه = شناسه‌ی بار).
 * دسترسی = دسترسی به خودِ بار: ماتریس dispatch با دامنه‌ی «فقط خودم»، یا مسئول وظیفه‌ی اسناد همان بار،
 * یا (سازگاری با قبل از نصب dispatch) «مشاهده‌ی همه»ی ناوگان. خارج از دامنه ۴۰۴. مدیران قبل از رسیدن به اینجا رد می‌شوند.
 */
export const DISPATCH_ATTACHMENT_ENTITIES: ReadonlySet<string> = new Set(['Shipment', 'ShipmentLoading']);

export async function assertShipmentAttachmentAccess(
  permissions: PermissionsService,
  ctx: TenantRequestContext,
  _entityType: string,
  shipmentId: string,
  mode: 'read' | 'write' | 'delete',
): Promise<void> {
  const me = await resolveTenantUserId(ctx).catch(() => null);

  // مسئول وظیفه‌ی اسناد همین بار (حتی بدون ماتریس dispatch) — خواندن و افزودن سند
  if (me) {
    const handler = await ctx.tenantDb.task.findFirst({
      where: { relatedModule: 'Shipment', relatedEntityId: shipmentId, assignees: { some: { userId: me } } },
      select: { id: true },
    });
    if (handler && (mode === 'read' || mode === 'write')) return;
  }

  const dm = await permissions.getEffective(ctx, 'dispatch');
  if (dm.canViewAll || dm.canViewOwn) {
    const taskIds = !dm.canViewAll && me
      ? (await ctx.tenantDb.task.findMany({ where: { relatedModule: 'Shipment', relatedEntityId: { not: null }, assignees: { some: { userId: me } } }, select: { relatedEntityId: true }, take: 500 })).map((t) => t.relatedEntityId!)
      : [];
    const where = dispatchViewWhere(dm.canViewAll, dm.canViewOwn, me, taskIds);
    if (where) {
      const found = await ctx.tenantDb.shipment.findFirst({ where: { id: shipmentId, ...where }, select: { id: true } });
      if (!found) throw new NotFoundException('رکورد یافت نشد');
      if (mode !== 'read' && !(mode === 'delete' ? dm.canEdit || dm.canDelete : dm.canEdit || dm.canCreate)) throw new ForbiddenException('اجازه‌ی ویرایش در این بخش را ندارید');
      return;
    }
  }

  // رفتار قدیمی ناوگان: فقط «مشاهده‌ی همه» + ماتریس ناوگان
  const fm = await permissions.getEffective(ctx, 'fleet');
  if (!fm.canViewAll) throw new ForbiddenException('اجازه‌ی دسترسی به پیوست‌های این بخش را ندارید');
  if (mode !== 'read' && !(mode === 'delete' ? fm.canEdit || fm.canDelete : fm.canEdit || fm.canCreate)) throw new ForbiddenException('اجازه‌ی ویرایش در این بخش را ندارید');
}
