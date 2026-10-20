import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class OffboardUserDto {
  /** کاربر مقصدِ اصلی؛ اگر کاربر هیچ رکوردی برای انتقال نداشته باشد (یا همه‌ی ماژول‌ها override شده باشند) لازم نیست. */
  @IsOptional()
  @IsString()
  transferToUserId?: string;

  /** {moduleCode: userId} — مقصد متفاوت برای یک ماژول مشخص. */
  @IsOptional()
  @IsObject()
  perModuleOverrides?: Record<string, string>;

  /**
   * transfer-only: فقط انتقال رکوردها (نقش عوض شده/مرخصی) — حساب و دسترسی دست‌نخورده؛
   * deactivate (پیش‌فرض): غیرفعال‌سازی + لغو نشست‌ها + پاک‌سازی داده‌ی شخصی؛ سابقه با نام کاربر می‌ماند؛
   * delete: حذف کامل = ناشناس‌سازی «کاربر حذف‌شده» + حذف عضویت (آزادشدن صندلی لایسنس) — فقط مدیر کل.
   */
  @IsOptional()
  @IsIn(['transfer-only', 'deactivate', 'delete'])
  mode?: 'transfer-only' | 'deactivate' | 'delete';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** تأیید صریح اینکه مقصد به برخی ماژول‌های منتقل‌شده دسترسی مشاهده ندارد. */
  @IsOptional()
  @IsBoolean()
  acceptTargetWithoutAccess?: boolean;

  /** اعلان خلاصه به مدیر مستقیم کاربر (از زنجیره‌ی پرونده‌ی پرسنلی). */
  @IsOptional()
  @IsBoolean()
  notifyManager?: boolean;
}
