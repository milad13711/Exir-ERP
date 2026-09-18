import { IsOptional, IsString } from 'class-validator';

export class SaveExtensionDto {
  /** فقط برای ویژگی پاپ‌آپ تماس ورودی (وب‌هوک) — در رابط کاربری فعلی که فقط اتصال تلفن IP را نشان می‌دهد، خالی می‌ماند. */
  @IsOptional()
  @IsString()
  extension?: string;

  /** برای ثبت‌نام مستقیم یک تلفن/سافت‌فون IP روی سانترال — نام‌کاربری معمولاً همان شماره موبایل با کد کشور است (مثل نواتل). */
  @IsOptional()
  @IsString()
  sipUsername?: string;

  @IsOptional()
  @IsString()
  sipPassword?: string;
}
