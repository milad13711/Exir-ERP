import type { TenantRequestContext } from '../common/request-context.js';
import type { PermissionsService } from '../permissions/permissions.service.js';
import { assertInScope } from '../permissions/scope.util.js';

/**
 * مسیر ویرایشِ مبتنی بر ارجاع نباید بتواند سند را به مخاطب/فرصتی ببندد که ویرایشگر با دید عادی خودش نمی‌بیند
 * (ارجاع فقط روی همین یک سند اختیار می‌دهد، نه روی اشیای مرتبط). تغییر رابطه فقط با دامنه‌ی سخت‌گیر CRM مجاز است.
 */
export async function assertRelationsAllowed(
  permissions: PermissionsService,
  ctx: TenantRequestContext,
  next: { contactId?: string | null; dealId?: string | null },
  existing: { contactId?: string | null; dealId?: string | null } | null,
): Promise<void> {
  const contactChanged = !!next.contactId && next.contactId !== (existing?.contactId ?? null);
  const dealChanged = !!next.dealId && next.dealId !== (existing?.dealId ?? null);
  if (!contactChanged && !dealChanged) return;
  const scope = await permissions.viewScope(ctx, 'crm', 'ownerUserId'); // بدون دید CRM → Forbidden
  if (contactChanged) await assertInScope(ctx.tenantDb.crmContact, scope, { id: next.contactId }, { message: 'مخاطب یافت نشد' });
  if (dealChanged) await assertInScope(ctx.tenantDb.crmDeal, scope, { id: next.dealId }, { message: 'فرصت فروش یافت نشد' });
}
