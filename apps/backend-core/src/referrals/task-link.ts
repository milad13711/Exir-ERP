import { ForbiddenException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { PermissionsService } from '../permissions/permissions.service.js';
import { entityDef, entityDelegate, entityReadScope, selectFor } from './entity-defs.js';
import { ACTIVE_REFERRAL_STATUSES, entityTypesForModule } from './referral-grants.js';

function candidateTypes(relatedModule: string): string[] {
  const mapped = entityTypesForModule(relatedModule);
  if (mapped.length) return mapped;
  return entityDef(relatedModule) ? [relatedModule] : [];
}

/**
 * وظیفه‌ی پیوندخورده به یک سند، به ارجاع‌گیرنده‌ی وظیفه دسترسی مشاهده‌ی همان سند را می‌دهد
 * (referral-grants.ts). پس سازنده‌ی وظیفه نباید بتواند سندی را که خودش نمی‌بیند به کسی «بتاباند».
 * قاعده: سازنده باید سند را با دید عادی ببیند، یا خودش مسئولِ فعالِ ارجاع همان سند باشد. مدیر همیشه مجاز است.
 * ماژول‌های ناشناخته (بدون نگاشت) بدون محدودیت می‌مانند (مثل پیوند به تیکت پشتیبانی یا چک‌لیست).
 */
export async function assertTaskLinkAllowed(
  permissions: PermissionsService,
  ctx: TenantRequestContext,
  relatedModule: string | undefined | null,
  relatedEntityId: string | undefined | null,
): Promise<void> {
  if (!relatedModule || !relatedEntityId) return;
  const types = candidateTypes(relatedModule);
  if (types.length === 0) {
    // «Shipment» در اعلام بار دسترسی واقعی می‌دهد (dispatch-attachment-access): پیوند دستی فقط برای دارندگان دید ماژول dispatch
    if (relatedModule === 'Shipment') await permissions.assertView(ctx, 'dispatch');
    return;
  }
  const me = await resolveTenantUserId(ctx).catch(() => null);

  for (const type of types) {
    const def = entityDef(type);
    if (!def) continue;
    const scope = await def.strictScope(permissions, ctx).catch((e) => {
      if (e instanceof ForbiddenException) return null;
      throw e;
    });
    if (scope) {
      const row = await entityDelegate(ctx, def).findFirst({ where: { id: relatedEntityId, ...scope }, select: { id: true } });
      if (row) return;
    }
    if (me) {
      const ref = await ctx.tenantDb.documentReferral.findFirst({
        where: { entityType: type, entityId: relatedEntityId, toUserId: me, status: { in: [...ACTIVE_REFERRAL_STATUSES] } },
        select: { id: true },
      });
      if (ref) return;
    }
  }
  throw new ForbiddenException('سند مرتبط با وظیفه یافت نشد یا اجازه‌ی مشاهده‌ی آن را ندارید');
}

/**
 * سندِ پیوندخورده به وظیفه برای دکمه‌ی «مشاهده‌ی سند» در جزئیات وظیفه. فقط وقتی برمی‌گردد که کاربر همین‌حالا
 * (با دید عادی یا دسترسی صریح ارجاع/وظیفه) سند را ببیند؛ در غیر این صورت null (بدون افشای برچسب).
 */
export async function resolveTaskLinkedEntity(
  permissions: PermissionsService,
  ctx: TenantRequestContext,
  relatedModule: string | null | undefined,
  relatedEntityId: string | null | undefined,
): Promise<{ entityType: string; label: string; link: string; noun: string } | null> {
  if (!relatedModule || !relatedEntityId) return null;
  const types = candidateTypes(relatedModule);
  for (const type of types) {
    const def = entityDef(type);
    if (!def) continue;
    const scope = await entityReadScope(permissions, ctx, def).catch(() => null);
    if (!scope) continue;
    const row = await entityDelegate(ctx, def).findFirst({ where: { id: relatedEntityId, ...scope }, select: selectFor(def) });
    if (row) return { entityType: type, label: def.label(row as Record<string, unknown>), link: def.link(relatedEntityId), noun: def.noun };
  }
  return null;
}
