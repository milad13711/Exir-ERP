import { IsOptional, IsString, MinLength } from 'class-validator';

export class SaveExtensionDto {
  @IsString()
  @MinLength(1)
  extension!: string;

  /** برای ثبت‌نام مستقیم یک تلفن/سافت‌فون IP روی سانترال — نام‌کاربری معمولاً همان شماره موبایل با کد کشور است (مثل نواتل). */
  @IsOptional()
  @IsString()
  sipUsername?: string;

  @IsOptional()
  @IsString()
  sipPassword?: string;
}
