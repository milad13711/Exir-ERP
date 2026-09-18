import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';

const MODULE_CODE = 'general';
const SIGNATURE_KEY = 'signatureImage';
const STAMP_KEY = 'stampImage';
const DELEGATE_KEY = 'stampDelegateUserId';

// کلیدهای قدیمی، هرکدام مربوط به یک ماژول که قبلاً نسخه‌ی جداگانه‌ی خودش
// از مهر/امضا را نگه می‌داشت — فقط برای این‌که مهر/امضایی که یک تننت قبلاً
// همان‌جا بارگذاری کرده بود گم نشود؛ دیگر جایی نوشته نمی‌شوند.
const LEGACY_KEYS = [
  { moduleCode: 'contracts', key: 'companySignature' },
  { moduleCode: 'recruitment', key: 'companySeal' },
] as const;

export type CompanyStamp = { signatureImage?: string; stampImage?: string };

/**
 * منبع واحد مهر و امضای رسمی شرکت — زیر Settings → General، تا هیچ ماژولی
 * (قرارداد، جذب و استخدام، ...) نسخه‌ی جدا و بارگذاری‌شدنی خودش را نداشته
 * باشد. دسترسی به «استفاده» از مهر برای امضای اسناد رسمی فقط برای مالک
 * تننت است؛ مالک می‌تواند این دسترسی را به یک کاربر دیگر ارجاع دهد
 * (stampDelegateUserId) — نه برای تغییر خودِ تصویر مهر (آن همیشه فقط با
 * مالک است)، فقط برای امضا از طرف شرکت.
 */
@Injectable()
export class CompanyStampService {
  async getStamp(ctx: TenantRequestContext): Promise<CompanyStamp> {
    const row = await ctx.tenantDb.moduleSetting.findMany({
      where: { moduleCode: MODULE_CODE, key: { in: [SIGNATURE_KEY, STAMP_KEY] } },
    });
    const byKey = Object.fromEntries(row.map((r) => [r.key, r.value as string | undefined]));
    let signatureImage = byKey[SIGNATURE_KEY];
    let stampImage = byKey[STAMP_KEY];

    if (!signatureImage && !stampImage) {
      for (const legacy of LEGACY_KEYS) {
        const legacyRow = await ctx.tenantDb.moduleSetting.findUnique({
          where: { moduleCode_key: legacy },
        });
        const value = legacyRow?.value as CompanyStamp | undefined;
        if (value?.signatureImage || value?.stampImage) {
          signatureImage = value.signatureImage;
          stampImage = value.stampImage;
          break;
        }
      }
    }

    return { signatureImage, stampImage };
  }

  /** فقط مالک تننت می‌تواند خودِ تصویر مهر/امضا را تغییر دهد — ارجاع دسترسی فقط برای «امضا»، نه «تغییر مهر»، است. */
  async setStamp(ctx: TenantRequestContext, dto: { signatureImage?: string | null; stampImage?: string | null }): Promise<CompanyStamp> {
    if (ctx.auth.role !== 'OWNER') {
      throw new ForbiddenException('فقط مالک محیط کاری می‌تواند مهر و امضای رسمی شرکت را تغییر دهد');
    }
    const entries: Array<[string, string | null | undefined]> = [
      [SIGNATURE_KEY, dto.signatureImage],
      [STAMP_KEY, dto.stampImage],
    ];
    for (const [key, value] of entries) {
      if (value === undefined) continue;
      if (value === null) {
        await ctx.tenantDb.moduleSetting.deleteMany({ where: { moduleCode: MODULE_CODE, key } });
      } else {
        await ctx.tenantDb.moduleSetting.upsert({
          where: { moduleCode_key: { moduleCode: MODULE_CODE, key } },
          create: { moduleCode: MODULE_CODE, key, value },
          update: { value },
        });
      }
    }
    return this.getStamp(ctx);
  }

  async getDelegateUserId(ctx: TenantRequestContext): Promise<string | null> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: MODULE_CODE, key: DELEGATE_KEY } },
    });
    return (row?.value as string | undefined) ?? null;
  }

  /** فقط مالک — تعیین/حذف کاربری که اجازه دارد به‌جای مالک از طرف شرکت اسناد رسمی را امضا کند. */
  async setDelegateUserId(ctx: TenantRequestContext, userId: string | null): Promise<{ delegateUserId: string | null }> {
    if (ctx.auth.role !== 'OWNER') {
      throw new ForbiddenException('فقط مالک محیط کاری می‌تواند دسترسی مهر و امضا را ارجاع دهد');
    }
    if (userId === null) {
      await ctx.tenantDb.moduleSetting.deleteMany({ where: { moduleCode: MODULE_CODE, key: DELEGATE_KEY } });
      return { delegateUserId: null };
    }
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: MODULE_CODE, key: DELEGATE_KEY } },
      create: { moduleCode: MODULE_CODE, key: DELEGATE_KEY, value: userId },
      update: { value: userId },
    });
    return { delegateUserId: userId };
  }

  /** مالک همیشه مجاز است؛ در غیر این صورت فقط همان یک کاربری که مالک ارجاع داده. */
  async assertCanUse(ctx: TenantRequestContext): Promise<void> {
    if (ctx.auth.role === 'OWNER') return;
    const delegateUserId = await this.getDelegateUserId(ctx);
    if (delegateUserId) {
      const userId = await resolveTenantUserId(ctx);
      if (userId && userId === delegateUserId) return;
    }
    throw new ForbiddenException('فقط مالک محیط کاری، یا کاربری که مالک دسترسی مهر و امضا را به او ارجاع داده، می‌تواند اسناد رسمی را از طرف شرکت امضا کند');
  }

  isActingAsDelegate(ctx: TenantRequestContext): boolean {
    return ctx.auth.role !== 'OWNER';
  }
}
