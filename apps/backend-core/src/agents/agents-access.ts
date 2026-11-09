import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { registrySlug } from './agent-constants.js';

/** ماژول نمایندگی فقط در تننت رجیستری پلتفرم معنا دارد (همان قرارداد referral-sync). */
export function assertRegistryTenant(ctx: Pick<TenantRequestContext, 'tenantSlug'>): void {
  if (ctx.tenantSlug !== registrySlug()) throw new ForbiddenException('ماژول نمایندگی فقط در تننت رجیستری پلتفرم فعال است');
}

/** پروفایل نمایندگیِ کاربر جاری یا ۴۰۴؛ منبع تنها «پروفایلِ خودِ من» برای همه‌ی مسیرهای /agents/me. */
export async function requireMyProfile(ctx: TenantRequestContext) {
  const userId = await resolveTenantUserId(ctx);
  const profile = userId
    ? await ctx.tenantDb.resellerProfile.findUnique({
        where: { userId },
        include: { contact: { select: { id: true, name: true, company: true, phone: true, address: true } } },
      })
    : null;
  if (!profile) throw new NotFoundException('شما نماینده‌ی ثبت‌شده‌ای نیستید');
  return profile;
}

/** عضویتِ متعلق به همین نماینده یا ۴۰۴ — جداسازی نماینده‌ها و محصول‌ها: شناسه‌ی عضویتِ دیگران هرگز قابل دسترسی نیست. */
export async function requireMyMembership(ctx: TenantRequestContext, profileId: string, membershipId: string) {
  const m = await ctx.tenantDb.agentProductMembership.findFirst({
    where: { id: membershipId, resellerProfileId: profileId },
    include: { product: { select: { id: true, code: true, name: true, logoUrl: true, websiteUrl: true, isActive: true, holdDays: true, minSettlementAmount: true } } },
  });
  if (!m) throw new NotFoundException('عضویت یافت نشد');
  return m;
}
